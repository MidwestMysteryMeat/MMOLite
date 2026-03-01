-- lib/net.lua
-- Async Socket.IO client for Love2D
-- WebSocket transport (primary) + HTTP polling (fallback for REST)
-- Implements Engine.IO + Socket.IO v4 protocol over WebSocket

-- =========================================================================
-- Minimal JSON parser/encoder (no dependencies)
-- =========================================================================
local json = {}

local function skipWhitespace(s, i)
    while i <= #s do
        local c = s:sub(i, i)
        if c == " " or c == "\t" or c == "\n" or c == "\r" then i = i + 1 else break end
    end
    return i
end

local function parseString(s, i)
    i = i + 1
    local start = i
    local parts = {}
    while i <= #s do
        local c = s:sub(i, i)
        if c == "\\" then
            parts[#parts + 1] = s:sub(start, i - 1)
            i = i + 1
            local esc = s:sub(i, i)
            if esc == '"' then parts[#parts + 1] = '"'
            elseif esc == '\\' then parts[#parts + 1] = '\\'
            elseif esc == '/' then parts[#parts + 1] = '/'
            elseif esc == 'n' then parts[#parts + 1] = '\n'
            elseif esc == 'r' then parts[#parts + 1] = '\r'
            elseif esc == 't' then parts[#parts + 1] = '\t'
            elseif esc == 'b' then parts[#parts + 1] = '\b'
            elseif esc == 'f' then parts[#parts + 1] = '\f'
            elseif esc == 'u' then
                local hex = s:sub(i + 1, i + 4)
                local cp = tonumber(hex, 16) or 0
                if cp < 128 then parts[#parts + 1] = string.char(cp) else parts[#parts + 1] = "?" end
                i = i + 4
            end
            i = i + 1; start = i
        elseif c == '"' then
            parts[#parts + 1] = s:sub(start, i - 1)
            return table.concat(parts), i + 1
        else
            i = i + 1
        end
    end
    return table.concat(parts), i
end

local parseValue

local function parseArray(s, i)
    i = i + 1
    local arr = {}
    i = skipWhitespace(s, i)
    if s:sub(i, i) == "]" then return arr, i + 1 end
    while true do
        local val
        val, i = parseValue(s, i)
        arr[#arr + 1] = val
        i = skipWhitespace(s, i)
        if s:sub(i, i) == "]" then return arr, i + 1 end
        if s:sub(i, i) == "," then i = i + 1 end
        i = skipWhitespace(s, i)
    end
end

local function parseObject(s, i)
    i = i + 1
    local obj = {}
    i = skipWhitespace(s, i)
    if s:sub(i, i) == "}" then return obj, i + 1 end
    while true do
        i = skipWhitespace(s, i)
        local key
        key, i = parseString(s, i)
        i = skipWhitespace(s, i)
        i = i + 1
        i = skipWhitespace(s, i)
        local val
        val, i = parseValue(s, i)
        obj[key] = val
        i = skipWhitespace(s, i)
        if s:sub(i, i) == "}" then return obj, i + 1 end
        if s:sub(i, i) == "," then i = i + 1 end
    end
end

local function parseNumber(s, i)
    local start = i
    if s:sub(i, i) == "-" then i = i + 1 end
    while i <= #s and s:sub(i, i):match("[%d]") do i = i + 1 end
    if i <= #s and s:sub(i, i) == "." then
        i = i + 1
        while i <= #s and s:sub(i, i):match("[%d]") do i = i + 1 end
    end
    if i <= #s and s:sub(i, i):lower() == "e" then
        i = i + 1
        if i <= #s and (s:sub(i, i) == "+" or s:sub(i, i) == "-") then i = i + 1 end
        while i <= #s and s:sub(i, i):match("[%d]") do i = i + 1 end
    end
    return tonumber(s:sub(start, i - 1)), i
end

parseValue = function(s, i)
    i = skipWhitespace(s, i)
    local c = s:sub(i, i)
    if c == '"' then return parseString(s, i)
    elseif c == '{' then return parseObject(s, i)
    elseif c == '[' then return parseArray(s, i)
    elseif c == 't' then return true, i + 4
    elseif c == 'f' then return false, i + 5
    elseif c == 'n' then return nil, i + 4
    else return parseNumber(s, i)
    end
end

function json.decode(s)
    if not s or #s == 0 then return nil end
    local ok, val = pcall(parseValue, s, 1)
    if ok then return val end
    return nil
end

local function encodeValue(val)
    local t = type(val)
    if val == nil then return "null"
    elseif t == "boolean" then return val and "true" or "false"
    elseif t == "number" then
        if val ~= val or val == math.huge or val == -math.huge then return "null" end
        if val == math.floor(val) and math.abs(val) < 2^53 then return string.format("%.0f", val) end
        return tostring(val)
    elseif t == "string" then
        return '"' .. val:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n'):gsub('\r', '\\r'):gsub('\t', '\\t') .. '"'
    elseif t == "table" then
        local isArray = true
        local maxIdx = 0
        for k, _ in pairs(val) do
            if type(k) ~= "number" or k < 1 or k ~= math.floor(k) then isArray = false; break end
            if k > maxIdx then maxIdx = k end
        end
        if isArray and maxIdx == #val then
            local parts = {}
            for i = 1, #val do parts[i] = encodeValue(val[i]) end
            return "[" .. table.concat(parts, ",") .. "]"
        else
            local parts = {}
            for k, v in pairs(val) do parts[#parts + 1] = encodeValue(tostring(k)) .. ":" .. encodeValue(v) end
            return "{" .. table.concat(parts, ",") .. "}"
        end
    end
    return "null"
end

function json.encode(val) return encodeValue(val) end

-- =========================================================================
-- Async HTTP via love.thread (non-blocking) — used for REST calls only
-- =========================================================================

local HTTP_WORKER_CODE = [[
    local url, method, body, responseChannel, timeout = ...
    local http = require("socket.http")
    local ltn12 = require("ltn12")
    http.TIMEOUT = timeout or 5

    local resp = {}
    local ok, code, headers
    if method == "POST" then
        ok, code, headers = http.request{
            url = url,
            method = "POST",
            source = ltn12.source.string(body),
            sink = ltn12.sink.table(resp),
            headers = {
                ["Content-Type"] = "text/plain",
                ["Content-Length"] = tostring(#body),
                ["User-Agent"] = "MMOLite/1.0",
            },
        }
    else
        ok, code, headers = http.request{
            url = url,
            sink = ltn12.sink.table(resp),
            headers = { ["User-Agent"] = "MMOLite/1.0" },
        }
    end

    if ok and code == 200 then
        responseChannel:push("OK:" .. table.concat(resp))
    else
        -- Include detailed error info
        local detail = "code=" .. tostring(code) .. " ok=" .. tostring(ok)
        if not ok and code then detail = detail .. " errmsg=" .. tostring(code) end
        responseChannel:push("ERR:" .. detail)
    end
]]

local pendingHttp = {}

local function asyncGet(url, callback, timeout)
    local ch = love.thread.newChannel()
    local thread = love.thread.newThread(HTTP_WORKER_CODE)
    thread:start(url, "GET", "", ch, timeout or 5)
    local safetyTimeout = (timeout or 5) + 4
    table.insert(pendingHttp, { channel = ch, callback = callback, thread = thread, startTime = love.timer.getTime(), timeout = safetyTimeout })
end

local function asyncPost(url, body, callback, timeout)
    local ch = love.thread.newChannel()
    local thread = love.thread.newThread(HTTP_WORKER_CODE)
    thread:start(url, "POST", body or "", ch, timeout or 5)
    local safetyTimeout = (timeout or 5) + 4
    table.insert(pendingHttp, { channel = ch, callback = callback, thread = thread, startTime = love.timer.getTime(), timeout = safetyTimeout })
end

local function updateHttp()
    for i = #pendingHttp, 1, -1 do
        local req = pendingHttp[i]
        local result = req.channel:pop()
        if result then
            table.remove(pendingHttp, i)
            if result:sub(1, 3) == "OK:" then
                local body = result:sub(4)
                req.callback(body, nil)
            else
                local errMsg = result:sub(5)
                req.callback(nil, errMsg)
            end
        elseif love.timer.getTime() - req.startTime > req.timeout then
            table.remove(pendingHttp, i)
            req.callback(nil, "timeout")
        end
    end
end

-- =========================================================================
-- URL encoding
-- =========================================================================
local function urlencode(str)
    return str:gsub("([^%w%-%.%_%~])", function(c)
        return string.format("%%%02X", string.byte(c))
    end)
end

-- =========================================================================
-- WebSocket worker thread (runs in love.thread)
-- Handles: TCP connect, HTTP upgrade, WebSocket frame encoding/decoding,
-- Engine.IO ping/pong at the WebSocket frame level.
-- Communicates with main thread via channels.
-- =========================================================================

local WS_WORKER_CODE = [[
    local host, port, wsPath, sendCh, recvCh = ...
    local socket = require("socket")
    local bit = require("bit")

    -- Base64 encode (for Sec-WebSocket-Key)
    local b64t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    local function b64enc(data)
        return ((data:gsub('.', function(x)
            local r, byte = '', x:byte()
            for i = 8, 1, -1 do r = r .. (byte % 2^i - byte % 2^(i-1) > 0 and '1' or '0') end
            return r
        end) .. '0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
            if #x < 6 then return '' end
            local c = 0
            for i = 1, 6 do c = c + (x:sub(i,i) == '1' and 2^(6-i) or 0) end
            return b64t:sub(c+1, c+1)
        end) .. ({ '', '==', '=' })[#data % 3 + 1])
    end

    -- Random bytes for WebSocket masking
    math.randomseed(socket.gettime() * 10000 + os.clock() * 10000)
    for _warm = 1, 20 do math.random() end
    local function randbytes(n)
        local t = {}
        for i = 1, n do t[i] = string.char(math.random(0, 255)) end
        return table.concat(t)
    end

    -- Write a masked WebSocket frame (RFC 6455: client MUST mask)
    local function ws_write(sock, payload, opcode)
        opcode = opcode or 1
        local len = #payload
        local hdr

        if len < 126 then
            hdr = string.char(bit.bor(0x80, opcode), bit.bor(0x80, len))
        elseif len < 65536 then
            hdr = string.char(bit.bor(0x80, opcode), bit.bor(0x80, 126),
                              bit.rshift(len, 8), bit.band(len, 0xFF))
        else
            hdr = string.char(bit.bor(0x80, opcode), bit.bor(0x80, 127),
                              0, 0, 0, 0,
                              bit.band(bit.rshift(len, 24), 0xFF),
                              bit.band(bit.rshift(len, 16), 0xFF),
                              bit.band(bit.rshift(len, 8), 0xFF),
                              bit.band(len, 0xFF))
        end

        local mask = randbytes(4)
        local masked = {}
        for i = 1, len do
            masked[i] = string.char(bit.bxor(payload:byte(i), mask:byte(((i - 1) % 4) + 1)))
        end

        return sock:send(hdr .. mask .. table.concat(masked))
    end

    -- Read a WebSocket frame (server->client: unmasked per RFC 6455)
    local function ws_read(sock)
        local h, err = sock:receive(2)
        if not h then return nil, err end

        local b1, b2 = h:byte(1), h:byte(2)
        local opcode = bit.band(b1, 0x0F)
        local is_masked = bit.band(b2, 0x80) ~= 0
        local plen = bit.band(b2, 0x7F)

        if plen == 126 then
            local ext, err2 = sock:receive(2)
            if not ext then return nil, err2 end
            plen = ext:byte(1) * 256 + ext:byte(2)
        elseif plen == 127 then
            local ext, err2 = sock:receive(8)
            if not ext then return nil, err2 end
            plen = 0
            for i = 1, 8 do plen = plen * 256 + ext:byte(i) end
        end

        local mask_key
        if is_masked then
            local mk, err3 = sock:receive(4)
            if not mk then return nil, err3 end
            mask_key = mk
        end

        local payload = ""
        if plen > 0 then
            local p, err4 = sock:receive(plen)
            if not p then return nil, err4 end
            payload = p
        end

        if mask_key then
            local unmasked = {}
            for i = 1, #payload do
                unmasked[i] = string.char(bit.bxor(payload:byte(i), mask_key:byte(((i - 1) % 4) + 1)))
            end
            payload = table.concat(unmasked)
        end

        return opcode, payload
    end

    -- 1) TCP connect (10 second timeout)
    local sock = socket.tcp()
    sock:settimeout(10)
    local ok, connErr = sock:connect(host, tonumber(port))
    if not ok then
        recvCh:push("ERR:TCP connect failed: " .. tostring(connErr))
        return
    end

    -- 2) WebSocket upgrade handshake
    local wsKey = b64enc(randbytes(16))
    local req = "GET " .. wsPath .. " HTTP/1.1\r\n"
             .. "Host: " .. host .. ":" .. port .. "\r\n"
             .. "Upgrade: websocket\r\n"
             .. "Connection: Upgrade\r\n"
             .. "Sec-WebSocket-Key: " .. wsKey .. "\r\n"
             .. "Sec-WebSocket-Version: 13\r\n"
             .. "User-Agent: MMOLite/1.0\r\n"
             .. "\r\n"

    local _, sendErr = sock:send(req)
    if sendErr then
        recvCh:push("ERR:Failed to send upgrade: " .. tostring(sendErr))
        sock:close()
        return
    end

    -- 3) Read HTTP 101 response
    sock:settimeout(5)
    local statusLine, recvErr = sock:receive("*l")
    if not statusLine then
        recvCh:push("ERR:No upgrade response: " .. tostring(recvErr))
        sock:close()
        return
    end
    if not statusLine:find("101") then
        recvCh:push("ERR:Upgrade rejected: " .. statusLine)
        sock:close()
        return
    end

    -- Read remaining headers until blank line
    while true do
        local line = sock:receive("*l")
        if not line or line == "" or line == "\r" then break end
    end

    recvCh:push("WS_OPEN")

    -- 4) Main event loop
    local running = true

    while running do
        -- Drain all pending outgoing messages
        while true do
            local msg = sendCh:pop()
            if not msg then break end
            if msg == "WS_CLOSE" then
                pcall(function() ws_write(sock, "", 8) end)
                running = false
                break
            else
                local _, werr = ws_write(sock, msg)
                if werr then
                    recvCh:push("ERR:Send failed: " .. tostring(werr))
                    running = false
                    break
                end
            end
        end

        if not running then break end

        -- Wait up to 10ms for incoming data (reduced from 50ms for lower latency)
        local readable = socket.select({sock}, nil, 0.01)
        if readable and #readable > 0 then
            sock:settimeout(5)
            local opcode, payload = ws_read(sock)
            sock:settimeout(0)

            if opcode then
                if opcode == 1 or opcode == 0 then
                    recvCh:push("MSG:" .. payload)
                elseif opcode == 8 then
                    recvCh:push("WS_CLOSE")
                    running = false
                elseif opcode == 9 then
                    ws_write(sock, payload or "", 10)
                end
            else
                if payload and payload ~= "timeout" and payload ~= "wantread" then
                    recvCh:push("ERR:" .. tostring(payload))
                    running = false
                end
            end
        end
    end

    pcall(function() sock:close() end)
]]

-- =========================================================================
-- Socket.IO Client (WebSocket primary, polling fallback)
-- =========================================================================

local Client = {}
Client.__index = Client

function Client.new()
    local self = setmetatable({}, Client)
    self.host = nil
    self.port = nil
    self.sid = nil
    self.connected = false
    self.listeners = {}
    self.outQueue = {}
    self.state = "disconnected"
    self.error = nil
    self.baseUrl = nil
    self.authParams = {}
    self.pingInterval = 25
    self.pingTimer = 0
    -- WebSocket transport
    self.wsMode = false
    self.wsThread = nil
    self.wsSendCh = nil
    self.wsRecvCh = nil
    -- Polling fallback (kept for compat)
    self.polling = false
    self.sending = false
    return self
end

function Client:on(event, callback)
    if not self.listeners[event] then self.listeners[event] = {} end
    table.insert(self.listeners[event], callback)
end

function Client:off(event, callback)
    if not callback then
        -- Remove all listeners for this event
        self.listeners[event] = nil
    else
        -- Remove only the specific callback
        local cbs = self.listeners[event]
        if cbs then
            for i = #cbs, 1, -1 do
                if cbs[i] == callback then
                    table.remove(cbs, i)
                end
            end
            if #cbs == 0 then self.listeners[event] = nil end
        end
    end
end

function Client:_emit(event, ...)
    local callbacks = self.listeners[event]
    if callbacks then
        for _, cb in ipairs(callbacks) do
            local ok, err = pcall(cb, ...)
            if not ok then
                print("[net] Event handler error (" .. tostring(event) .. "): " .. tostring(err))
            end
        end
    end
end

function Client:_sendRaw(packet)
    if self.wsMode and self.wsSendCh then
        self.wsSendCh:push(packet)
    else
        table.insert(self.outQueue, packet)
    end
end

function Client:connect(host, port, authParams)
    self.host = host
    self.port = port
    self.authParams = authParams or {}
    self.baseUrl = "http://" .. host .. ":" .. port
    self.state = "handshaking"
    self.error = nil
    self.sid = nil
    self.connected = false
    self.outQueue = {}
    self.pingTimer = 0
    self.polling = false
    self.sending = false

    -- Use WebSocket transport
    self.wsMode = true
    self.wsSendCh = love.thread.newChannel()
    self.wsRecvCh = love.thread.newChannel()
    self.connectTimeout = 10  -- seconds to wait for connection
    self.connectTimer = 0

    -- Store for reconnection
    if self._reconnect then
        self._reconnect.lastHost = host
        self._reconnect.lastPort = port
        self._reconnect.lastAuth = authParams
    end

    local wsPath = "/socket.io/?EIO=4&transport=websocket"
    print("[net] WebSocket connecting to " .. host .. ":" .. port)

    self.wsThread = love.thread.newThread(WS_WORKER_CODE)
    self.wsThread:start(host, tonumber(port), wsPath, self.wsSendCh, self.wsRecvCh)

    return true
end

function Client:disconnect()
    if self.wsMode then
        if self.connected then
            self:_sendRaw("41") -- Socket.IO disconnect
        end
        if self.wsSendCh then
            self.wsSendCh:push("WS_CLOSE")
        end
    else
        if self.sid and self.connected then
            local url = self.baseUrl .. "/socket.io/?EIO=4&transport=polling&sid=" .. urlencode(self.sid) .. "&t=" .. tostring(love.timer.getTime())
            asyncPost(url, "41", function() end)
        end
    end
    self.state = "disconnected"
    self.connected = false
    self.sid = nil
    self.polling = false
    self.sending = false
    self.wsMode = false
    self:_emit("disconnect", "client")
end

-- Reconnection state machine with exponential backoff + jitter
function Client:enableReconnect(maxAttempts, baseDelay, maxDelay, jitterFactor)
    self._reconnect = {
        enabled = true,
        maxAttempts = maxAttempts or 10,
        baseDelay = baseDelay or 1,      -- seconds
        maxDelay = maxDelay or 30,        -- seconds
        jitterFactor = jitterFactor or 0.25,
        attempt = 0,
        timer = 0,
        waiting = false,
        lastHost = nil,
        lastPort = nil,
        lastAuth = nil,
    }
end

function Client:disableReconnect()
    if self._reconnect then
        self._reconnect.enabled = false
        self._reconnect.waiting = false
        self._reconnect.attempt = 0
    end
end

function Client:_startReconnect(reason)
    if not self._reconnect or not self._reconnect.enabled then return end
    if self._reconnect.attempt >= self._reconnect.maxAttempts then
        self:_emit("reconnect_failed", "Max attempts (" .. self._reconnect.maxAttempts .. ") reached")
        return
    end
    self._reconnect.attempt = self._reconnect.attempt + 1
    -- Exponential backoff: base * 2^(attempt-1), capped at maxDelay
    local delay = math.min(
        self._reconnect.baseDelay * (2 ^ (self._reconnect.attempt - 1)),
        self._reconnect.maxDelay
    )
    -- Add jitter: +/- jitterFactor * delay
    local jitter = (math.random() * 2 - 1) * self._reconnect.jitterFactor * delay
    delay = math.max(0.5, delay + jitter)
    self._reconnect.timer = delay
    self._reconnect.waiting = true
    self:_emit("reconnecting", {
        attempt = self._reconnect.attempt,
        maxAttempts = self._reconnect.maxAttempts,
        delay = delay,
        reason = reason,
    })
    print("[net] Reconnecting in " .. string.format("%.1f", delay) .. "s (attempt " .. self._reconnect.attempt .. "/" .. self._reconnect.maxAttempts .. ")")
end

function Client:_updateReconnect(dt)
    if not self._reconnect or not self._reconnect.waiting then return end
    self._reconnect.timer = self._reconnect.timer - dt
    if self._reconnect.timer <= 0 then
        self._reconnect.waiting = false
        local host = self._reconnect.lastHost or self.host
        local port = self._reconnect.lastPort or self.port
        local auth = self._reconnect.lastAuth or self.authParams
        if host and port then
            self:connect(host, port, auth)
        end
    end
end

function Client:emit(event, data)
    if not self.connected then return false end
    local payload
    if data ~= nil then
        payload = json.encode({event, data})
    else
        payload = json.encode({event})
    end
    self:_sendRaw("42" .. payload)
    return true
end

-- Polling methods (kept for backward compat, not used in WS mode)

function Client:_startPoll()
    if self.polling then return end
    if self.state == "disconnected" then return end
    if not self.sid then return end

    self.polling = true
    self.pollCount = (self.pollCount or 0) + 1
    local pollNum = self.pollCount
    local url = self.baseUrl .. "/socket.io/?EIO=4&transport=polling&sid=" .. urlencode(self.sid) .. "&t=" .. tostring(love.timer.getTime()) .. "." .. self.pollCount

    asyncGet(url, function(body, err)
        self.polling = false
        if self.state == "disconnected" then return end

        if not body then
            if self.connected then
                self.connected = false
                self.state = "disconnected"
                self:_emit("disconnect", "poll error: " .. tostring(err))
            elseif self.state == "connecting" then
                self.state = "disconnected"
                self:_emit("connect_error", "Poll failed: " .. tostring(err))
            end
            return
        end

        local packets
        if body:find("\30") then
            packets = {}
            for pkt in body:gmatch("[^\30]+") do table.insert(packets, pkt) end
        else
            packets = { body }
        end

        for _, pkt in ipairs(packets) do
            self:_handleEnginePacket(pkt)
        end

        if self.state ~= "disconnected" then
            self:_startPoll()
        end
    end, 35)
end

function Client:_flushOutQueue()
    if #self.outQueue == 0 then return end
    if self.sending then return end
    if not self.sid or self.state == "disconnected" then return end

    self.sending = true
    self.pollCount = (self.pollCount or 0) + 1
    local url = self.baseUrl .. "/socket.io/?EIO=4&transport=polling&sid=" .. urlencode(self.sid) .. "&t=" .. tostring(love.timer.getTime()) .. "." .. self.pollCount
    local body = (#self.outQueue == 1) and self.outQueue[1] or table.concat(self.outQueue, "\30")
    self.outQueue = {}

    asyncPost(url, body, function(resp, err)
        self.sending = false
        if not resp and self.connected then
            self.connected = false
            self.state = "disconnected"
            self:_emit("disconnect", "send error: " .. tostring(err))
        end
    end)
end

-- Engine.IO packet handler

function Client:_handleEnginePacket(pkt)
    if #pkt == 0 then return end
    local eType = pkt:sub(1, 1)

    if eType == "0" then
        -- Engine.IO OPEN — contains SID and config (WebSocket mode)
        local jsonStr = pkt:sub(2)
        local handshake = json.decode(jsonStr)
        if handshake and handshake.sid then
            self.sid = handshake.sid
            self.pingInterval = (handshake.pingInterval or 25000) / 1000
            print("[net] Got SID=" .. self.sid .. " pingInterval=" .. self.pingInterval)

            -- Send Socket.IO connect
            local connectPayload = "40"
            if next(self.authParams) then
                connectPayload = "40" .. json.encode(self.authParams)
            end
            self:_sendRaw(connectPayload)
        end
    elseif eType == "2" then
        -- Server PING -> respond with PONG
        self:_sendRaw("3")
    elseif eType == "4" then
        self:_handleSocketPacket(pkt:sub(2))
    elseif eType == "1" then
        -- Engine.IO CLOSE
        self.connected = false
        self.state = "disconnected"
        self:_emit("disconnect", "server close")
    elseif eType == "6" then
        -- NOOP
    end
end

function Client:_handleSocketPacket(pkt)
    if #pkt == 0 then return end
    local sType = pkt:sub(1, 1)

    if sType == "0" then
        print("[net] SIO CONNECT ack")
        self.connected = true
        self.state = "connected"
        -- Reset reconnection state on successful connect
        if self._reconnect then
            self._reconnect.attempt = 0
            self._reconnect.waiting = false
        end
        local data = (#pkt > 1) and json.decode(pkt:sub(2)) or nil
        self:_emit("connect", data)
    elseif sType == "1" then
        print("[net] SIO DISCONNECT from server")
        self.connected = false
        self.state = "disconnected"
        self:_emit("disconnect", "server disconnect")
    elseif sType == "2" then
        local payload = pkt:sub(2)
        local jsonStart = payload:find("%[")
        if jsonStart then
            local ok, arr = pcall(json.decode, payload:sub(jsonStart))
            if not ok then
                print("[net] JSON decode error: " .. tostring(arr) .. " (payload len=" .. #payload .. ")")
            elseif arr and type(arr) == "table" and #arr >= 1 then
                self:_emit(arr[1], arr[2])
            else
                print("[net] SIO event with unexpected shape (payload len=" .. #payload .. ")")
            end
        else
            print("[net] SIO event missing JSON array (payload=" .. payload:sub(1, 80) .. ")")
        end
    elseif sType == "4" then
        local errData = (#pkt > 1) and json.decode(pkt:sub(2)) or nil
        self:_emit("connect_error", errData)
    end
end

function Client:update(dt)
    -- Handle reconnection timer when disconnected
    if self.state == "disconnected" then
        self:_updateReconnect(dt)
        return
    end

    -- Connect timeout: if still handshaking after connectTimeout seconds, abort
    if self.state == "handshaking" and self.connectTimeout then
        self.connectTimer = (self.connectTimer or 0) + dt
        if self.connectTimer >= self.connectTimeout then
            print("[net] Connect timeout after " .. self.connectTimeout .. "s")
            self.state = "disconnected"
            self.connected = false
            if self.wsSendCh then self.wsSendCh:push("WS_CLOSE") end
            self:_emit("connect_error", "Connection timeout")
            self:_startReconnect("timeout")
            return
        end
    end

    if self.wsMode then
        -- Process messages from WebSocket worker thread
        local maxPerFrame = 50
        local count = 0
        while count < maxPerFrame do
            local msg = self.wsRecvCh:pop()
            if not msg then break end
            count = count + 1

            if msg == "WS_OPEN" then
                print("[net] WebSocket connected, waiting for EIO open")
            elseif msg == "WS_CLOSE" then
                print("[net] WebSocket closed")
                self.connected = false
                self.state = "disconnected"
                self:_emit("disconnect", "websocket closed")
                self:_startReconnect("websocket closed")
                return
            elseif msg:sub(1, 4) == "ERR:" then
                local errMsg = msg:sub(5)
                print("[net] WS error: " .. errMsg)
                if self.connected then
                    self.connected = false
                    self.state = "disconnected"
                    self:_emit("disconnect", "ws error: " .. errMsg)
                    self:_startReconnect("ws error")
                else
                    self.state = "disconnected"
                    self.error = errMsg
                    self:_emit("connect_error", errMsg)
                    self:_startReconnect("connect error")
                end
                return
            elseif msg:sub(1, 4) == "MSG:" then
                self:_handleEnginePacket(msg:sub(5))
            end
        end

        -- Check if worker thread crashed
        if self.wsThread and not self.wsThread:isRunning() then
            local threadErr = self.wsThread:getError()
            if threadErr and self.state ~= "disconnected" then
                print("[net] WS thread crashed: " .. tostring(threadErr))
                self.connected = false
                self.state = "disconnected"
                self:_emit("disconnect", "ws thread error")
                self:_startReconnect("thread crash")
            end
        end
    else
        -- Polling mode
        if self.connected and #self.outQueue > 0 then
            self:_flushOutQueue()
        end
    end
end

-- =========================================================================
-- Public API
-- =========================================================================
local M = {}
M.Client = Client
M.json = json
M.asyncGet = asyncGet
M.asyncPost = asyncPost

function M.update()
    updateHttp()
end

function M.fetchChallenge(host, port, challengeType, callback)
    local url = "http://" .. host .. ":" .. port .. "/api/pow/challenge?type=" .. (challengeType or "connect")
    asyncGet(url, function(body, err)
        if not body then callback(nil, err) else callback(json.decode(body)) end
    end)
end

function M.fetchHealth(host, port, callback, timeout)
    local url = "http://" .. host .. ":" .. port .. "/api/health"
    asyncGet(url, function(body, err)
        if not body then callback(nil, err) else callback(json.decode(body)) end
    end, timeout)
end

-- Fetch shard list from master server
function M.fetchShardList(masterHost, masterPort, callback)
    local url = "http://" .. masterHost .. ":" .. masterPort .. "/api/shards"
    asyncGet(url, function(body, err)
        if not body then callback(nil, err) else
            local data = json.decode(body)
            if data and data.shards then
                callback(data.shards, nil)
            else
                callback(nil, "Invalid response")
            end
        end
    end)
end

return M

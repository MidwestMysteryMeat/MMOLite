-- game-handlers/vip.lua
-- VIP status, sovereign currency, and Sovereign Shop events

local M = {}

M.EVENTS = {
    "vip_status_result", "vip_error", "vip_token_consumed",
    "vip_sovereign_shop_result", "vip_sovereign_purchased",
}

function M.register(client, game)
    client:on("vip_status_result", function(data)
        if not data then return end
        game._vip.tier               = data.tier or "free"
        game._vip.expiresAt          = data.expiresAt or 0
        game._vip.sovereignBalance   = data.sovereignBalance or 0
        game._vip.tokenInventory     = data.tokenInventory or 0
        game._vip.permanentPurchases = data.permanentPurchases or {}
        game._vip.perks              = data.perks or {}
    end)

    client:on("vip_error", function(data)
        if not data then return end
        game._vip.message      = data.message or "VIP error"
        game._vip.messageTimer = 3.0
    end)

    client:on("vip_token_consumed", function(data)
        if not data then return end
        game._vip.tier           = data.tier or "vip"
        game._vip.expiresAt      = data.expiresAt or 0
        game._vip.tokenInventory = data.tokenInventory or 0
        game._vip.message        = "VIP activated! Enjoy your benefits."
        game._vip.messageTimer   = 4.0
    end)

    client:on("vip_sovereign_shop_result", function(data)
        if not data then return end
        game._vip.shopItems = data.items or {}
    end)

    client:on("vip_sovereign_purchased", function(data)
        if not data then return end
        game._vip.sovereignBalance   = data.sovereignBalance or 0
        game._vip.permanentPurchases = data.permanentPurchases or {}
        game._vip.shopItems          = {}  -- cleared; re-fetched on next shop tab open
        game._vip.message            = "Purchase complete!"
        game._vip.messageTimer       = 3.0
    end)
end

return M

package.path = "client/?.lua;client/?/init.lua;" .. package.path

local manifest = [[
{
  "sheets": ["probe_00.png"],
  "frames": {
    "probe_idle": {
      "sheet": 0,
      "frame": {"x": 0, "y": 0, "w": 16, "h": 16},
      "source": {"w": 16, "h": 16}
    }
  },
  "animations": {"probe_idle": ["probe_idle"]}
}
]]

local image = {
    getDimensions = function() return 16, 16 end,
    setFilter = function() end,
    release = function() end,
}

love = {
    filesystem = {
        read = function(path)
            assert(path == "assets/sprites/probe/probe.json")
            return manifest
        end,
    },
    graphics = {
        newImage = function(path)
            assert(path == "assets/sprites/probe/probe_00.png")
            return image
        end,
        newQuad = function(x, y, w, h, iw, ih)
            return { x = x, y = y, w = w, h = h, iw = iw, ih = ih }
        end,
        draw = function() end,
    },
}

local SpriteSheet = require("lib.sprite-sheet")
local sprite = SpriteSheet.load("assets/sprites/probe")

assert(sprite.name == "probe")
assert(sprite.images[1] == image)
assert(sprite.animations.probe_idle.frames[1].frame_w == 16)

SpriteSheet.play(sprite, "probe_idle")
SpriteSheet.update(sprite, 0.25)
assert(sprite._frame == 1)

print("sprite-sheet loader: OK")

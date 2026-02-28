function love.conf(t)
    t.identity = "MMOLite"  -- Explicit save directory name (consistent between fused/unfused)
    t.title = "MMOLite"
    t.version = "11.5"
    t.window.width = 1024
    t.window.height = 768
    t.window.resizable = true
    t.window.minwidth = 800
    t.window.minheight = 600
    t.window.vsync = 1

    t.modules.joystick = false
    t.modules.physics = false
    t.modules.video = false
end

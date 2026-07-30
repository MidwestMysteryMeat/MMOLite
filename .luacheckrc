-- Static analysis config for the LÖVE client.
--
--   luacheck client     -- must exit with 0 warnings/errors
--
-- Keep this a correctness gate. The client predates a formatter, so interface
-- arguments, intentionally unused locals, and line length are not enforced.

std = "lua51+love"
cache = true
codes = true

exclude_files = {
    "client/assets/**",
}

ignore = {
    "211", -- unused local; common in optional feature modules
    "212", -- unused argument; callbacks and scene interfaces share signatures
    "213", -- unused loop variable; idiomatic `for _, value in ...`
    "542", -- empty branch used as an explicit no-op
}

max_line_length = false

files["client/main.lua"] = { allow_defined_top = true }
files["client/conf.lua"] = { globals = { "love" } }

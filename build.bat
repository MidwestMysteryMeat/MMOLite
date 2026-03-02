@echo off
setlocal enabledelayedexpansion

echo ============================================
echo   MMOLite Build Script
echo   Packaging for testers (Windows)
echo ============================================
echo.

:: ── Step 0: Verify we're in the right place ──
if not exist "server.js" (
    echo ERROR: server.js not found. Run this script from the MMOLite project root.
    exit /b 1
)
if not exist "love.exe" (
    echo ERROR: love.exe not found in project root.
    exit /b 1
)
if not exist "client\main.lua" (
    echo ERROR: client\main.lua not found.
    exit /b 1
)

:: ── Step 1: Clean previous build (preserve player data) ──
echo [1/8] Cleaning previous build...
if exist "build\MMOLite\data" (
    echo        Preserving player data...
    if exist "_build_data_backup" rmdir /s /q "_build_data_backup"
    move "build\MMOLite\data" "_build_data_backup" >nul 2>nul
)
if exist "build" rmdir /s /q "build"

:: ── Step 2: Create .love file (zip of client/ contents) ──
echo [2/8] Creating MMOLite.love...
:: Remove stale .love file if present
if exist "MMOLite.love" del "MMOLite.love"
powershell -NoProfile -Command "Add-Type -Assembly 'System.IO.Compression.FileSystem'; [System.IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $PWD 'client'), (Join-Path $PWD 'MMOLite.zip'), [System.IO.Compression.CompressionLevel]::Fastest, $false)"
:: Rename .zip to .love
rename "MMOLite.zip" "MMOLite.love"
if not exist "MMOLite.love" (
    echo ERROR: Failed to create MMOLite.love
    exit /b 1
)

:: ── Step 3: Create build folder and fuse exe ──
echo [3/8] Fusing MMOLite.exe...
mkdir "build\MMOLite"
copy /b "love.exe"+"MMOLite.love" "build\MMOLite\MMOLite.exe" >nul
if not exist "build\MMOLite\MMOLite.exe" (
    echo ERROR: Failed to fuse MMOLite.exe
    exit /b 1
)
:: Clean up temp .love file
del "MMOLite.love"

:: Restore preserved player data from previous build
if exist "_build_data_backup" (
    echo        Restoring player data...
    move "_build_data_backup" "build\MMOLite\data" >nul 2>nul
)

:: ── Step 4: Copy LOVE runtime DLLs ──
echo [4/8] Copying LOVE runtime DLLs...
for %%F in (love.dll SDL2.dll OpenAL32.dll lua51.dll mpg123.dll msvcp120.dll msvcr120.dll) do (
    if exist "%%F" (
        copy "%%F" "build\MMOLite\" >nul
    ) else (
        echo WARNING: %%F not found, skipping.
    )
)

:: ── Step 4b: Copy Steam libraries (optional) ──
if exist "client\steam-libs\win64" (
    echo        Copying Steam libraries...
    for %%F in (client\steam-libs\win64\*.dll) do (
        copy "%%F" "build\MMOLite\" >nul
    )
)
if exist "client\steam-libs\steam_appid.txt" (
    copy "client\steam-libs\steam_appid.txt" "build\MMOLite\" >nul
)

:: ── Step 5: Bundle and minify server files (hides source code) ──
echo [5/8] Bundling server files (esbuild)...
:: Bundle server.js + all dependencies into a single minified file
call npx --yes esbuild server.js --bundle --platform=node --target=node18 --minify --outfile="build\MMOLite\server.js" --external:worker_threads 2>nul
if errorlevel 1 (
    echo ERROR: esbuild failed to bundle server.js
    exit /b 1
)
echo        Server code bundled into single minified file.

:: ── Step 6: Skip npm install (all dependencies bundled by esbuild) ──
echo [6/8] Dependencies bundled — no npm install needed.

:: ── Step 7: Copy config and asset files ──
echo [7/8] Copying configs and assets...
if exist "license.txt" copy "license.txt" "build\MMOLite\" >nul
if exist "readme.txt" copy "readme.txt" "build\MMOLite\" >nul
if exist "local-server-config.json" copy "local-server-config.json" "build\MMOLite\" >nul
:: shard-config.json is intentionally NOT copied (it's for production servers
:: and causes the local server to try heartbeating to a non-existent master).
if exist "game.ico" copy "game.ico" "build\MMOLite\" >nul

:: ── Step 8: Bundle node.exe (optional) ──
echo [8/8] Checking for portable node.exe...
if exist "..\node.exe" (
    copy "..\node.exe" "build\MMOLite\" >nul
    echo        Found node.exe next to project — bundled.
) else if exist "node.exe" (
    copy "node.exe" "build\MMOLite\" >nul
    echo        Found node.exe in project root — bundled.
) else (
    :: Try to copy from system Node.js installation
    where node.exe >nul 2>nul
    if not errorlevel 1 (
        for /f "delims=" %%P in ('where node.exe') do (
            copy "%%P" "build\MMOLite\" >nul
            echo        Copied node.exe from system PATH.
            goto :node_done
        )
    )
    echo        NOTE: node.exe not found. Testers will need Node.js on PATH
    echo        to host a local server.
)
:node_done

:: ── Done ──
echo.
echo ============================================
echo   Build complete!
echo   Output: build\MMOLite\
echo.
echo   Testers: double-click MMOLite.exe to play.
echo   To distribute: zip the build\MMOLite folder.
echo ============================================

endlocal

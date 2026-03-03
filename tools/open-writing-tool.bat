@echo off
setlocal

set "TOKEN_FILE=%~dp0..\data\writing_tool_token.txt"

if not exist "%TOKEN_FILE%" (
    echo Token file not found. Is the server running at least once?
    echo Expected: %TOKEN_FILE%
    pause
    exit /b 1
)

for /f "usebackq delims=" %%T in ("%TOKEN_FILE%") do set "TOKEN=%%T"

if "%TOKEN%"=="" (
    echo Token file is empty.
    pause
    exit /b 1
)

set "PORT=3001"
start "" "http://localhost:%PORT%/%TOKEN%/writing-tool"

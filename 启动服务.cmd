@echo off
setlocal
cd /d "%~dp0"
set "MM_PORT=8794"
set "MM_STORAGE_DIR=%~dp0storage\maps"
echo Open http://127.0.0.1:8794/ in your browser.
node server.js
pause

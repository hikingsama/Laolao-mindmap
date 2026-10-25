@echo off
setlocal
chcp 65001 >nul
if not defined MM_PORT set "MM_PORT=8796"
if not defined MM_STORAGE_DIR set "MM_STORAGE_DIR=%~dp0storage\maps"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.13 or later is required. Please install Node.js, then try again.
  pause
  exit /b 1
)
pushd "%TEMP%"
node "%~dp0tools\launch-service.cjs"
set "MM_LAUNCH_EXIT=%ERRORLEVEL%"
popd
if not "%MM_LAUNCH_EXIT%"=="0" pause
exit /b %MM_LAUNCH_EXIT%

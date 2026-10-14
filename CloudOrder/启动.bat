@echo off
chcp 65001 >nul
title 穿搭管家
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 18.17 或更高版本：
  echo        https://nodejs.org/
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
echo 使用 Node %NODEVER%
echo.

node src/index.js %*
pause

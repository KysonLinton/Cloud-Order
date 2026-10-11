@echo off
chcp 65001 >nul
title MiniAgent 网页版
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [错误] 未检测到 Node.js，请先安装： https://nodejs.org/
  echo.
  pause
  exit /b 1
)

netstat -ano | findstr ":8787" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo MiniAgent 已在运行，正在打开浏览器...
  start "" "http://127.0.0.1:8787"
  timeout /t 2 >nul
  exit /b 0
)

echo.
echo   MiniAgent 网页版启动中...
echo   浏览器会自动打开 http://127.0.0.1:8787
echo   关闭此窗口或按 Ctrl+C 可停止服务。
echo.

node src/index.js --web --port 8787

echo.
echo 服务已停止。
pause

@echo off
chcp 65001 >nul
title 穿搭管家 网页版
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [错误] 未检测到 Node.js，请先安装： https://nodejs.org/
  echo.
  pause
  exit /b 1
)

rem 直接双击 = 默认 8787；也可带端口参数： 启动网页版.bat 9000
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8787"

rem 已在运行则只打开浏览器，不重复启动服务
netstat -ano | findstr ":%PORT%" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo 穿搭管家已在运行，正在打开浏览器...
  start "" "http://127.0.0.1:%PORT%"
  timeout /t 2 >nul
  exit /b 0
)

echo.
echo   穿搭管家 网页版启动中...
echo   浏览器会自动打开 http://127.0.0.1:%PORT%
echo   关闭此窗口或按 Ctrl+C 可停止服务。
echo.

node src/index.js --web --port %PORT%

echo.
echo 服务已停止。
pause

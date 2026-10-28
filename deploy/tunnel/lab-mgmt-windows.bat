@echo off
chcp 65001 >nul
setlocal

REM ====================================================================
REM  实验室管理台 · 一键访问（Windows）
REM  双击本文件：先建 SSH 隧道，再自动打开浏览器。
REM
REM  第一次用只改 SSH_TARGET 这一行：
REM    · 有 ~/.ssh/config 别名（推荐）：填别名，例如  guotosky
REM    · 没有别名：填 用户名@服务器地址，并在 SSH_EXTRA 里补端口/密钥
REM ====================================================================
set SSH_TARGET=your.server.alias
set SSH_EXTRA=
REM  例：set SSH_TARGET=gz0548@your.server.com
REM      set SSH_EXTRA=-p 15041 -i C:\Users\%USERNAME%\.ssh\my_key

set APP_PORT=18447

echo 正在连接 %SSH_TARGET% %SSH_EXTRA% ...
echo （会弹出一个黑窗口，请保持它开着；关掉它就会断开连接）

start "lab-mgmt 隧道" ssh -N %SSH_EXTRA% -L %APP_PORT%:127.0.0.1:%APP_PORT% %SSH_TARGET%

echo 等待隧道建立（首次连接需要确认服务器指纹，请在黑窗口里输入 yes）...
timeout /t 6 /nobreak >nul

powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', %APP_PORT%); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo.
  echo [提示] 隧道还没通。请检查刚弹出的黑窗口：
  echo        1. 是否提示 Permission denied -^> 说明密钥/别名没配对
  echo        2. 是否提示端口已被占用 -^> 改上面的 APP_PORT
  pause
  exit /b 1
)

start "" http://localhost:%APP_PORT%/
echo 已打开 http://localhost:%APP_PORT%/  ，用完关掉那个黑窗口即可。
timeout /t 3 /nobreak >nul
endlocal

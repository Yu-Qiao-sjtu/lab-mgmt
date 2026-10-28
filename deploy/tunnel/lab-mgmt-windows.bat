@echo off
chcp 65001 >nul
setlocal

REM ====================================================================
REM  实验室管理台 · 一键访问（Windows）
REM  双击本文件：先建 SSH 隧道，再自动打开浏览器。
REM  第一次用：把下面 4 行改成你的服务器信息（让管理员给你一份即可）。
REM ====================================================================
set SSH_HOST=your.server.com
set SSH_PORT=22
set SSH_USER=yourname
set APP_PORT=18447

echo 正在连接 %SSH_USER%@%SSH_HOST%:%SSH_PORT% ...
echo （会弹出一个黑窗口，请保持它开着；关掉它就会断开连接）

start "lab-mgmt 隧道" ssh -N -p %SSH_PORT% -L %APP_PORT%:127.0.0.1:%APP_PORT% %SSH_USER%@%SSH_HOST%

echo 等待隧道建立（首次连接需要确认服务器指纹，请在黑窗口里输入 yes）...
timeout /t 5 /nobreak >nul

REM 探测一下端口通了没有
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', %APP_PORT%); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo.
  echo [提示] 隧道可能还没通。请检查刚弹出的黑窗口是否有报错或需要输入密码。
  echo        确认无误后，手动打开： http://localhost:%APP_PORT%/
  pause
  exit /b 1
)

start "" http://localhost:%APP_PORT%/
echo 已打开 http://localhost:%APP_PORT%/  ，用完关掉那个黑窗口即可。
timeout /t 3 /nobreak >nul
endlocal

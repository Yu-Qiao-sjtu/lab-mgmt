@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没有找到 Node.js。
  echo   请先到 https://nodejs.org 下载 LTS 版本安装，一路下一步即可，装完重新双击本文件。
  echo.
  pause
  exit /b 1
)

title 实验室管理台 · 多用户服务器
node server\index.js %*

echo.
echo 服务已停止。按任意键关闭窗口。
pause >nul

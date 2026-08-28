@echo off
cd /d "%~dp0"
set /p TAKEBOARD_REMOTE_HOST=请输入 SSH 主机名、IP 或 SSH 配置别名：
node scripts\takeboard-easy.mjs remote "%TAKEBOARD_REMOTE_HOST%"
pause

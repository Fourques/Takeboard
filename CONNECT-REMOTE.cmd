@echo off
cd /d "%~dp0"
set TAKEBOARD_REMOTE_HOST=
set /p TAKEBOARD_REMOTE_HOST=请输入 SSH 主机名、IP 或 SSH 别名（直接回车连接上次服务器）：
node scripts\takeboard-easy.mjs remote "%TAKEBOARD_REMOTE_HOST%"
pause

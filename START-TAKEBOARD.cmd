@echo off
cd /d "%~dp0"
node scripts\takeboard-easy.mjs start
if errorlevel 1 (
  echo.
  echo 启动失败。请根据上方提示处理，或运行 npm run easy:doctor
)
pause

@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo WordLens 正在启动...
echo 快捷键 Ctrl+Shift+W 唤起/收起翻译窗口
echo 托盘图标右键可退出

powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0hotkey.ps1"
if errorlevel 1 (
  echo.
  echo 启动失败，请查看 hotkey.log
  pause
)

@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在关闭 WordLens...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*hotkey.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*popup.html*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; if (Test-Path '%~dp0.hotkey.lock') { Remove-Item '%~dp0.hotkey.lock' -Force -ErrorAction SilentlyContinue }"

echo 已关闭 WordLens 热键与浮窗
timeout /t 2 >nul

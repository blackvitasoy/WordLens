@echo off
cd /d "%~dp0"
echo Stopping WordLens hotkey and popup...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*hotkey.ps1*' -and $_.CommandLine -notlike '*-NonInteractive*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*popup.html*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; if (Test-Path '%~dp0.hotkey.lock') { Remove-Item '%~dp0.hotkey.lock' -Force -ErrorAction SilentlyContinue }"

echo Stopped.
timeout /t 2 >nul

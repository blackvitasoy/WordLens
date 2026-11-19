@echo off
cd /d "%~dp0"
echo ============================================================
echo   WordLens - Hotkey Translation Popup
echo ============================================================
echo.
echo   First launch: a setup window will pop up. Press your
echo   preferred key combo (e.g. Ctrl+Shift+D) and click OK.
echo   Later launches use the saved hotkey automatically.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0hotkey.ps1"
if errorlevel 1 (
  echo.
  echo   Failed to start. See hotkey.log for details.
  pause
)

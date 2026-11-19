@echo off
title Fix FlClash - Disable Smart App Control
cd /d "%~dp0"

echo ============================================================
echo   Fix: FlClash blocked by Smart App Control (SAC)
echo ============================================================
echo.
echo   Diagnosis:
echo     - Cause: SAC enforcement mode; FlClash is NOT signed
echo     - System: Windows 11 25H2 (SAC can be re-enabled later)
echo     - This script needs admin rights. A UAC prompt will
echo       appear - please click YES.
echo.
pause

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix_sac.ps1"

echo.
echo   Done. Details: sac_fix.log
echo   Now double-click FlClash to verify.
echo   If still blocked, reboot once and try again.
echo.
pause

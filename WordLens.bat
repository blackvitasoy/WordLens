@echo off
REM WordLens desktop app launcher (ASCII only, avoids cmd codepage issues)
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launch.ps1"

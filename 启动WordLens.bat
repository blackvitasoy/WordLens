@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting WordLens...
node server.js
pause

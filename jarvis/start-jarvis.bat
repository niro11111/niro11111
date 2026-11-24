@echo off
rem Double-click to start JARVIS. Add --public for a real https address (needs cloudflared).
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22+ is required: https://nodejs.org & pause & exit /b 1)
node scripts\start.mjs %*
pause

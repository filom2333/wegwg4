@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js from https://nodejs.org & pause & exit /b)
if not exist node_modules call npm install
start "" http://localhost:5173
call npm run dev
pause

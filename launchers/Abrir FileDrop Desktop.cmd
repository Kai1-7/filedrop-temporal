@echo off
title FileDrop Desktop
cd /d "%~dp0"
cd ..

echo.
echo ==========================================
echo   FileDrop Desktop
echo ==========================================
echo.

set FILEDROP_MAX_SIZE=25gb
npm run desktop

echo.
echo FileDrop Desktop se cerro.
pause

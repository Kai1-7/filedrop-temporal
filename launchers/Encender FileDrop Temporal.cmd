@echo off
title FileDrop temporal
cd /d "%~dp0"
cd ..

echo.
echo ==========================================
echo   FileDrop temporal
echo ==========================================
echo.
echo Esta ventana mantiene encendida la app y el tunel publico.
echo Para apagarlo, cierra esta ventana.
echo.

npm run tunnel

echo.
echo FileDrop se cerro.
pause

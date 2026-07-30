@echo off
title Rockbar Jukebox
cd /d "%~dp0"

if not exist ".env" (
  echo No existe el archivo .env
  echo Copia .env.example como .env y completa los datos antes de continuar.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias por primera vez, un momento...
  call npm install
)

echo.
echo Iniciando Rockbar Jukebox...
echo Deja esta ventana abierta mientras el bar este funcionando.
echo Para cerrar, cerra esta ventana o presiona Ctrl+C.
echo.

node server.js

pause

@echo off
cd /d "%~dp0"
if exist .env (
  echo El archivo .env ya existe. No se modifico.
) else (
  copy .env.example .env >nul
  echo Se creo .env correctamente.
)
echo Abri .env con Visual Studio Code y pega tu Client Secret nuevo.
pause

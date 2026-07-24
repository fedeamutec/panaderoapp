#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ -f .env ]; then
  echo "El archivo .env ya existe. No se modificó."
else
  cp .env.example .env
  echo "Se creó .env correctamente."
fi
echo "Abrí .env con Visual Studio Code y pegá tu Client Secret nuevo."
printf "\nPresioná Enter para cerrar..."
read -r

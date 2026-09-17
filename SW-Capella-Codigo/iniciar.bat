@echo off
REM ============================================================
REM  Estudio Contable Capella - Inicio del sistema
REM
REM  Levanta el backend (puerto 5000) y el frontend (puerto 3000)
REM  en dos ventanas separadas, e instala las dependencias la
REM  primera vez.
REM
REM  Este archivo NO esta en el repositorio (esta en .gitignore).
REM  Si lo necesitas en otra PC, copialo a mano.
REM ============================================================

setlocal
cd /d "%~dp0"

echo.
echo   Estudio Contable Capella
echo   ------------------------
echo.

REM --- Verificar que Node este instalado ---
where node >nul 2>&1
if errorlevel 1 (
    echo   ERROR: Node no esta instalado o no esta en el PATH.
    echo   Descargalo de https://nodejs.org e instala la version LTS.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node --version') do set NODEVER=%%v
echo   Node %NODEVER%

REM --- Verificar que node:sqlite este disponible ---
REM  Llego en Node 22.5 detras de --experimental-sqlite y quedo
REM  habilitado sin flag desde la 23.4. Si falla, hay que
REM  actualizar Node o agregar el flag abajo.
node -e "require('node:sqlite')" >nul 2>&1
if errorlevel 1 (
    echo.
    echo   ERROR: esta version de Node no expone node:sqlite.
    echo   Opciones:
    echo     1^) Actualizar Node a la version 24 ^(recomendado^)
    echo     2^) Cambiar en este archivo "npm start" por
    echo        "node --experimental-sqlite server.js"
    echo.
    pause
    exit /b 1
)
echo   SQLite disponible

REM --- Instalar dependencias la primera vez ---
if not exist "backend\node_modules" (
    echo.
    echo   Instalando dependencias del backend, esto tarda un minuto...
    pushd backend
    call npm install --no-audit --no-fund
    popd
)

if not exist "frontend\node_modules" (
    echo.
    echo   Instalando dependencias del frontend, esto tarda unos minutos...
    pushd frontend
    call npm install --no-audit --no-fund
    popd
)

REM --- Arrancar ---
REM  Los dos servidores arrancan en ventanas OCULTAS, via PowerShell
REM  Start-Process -WindowStyle Hidden. No se usa "start /b" porque eso
REM  los ata a esta consola y mueren cuando se cierra.
REM
REM  Como no hay ventanas que cerrar, el sistema se detiene con
REM  detener.bat, que esta en esta misma carpeta.
echo.
echo   Iniciando backend en el puerto 5000...
powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm start' -WorkingDirectory '%~dp0backend' -WindowStyle Hidden"

REM  Darle unos segundos al backend antes de levantar el frontend.
timeout /t 4 /nobreak >nul

echo   Iniciando frontend en el puerto 3000...
powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm start' -WorkingDirectory '%~dp0frontend' -WindowStyle Hidden"

echo.
echo   Listo. El navegador se abre solo en unos segundos.
echo.
echo   Si no se abre: http://localhost:3000
echo   Desde otra PC de la red: http://^<ip-de-esta-pc^>:3000
echo.
echo   El sistema corre en segundo plano, sin ventanas visibles.
echo   Para detenerlo, ejecuta detener.bat en esta misma carpeta.
echo.

timeout /t 6 /nobreak >nul
endlocal

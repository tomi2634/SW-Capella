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
REM  Las ventanas quedan visibles y minimizadas a proposito: si algo
REM  falla, el error se puede leer. Para ocultarlas por completo,
REM  cambia /min por /b en las dos lineas de abajo.
echo.
echo   Iniciando backend en el puerto 5000...
start "Capella - Backend" /min cmd /c "cd /d "%~dp0backend" && npm start"

REM  Darle unos segundos al backend antes de levantar el frontend.
timeout /t 4 /nobreak >nul

echo   Iniciando frontend en el puerto 3000...
start "Capella - Frontend" /min cmd /c "cd /d "%~dp0frontend" && npm start"

echo.
echo   Listo. El navegador se abre solo en unos segundos.
echo.
echo   Si no se abre: http://localhost:3000
echo   Desde otra PC de la red: http://^<ip-de-esta-pc^>:3000
echo.
echo   Para cerrar el sistema, cerra las dos ventanas
echo   "Capella - Backend" y "Capella - Frontend".
echo.

timeout /t 6 /nobreak >nul
endlocal

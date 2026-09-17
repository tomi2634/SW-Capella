@echo off
REM ============================================================
REM  Estudio Contable Capella - Detener el sistema
REM
REM  Como iniciar.bat arranca los servidores en ventanas ocultas,
REM  no hay ninguna ventana que cerrar. Este script los detiene.
REM
REM  Solo mata lo que escucha en los puertos 5000 y 3000, y los
REM  procesos node que arrancaron desde esta carpeta. No toca otros
REM  Node que tengas corriendo por tu cuenta.
REM ============================================================

setlocal
cd /d "%~dp0"

echo.
echo   Deteniendo el sistema Capella...
echo.

REM  Todo en una sola linea a proposito: la continuacion con ^ y el
REM  escape de tuberias ^| dentro de un .bat son una fuente conocida
REM  de errores de parseo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$base='%~dp0'; $n=0; foreach ($puerto in 5000,3000) { $cons=@(Get-NetTCPConnection -State Listen -LocalPort $puerto -ErrorAction SilentlyContinue); foreach ($c in $cons) { try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction Stop; $n++; Write-Host ('   puerto ' + $puerto + ': detenido') } catch {} } }; $procs=@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" -ErrorAction SilentlyContinue); foreach ($p in $procs) { if ($p.CommandLine -and $p.CommandLine.Contains($base)) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $n++ } catch {} } }; if ($n -eq 0) { Write-Host '   No habia nada corriendo.' } else { Write-Host ('   Listo: ' + $n + ' proceso(s) detenido(s).') }"

echo.
REM  ping en vez de timeout: timeout falla si la entrada esta redirigida.
ping -n 3 127.0.0.1 >nul
endlocal

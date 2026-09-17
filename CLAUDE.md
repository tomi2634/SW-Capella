# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Estado actual:** la migración de Excel a SQLite está completa y vive en la rama
> **`migracion-sqlite`** (15 commits, 40/40 pruebas). **Todavía no está mergeada a `main`.**
> Este archivo describe la arquitectura **post-migración**. Si estás parado en `main`, el backend
> todavía usa los tres `.xlsx` — ver "Arquitectura anterior" al final.
> El cutover con los datos reales del estudio aún no se hizo: el procedimiento está en
> `docs/runbook-cutover-sqlite.md` (no versionado).

## Project Overview

**SW-Capella** is a standalone management system for "Estudio Contable Capella" (accounting firm, Argentina). It handles client management (two types: monthly *honorarios* and one-time *particular* work), payment tracking (cash, transfer, cheque, combinations), PDF receipt generation, and dynamic debt calculation.

It runs on a single Windows PC in a local network — no cloud, no authentication.

## Repository Layout

All code lives under **`SW-Capella-Codigo/`**, not the repo root. Run every command from there.

```
SW-Capella/
├── CLAUDE.md
├── CONTEXTO_PROYECTO_IA.md          # Contexto en español — NO versionado (gitignored)
├── docs/superpowers/
│   ├── specs/2026-09-16-migracion-sqlite-design.md   # Diseño de la migración
│   └── plans/2026-09-16-migracion-sqlite.md          # Plan de implementación
└── SW-Capella-Codigo/
    ├── backend/                     # Express API (port 5000)
    ├── frontend/                    # Create React App SPA (port 3000 in dev)
    ├── Trabajos Estudio Capella/    # Receipt PDFs + counter/index JSON
    ├── data/                        # capella.db — NOT tracked, created on first run
    ├── backups/                     # Daily ZIPs — NOT tracked
    └── iniciar.bat                  # One-click startup — gitignored, not in this checkout
```

`data/`, `backups/` and `iniciar.bat` are absent from a fresh clone. `iniciar.bat` must be recreated by hand (it launches both dev servers via PowerShell `Start-Process`).

## Commands

```bash
cd SW-Capella-Codigo/backend  && npm install && npm start     # API on :5000
cd SW-Capella-Codigo/frontend && npm install && npm start     # Dev server on :3000

cd SW-Capella-Codigo/frontend && npm run build                # Production build → build/
cd SW-Capella-Codigo/frontend && npm test                     # react-scripts test (watch mode)

cd SW-Capella-Codigo/backend && node test-migracion.js        # Suite del backend: debe dar 40/40
cd SW-Capella-Codigo/backend && node bench-pagos.js           # Regresión de rendimiento (<50ms)
cd SW-Capella-Codigo/backend && node migrar-a-sqlite.js       # Migración xlsx → .db (UNA sola vez)
cd SW-Capella-Codigo/backend && npm run rebuild:historial     # Reconstruir la tabla historial
```

`test-migracion.js` no usa framework: es `node:assert` más un runner propio de ~20 líneas. Cada
prueba trabaja en un directorio temporal, así que es seguro correrla en cualquier momento — nunca
toca `data/`. El frontend no tiene tests propios todavía. No hay linter.

## Architecture

### Data layer — SQLite, sin dependencias

`data/capella.db` reemplaza a los tres `.xlsx`. El motor es **`node:sqlite`, incluido en el
runtime de Node**: no hay dependencia nueva ni módulo nativo que compilar.

- **`backend/db.js`** — abre la conexión, aplica PRAGMAs, crea el esquema y lo versiona con
  `user_version`. Expone `abrirDb(rutaDb)`, `enTransaccion(db, fn)` y `SCHEMA_VERSION`.
- **`backend/mappers.js`** — convierte filas SQL a los objetos que la API ya devolvía con Excel.
  Acá vive el contrato de salida, y tiene rarezas deliberadas que **no hay que "arreglar"**:
  `reciboNumero` usa `|| null` (así un `0` también da `null`), los textos vacíos vuelven `''` y no
  `null`, y `getAllHistorial()` expone la clave `comisión` **con tilde** aunque la columna SQL se
  llame `comision`. El frontend espera exactamente eso.

Tres tablas: `clientes`, `pagos`, `historial`. Detalles que importan:

- **`pagos.clienteId` tiene `ON DELETE CASCADE`.** Borrar un cliente borra sus pagos y su historial
  automáticamente. Depende de `PRAGMA foreign_keys = ON`, que `abrirDb()` aplica en cada conexión;
  sin eso el borrado falla en silencio y quedan huérfanos.
- **`synchronous = FULL`**, porque son datos contables. **WAL está deliberadamente desactivado**:
  hay un solo proceso escritor y WAL complicaría el backup con archivos `-wal`/`-shm`.
- `honorariosProgramados` sigue siendo una **columna JSON**, no una tabla. Normalizarla es una
  mejora pendiente, deliberadamente postergada para no tocar lógica contable durante la migración.
- `totalAdeudado` y `mesesAdeudados` son **columnas cacheadas** que `recalculateClienteDeuda()`
  reescribe. La deuda real se calcula dinámicamente en JavaScript.

### La deuda se calcula, no se guarda

`_calcularFinanzasCliente()` es el corazón del sistema y **no cambió con la migración**: se portó
carácter por carácter. Reglas que no hay que romper:

- **Cobro a mes vencido:** los meses se generan desde `fechaCreacion` hasta el mes anterior al
  actual. El mes en curso nunca se adeuda.
- Honorario del mes = `honorariosProgramados[MM-YYYY]` si existe, si no el `honorario` base; después
  se aplica el interés mensual si `interesMensualActivo`.
- Los pagos con `estado === 'anulado'` se excluyen de todo cálculo.
- Lo pagado se aplica como saldo corrido, de los meses más viejos a los más nuevos.
- **Los clientes `particular` no pasan por nada de esto:** honorario fijo menos pagos activos.
- Todo importe se redondea con `Math.round(v * 100) / 100`.

### Backend (`SW-Capella-Codigo/backend/`)

- **`server.js`** (~1460 líneas) — rutas, gestión de archivos de recibos, backups ZIP diarios con
  retención (`BACKUP_RETENTION_MAX_FILES`, default 10). Puerto 5000 hardcodeado, escucha en `0.0.0.0`.
  El backup diario hace `VACUUM INTO` sobre la base antes de comprimir, para obtener un snapshot
  consistente sin bloquear escrituras.
- **`excelManager.js`** (~1200 líneas) — la clase `ExcelManager`. **El nombre quedó desalineado con
  su contenido:** ya no usa Excel, usa SQL. Se conservó para no tocar `server.js` durante la
  migración; renombrarlo es una mejora pendiente de una línea. Su constructor acepta una ruta de
  base opcional, que solo usan las pruebas para trabajar en un temporal.
- **`pdfGenerator.js`** — recibos A5 con `pdfkit`.
- **`legacy/excelManagerXlsx.js`** — copia congelada del lector Excel, **solo lectura**, usada por
  `migrar-a-sqlite.js` para verificar la migración. Se borra después del cutover.
- **`migrar-a-sqlite.js`** — script de una sola vez. Hace backup ZIP previo, traspasa los datos y
  corre 7 chequeos que comparan la contabilidad vieja contra la nueva al centavo. Se niega a pisar
  una base existente salvo `--force`.

Familias de rutas: `/api/clientes`, `/api/pagos`, `/api/historial`, `/api/resumen`,
`/api/generar-recibo`, `/api/recibos/*`, `/api/sync/:lastSync`, `/api/admin/*`, `/api/health`.

### Recibos en disco

Bajo `Trabajos Estudio Capella/`, separados en `Honorarios Estudio Capella/` y
`Trabajos Particulares Estudio Capella/`, con una carpeta por cliente. Los nombres siguen
`Recibo <n> <Cliente> ‖‖ Tipo de Pago (<Tipo>).pdf` — el separador `‖‖` es funcional, y anular
renombra el archivo con el prefijo `[ANULADO] `. Las rutas se sanitizan para Windows.

Estado auxiliar: `_contador_recibos.json` (numeración) y `_indice_carpetas_particulares.json`.
La migración a SQLite **no toca nada de esto**.

### Frontend (`SW-Capella-Codigo/frontend/`)

Create React App, tres pestañas: `ResumenTab.js`, `ClientesTab.js`, `PagosTab.js`. `App.js` hace
polling cada 5 s. El tema vive en variables CSS en `App.css` (`--color-primary: #1d3e8a`).

**La URL de la API es inconsistente — es una trampa conocida.** `App.js:8` respeta
`REACT_APP_API_BASE_URL` y cae a `http://<hostname>:5000/api`. `ClientesTab.js:4` y `PagosTab.js:4`
la hardcodean e ignoran la variable. `frontend/.env.example` anuncia `REACT_APP_API_URL`, que no lee
nadie. Cambiar el host de la API requiere editar los tres archivos.

## Convenciones

- El vocabulario del dominio, los textos de la interfaz y la mayoría de los comentarios están en
  español. Seguí esa convención.
- `node_modules/` no se versiona.
- **`data/`, `backups/`, `*.xlsx` y `*.db` están en `.gitignore`.** Contienen la contabilidad real
  del estudio y nunca deben subirse. Hay dos `.gitignore`: uno en la raíz y otro en
  `SW-Capella-Codigo/`. Nunca uses `git add -A` sin mirar antes qué vas a subir.
- `javascript-obfuscator` es devDependency del backend, para builds de distribución.

## Arquitectura anterior (rama `main`, pre-migración)

Hasta la migración, la persistencia eran tres archivos `.xlsx` en `data/` manejados con `exceljs`.
El problema que motivó el cambio: `exceljs` no puede agregar una fila, así que **cada pago reescribía
el archivo entero**. Medido: 98 ms con 500 pagos, 4.035 ms con 40.000, y el flujo completo de la
interfaz (pago + recibo) llegaba a **9.772 ms**. El costo crecía linealmente con el histórico, para
siempre. Con SQLite el mismo flujo tarda **5,2 ms**.

Si trabajás sobre `main`, la capa de datos usa `_loadWorkbookCache`, acceso posicional por columna
(`CLIENTE_COL` / `PAGO_COL`) y migraciones de esquema implícitas con `_ensure*SheetStructure`. Todo
eso desaparece en la rama `migracion-sqlite`.

# Plan de implementación: migración de SW-Capella a SQLite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar los tres archivos `.xlsx` por un único `data/capella.db` en SQLite, eliminando la reescritura de archivo completo que hace que registrar un pago tarde 9.772 ms con 40.000 pagos históricos.

**Architecture:** `ExcelManager` conserva su nombre, su clase y todas las firmas de sus métodos públicos; solo se reemplazan los internos por SQL. `server.js` queda prácticamente intacto: se tocan dos bloques y nada más (ver Global Constraints). La lógica contable (`_calcularFinanzasCliente`, `_getHonorarioBaseMes`, `_calcularHonorarioConInteres`, `_preservarHonorariosAnteriores`, `_buildMonthRange`, `formatearMes`) se copia carácter por carácter, sin cambios.

**Tech Stack:** Node.js 22+ con `node:sqlite` (incluido en el runtime, sin dependencias nuevas). Tests con `node:assert`, sin framework.

**Spec:** `docs/superpowers/specs/2026-09-16-migracion-sqlite-design.md`

## Global Constraints

- **Ninguna dependencia nueva.** Ni en `backend/package.json` ni instalada. Solo `node:sqlite`, `node:assert`, `node:fs`, `node:path`, `node:os`.
- **`server.js` se modifica en exactamente dos lugares, y en ningún otro:** el cuerpo de `POST /api/pagos` (Tarea 9) y el de `createDataZipBackup()` (Tarea 15). Cualquier otro cambio en ese archivo es señal de que algo se desvió del plan.
- **La lógica contable no se toca.** Si una tarea siente la necesidad de "mejorar" un cálculo de deuda, está mal: se porta idéntica.
- **Todo importe se redondea con `Math.round(v * 100) / 100`**, como hoy.
- **PRAGMAs obligatorios en cada conexión:** `foreign_keys = ON` y `synchronous = FULL`.
- **No se activa WAL.**
- **Los `.xlsx` son de solo lectura** para todo este plan. Ninguna tarea los modifica ni los borra.
- **Idioma:** nombres de campo, mensajes de consola y comentarios en español, como el resto del proyecto.
- **El contrato de salida de los mappers es sagrado.** `interesMensualActivo` booleano, `honorariosProgramados` objeto parseado, textos vacíos `''` y no `null`, `reciboNumero` con `|| null`, y la clave del historial es `comisión` **con tilde**.

## Dos juegos de datos distintos — no confundirlos

| | Dónde | Qué es | Qué se hace con ellos |
|---|---|---|---|
| **Datos de prueba** | `data/` en la máquina de desarrollo | Clientes y pagos inventados por el desarrollador | Sirven de **ensayo** del script de migración: se corre, se miran los 7 chequeos, y la `capella.db` resultante **se borra**. Nada de esto se conserva. |
| **Datos reales** | `data/` en la PC del estudio | La contabilidad del Estudio Capella | Se migran **una sola vez**, en la Tarea 16, con los 7 chequeos en OK. Este es el único traspaso que cuenta. |

Los `.xlsx` no están en el repositorio (están en `.gitignore`), así que un agente que solo tenga el repo no dispone de ninguno de los dos juegos. Las Tareas 1 a 11 no los necesitan: sus pruebas arman datos sintéticos en un directorio temporal.

Cuando este plan dice "contra los datos reales del estudio", se refiere exclusivamente a la Tarea 16.

## Corrección al orden de fases del spec

El spec lista las fases como 0) infra, 1) pagos, 2) clientes, 3) historial, 4) cierre.

**Ese orden no funciona.** `pagos.clienteId` tiene `REFERENCES clientes(id)`. Migrar pagos mientras clientes sigue viviendo en Excel deja la tabla `clientes` vacía, y con `PRAGMA foreign_keys = ON` todo INSERT de pago falla.

Este plan invierte las dos fases del medio: **clientes antes que pagos**. El alcance, el cutover único y el criterio de éxito no cambian.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/db.js` (crear) | Abrir la conexión, aplicar PRAGMAs, crear el esquema, versionarlo con `user_version`, y exponer un helper de transacción. Nada de lógica de negocio. |
| `backend/mappers.js` (crear) | Convertir filas SQL a los objetos que la API ya devuelve hoy. Es donde vive el contrato de salida. |
| `backend/excelManager.js` (modificar) | La clase `ExcelManager`. Conserva nombre y API pública; los internos pasan a SQL. |
| `backend/legacy/excelManagerXlsx.js` (crear, luego borrar) | Copia congelada del `excelManager.js` actual, solo lectura, usada por el script de migración. Se borra en la Tarea 16. |
| `backend/migrar-a-sqlite.js` (crear) | Script de una sola vez: lee los `.xlsx`, escribe `capella.db`, y corre los 7 chequeos de verificación. |
| `backend/test-migracion.js` (crear) | Self-check con `node:assert` de los casos borde. Se corre con `node backend/test-migracion.js`. |
| `backend/rebuild-historial.js` (modificar) | Port a SQL. |

`excelManager.js` queda en unas 1.200 líneas tras eliminar 400-500 de maquinaria Excel. El nombre queda desalineado con su contenido; renombrarlo a `datos.js` es una mejora posterior de una línea en `server.js`, deliberadamente fuera de alcance.

---

### Task 1: Conexión y esquema (`db.js`)

**Files:**
- Create: `backend/db.js`
- Test: `backend/test-migracion.js`

**Interfaces:**
- Consumes: nada.
- Produces: `abrirDb(rutaDb) -> DatabaseSync`, `enTransaccion(db, fn) -> any`, `SCHEMA_VERSION = 1`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/test-migracion.js` con el runner completo y la primera prueba:

```js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

// Cada prueba recibe un directorio temporal propio, así no comparten estado.
function dirTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'capella-test-'));
}

const { abrirDb, enTransaccion } = require('./db');

prueba('el esquema crea las tres tablas y marca user_version', () => {
  const db = abrirDb(path.join(dirTemporal(), 'capella.db'));
  const tablas = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map((f) => f.name);
  assert.deepStrictEqual(tablas, ['clientes', 'historial', 'pagos']);
  assert.strictEqual(db.prepare('PRAGMA user_version').get().user_version, 1);
  db.close();
});

prueba('foreign_keys esta activo', () => {
  const db = abrirDb(path.join(dirTemporal(), 'capella.db'));
  assert.strictEqual(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  db.close();
});

prueba('enTransaccion revierte si la funcion tira', () => {
  const db = abrirDb(path.join(dirTemporal(), 'capella.db'));
  db.prepare(
    "INSERT INTO clientes (id, nombre, fechaCreacion) VALUES ('c1', 'Uno', '2025-01-01')"
  ).run();
  assert.throws(() => enTransaccion(db, () => {
    db.prepare("UPDATE clientes SET nombre = 'Cambiado' WHERE id = 'c1'").run();
    throw new Error('falla a proposito');
  }));
  assert.strictEqual(
    db.prepare("SELECT nombre FROM clientes WHERE id = 'c1'").get().nombre,
    'Uno'
  );
  db.close();
});

// --- runner ---
let fallos = 0;
for (const { nombre, fn } of pruebas) {
  try {
    fn();
    console.log(`  ok   ${nombre}`);
  } catch (error) {
    fallos++;
    console.error(`  FALLA ${nombre}`);
    console.error(`        ${error.message}`);
  }
}
console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas pasaron`);
process.exit(fallos > 0 ? 1 : 0);
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node backend/test-migracion.js`
Expected: FALLA con `Cannot find module './db'`

- [ ] **Step 3: Escribir `backend/db.js`**

```js
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS clientes (
  id                        TEXT PRIMARY KEY,
  nombre                    TEXT NOT NULL,
  telefono                  TEXT,
  honorario                 REAL    NOT NULL DEFAULT 0,
  honorarioPeriodo          REAL    NOT NULL DEFAULT 0,
  totalAdeudado             REAL    NOT NULL DEFAULT 0,
  proximaFacturacion        TEXT,
  fechaCreacion             TEXT    NOT NULL,
  tipoTrabajo               TEXT    NOT NULL DEFAULT 'honorarios'
                              CHECK (tipoTrabajo IN ('honorarios','particular')),
  interesMensualActivo      INTEGER NOT NULL DEFAULT 0,
  interesMensualPorcentaje  REAL    NOT NULL DEFAULT 0,
  lastUpdate                TEXT,
  dniCuit                   TEXT,
  honorariosProgramados     TEXT    NOT NULL DEFAULT '{}',
  mesesAdeudados            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pagos (
  id                  TEXT PRIMARY KEY,
  clienteId           TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  monto               REAL NOT NULL,
  tipoPago            TEXT NOT NULL DEFAULT 'Efectivo',
  detalles            TEXT,
  fecha               TEXT,
  timestamp           TEXT,
  numeroCheque        TEXT,
  nombreBanco         TEXT,
  estado              TEXT NOT NULL DEFAULT 'activo'
                        CHECK (estado IN ('activo','anulado')),
  anuladoAt           TEXT,
  anuladoMotivo       TEXT,
  reciboRelativePath  TEXT,
  reciboFileName      TEXT,
  reciboNumero        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pagos_cliente ON pagos(clienteId);
CREATE INDEX IF NOT EXISTS idx_pagos_recibo  ON pagos(reciboRelativePath);

CREATE TABLE IF NOT EXISTS historial (
  id            TEXT PRIMARY KEY,
  clienteId     TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombreCliente TEXT,
  mes           TEXT,
  comision      REAL,
  fechaCobro    TEXT,
  timestamp     TEXT
);
`;

function abrirDb(rutaDb) {
  fs.mkdirSync(path.dirname(rutaDb), { recursive: true });
  const db = new DatabaseSync(rutaDb);
  // foreign_keys debe ir ANTES de cualquier operación: sin esto el ON DELETE
  // CASCADE no actúa y quedan pagos huérfanos sin que nada avise.
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = FULL');
  aplicarEsquema(db);
  return db;
}

function aplicarEsquema(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version >= SCHEMA_VERSION) return;
  db.exec(ESQUEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

// SQLite no anida transacciones: este helper asume que no hay una abierta.
function enTransaccion(db, fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { abrirDb, enTransaccion, SCHEMA_VERSION };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node backend/test-migracion.js`
Expected: `3/3 pruebas pasaron`

- [ ] **Step 5: Commit**

```bash
git add backend/db.js backend/test-migracion.js
git commit -m "Agregar capa de conexion SQLite y esquema"
```

---

### Task 2: Mappers de fila a objeto (`mappers.js`)

**Files:**
- Create: `backend/mappers.js`
- Test: `backend/test-migracion.js`

**Interfaces:**
- Consumes: nada.
- Produces: `filaACliente(fila) -> object|null`, `filaAPago(fila) -> object|null`, `filaAHistorial(fila) -> object|null`, `parseJsonObjeto(valor, fallback) -> object`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar en `backend/test-migracion.js`, antes del bloque `// --- runner ---`:

```js
const { filaACliente, filaAPago, filaAHistorial } = require('./mappers');

prueba('filaACliente convierte 0/1 a booleano y parsea el JSON', () => {
  const cliente = filaACliente({
    id: 'c1', nombre: 'Uno', telefono: null, honorario: 15000,
    honorarioPeriodo: 15000, totalAdeudado: 0, proximaFacturacion: null,
    fechaCreacion: '2025-01-01T00:00:00.000Z', tipoTrabajo: 'honorarios',
    interesMensualActivo: 1, interesMensualPorcentaje: 5,
    lastUpdate: '2025-01-01T00:00:00.000Z', dniCuit: null,
    honorariosProgramados: '{"01-2025":12000}', mesesAdeudados: 3,
  });
  assert.strictEqual(cliente.interesMensualActivo, true);
  assert.deepStrictEqual(cliente.honorariosProgramados, { '01-2025': 12000 });
  assert.strictEqual(cliente.telefono, '', 'NULL debe volver como cadena vacia');
  assert.strictEqual(cliente.dniCuit, '');
  assert.strictEqual(cliente.mesesAdeudados, 3);
});

prueba('filaACliente tolera un JSON de honorarios corrupto', () => {
  const cliente = filaACliente({
    id: 'c1', nombre: 'Uno', fechaCreacion: '2025-01-01',
    tipoTrabajo: 'honorarios', interesMensualActivo: 0,
    honorariosProgramados: 'esto no es json', mesesAdeudados: 0,
  });
  assert.deepStrictEqual(cliente.honorariosProgramados, {});
});

prueba('filaAPago preserva el contrato de textos vacios y reciboNumero', () => {
  const pago = filaAPago({
    id: 'p1', clienteId: 'c1', monto: 1000, tipoPago: 'Efectivo',
    detalles: null, fecha: '2025-01-15', timestamp: '2025-01-15T10:00:00.000Z',
    numeroCheque: null, nombreBanco: null, estado: 'activo',
    anuladoAt: null, anuladoMotivo: null, reciboRelativePath: null,
    reciboFileName: null, reciboNumero: null,
  });
  assert.strictEqual(pago.detalles, '');
  assert.strictEqual(pago.numeroCheque, '');
  assert.strictEqual(pago.anuladoAt, '');
  assert.strictEqual(pago.reciboRelativePath, '');
  assert.strictEqual(pago.reciboNumero, null);
});

prueba('filaAPago convierte reciboNumero 0 en null, como hoy', () => {
  const pago = filaAPago({ id: 'p1', clienteId: 'c1', monto: 0, reciboNumero: 0 });
  assert.strictEqual(pago.reciboNumero, null);
});

prueba('filaAHistorial devuelve la clave comision CON tilde', () => {
  const entrada = filaAHistorial({
    id: 'h1', clienteId: 'c1', nombreCliente: 'Uno', mes: '01-2025',
    comision: 15000, fechaCobro: '2025-01-31', timestamp: '2025-01-31T10:00:00.000Z',
  });
  assert.strictEqual(entrada['comisión'], 15000);
  assert.ok(!('comision' in entrada), 'no debe exponer la clave sin tilde');
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node backend/test-migracion.js`
Expected: FALLA con `Cannot find module './mappers'`

- [ ] **Step 3: Escribir `backend/mappers.js`**

```js
// Estos mappers replican exactamente el contrato de salida que tenían
// _buildClienteFromRow y _buildPagoFromRow sobre Excel. Las rarezas que parecen
// bugs (reciboNumero 0 -> null, textos vacíos como '' y no null) son
// deliberadas: la API ya las expone así y el frontend las espera.

function parseJsonObjeto(valor, fallback = {}) {
  if (valor && typeof valor === 'object') return valor;
  if (typeof valor !== 'string' || valor.trim() === '') return fallback;
  try {
    const parseado = JSON.parse(valor);
    return parseado && typeof parseado === 'object' && !Array.isArray(parseado)
      ? parseado
      : fallback;
  } catch {
    return fallback;
  }
}

function filaACliente(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    nombre: fila.nombre,
    telefono: fila.telefono || '',
    honorario: parseFloat(fila.honorario) || 0,
    honorarioPeriodo: parseFloat(fila.honorarioPeriodo) || 0,
    totalAdeudado: parseFloat(fila.totalAdeudado) || 0,
    proximaFacturacion: fila.proximaFacturacion || '',
    fechaCreacion: fila.fechaCreacion,
    tipoTrabajo: fila.tipoTrabajo || 'honorarios',
    interesMensualActivo: fila.interesMensualActivo === 1,
    interesMensualPorcentaje: parseFloat(fila.interesMensualPorcentaje) || 0,
    lastUpdate: fila.lastUpdate,
    dniCuit: fila.dniCuit || '',
    honorariosProgramados: parseJsonObjeto(fila.honorariosProgramados, {}),
    mesesAdeudados: parseInt(fila.mesesAdeudados, 10) || 0,
  };
}

function filaAPago(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    clienteId: fila.clienteId,
    monto: parseFloat(fila.monto) || 0,
    tipoPago: fila.tipoPago || 'Efectivo',
    detalles: fila.detalles || '',
    fecha: fila.fecha,
    timestamp: fila.timestamp,
    numeroCheque: (fila.numeroCheque || '').toString(),
    nombreBanco: (fila.nombreBanco || '').toString(),
    estado: fila.estado === 'anulado' ? 'anulado' : 'activo',
    anuladoAt: fila.anuladoAt || '',
    anuladoMotivo: (fila.anuladoMotivo || '').toString(),
    reciboRelativePath: (fila.reciboRelativePath || '').toString(),
    reciboFileName: (fila.reciboFileName || '').toString(),
    reciboNumero: fila.reciboNumero || null,
  };
}

function filaAHistorial(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    clienteId: fila.clienteId,
    nombreCliente: fila.nombreCliente,
    mes: fila.mes,
    // Con tilde a propósito: es la clave que getAllHistorial() ya devuelve
    // por la API hacia el frontend. La columna SQL se llama `comision`.
    'comisión': fila.comision,
    fechaCobro: fila.fechaCobro,
    timestamp: fila.timestamp,
  };
}

module.exports = { filaACliente, filaAPago, filaAHistorial, parseJsonObjeto };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node backend/test-migracion.js`
Expected: `8/8 pruebas pasaron`

- [ ] **Step 5: Commit**

```bash
git add backend/mappers.js backend/test-migracion.js
git commit -m "Agregar mappers de fila SQL a objeto de dominio"
```

---

### Task 3: Congelar el lector Excel actual

**Files:**
- Create: `backend/legacy/excelManagerXlsx.js` (copia exacta de `backend/excelManager.js`)

**Interfaces:**
- Consumes: nada.
- Produces: `ExcelManagerXlsx`, la clase actual íntegra, usada solo por el script de migración.

Esta tarea no tiene test: es una copia byte a byte. Debe hacerse **antes** de tocar `excelManager.js`, o se pierde el lector con el que se verifica la migración.

- [ ] **Step 1: Copiar el archivo**

```bash
mkdir -p backend/legacy
cp backend/excelManager.js backend/legacy/excelManagerXlsx.js
```

- [ ] **Step 2: Ajustar la ruta de datos y el nombre exportado**

En `backend/legacy/excelManagerXlsx.js`, el constructor resuelve `data/` relativo a `__dirname`, que ahora está un nivel más abajo. Cambiar:

```js
    this.dataPath = path.join(__dirname, '../data');
```

por:

```js
    // Está en backend/legacy/, así que sube dos niveles para llegar a data/.
    this.dataPath = path.join(__dirname, '../../data');
```

Y al final del archivo, agregar una nota sobre su carácter temporal:

```js
// COPIA CONGELADA de excelManager.js previo a la migración a SQLite.
// Solo lectura, usada por migrar-a-sqlite.js para verificar la migración.
// Se borra al completar el cutover (Tarea 16 del plan).
module.exports = ExcelManager;
```

- [ ] **Step 3: Verificar que lee los .xlsx**

Run: `node -e "const M=require('./backend/legacy/excelManagerXlsx');new M().getClientes().then(c=>console.log(c.length+' clientes'))"`
Expected: imprime la cantidad de clientes del `data/` actual, o `0 clientes` si todavía no hay datos. No debe tirar error de ruta.

- [ ] **Step 4: Commit**

```bash
git add backend/legacy/excelManagerXlsx.js
git commit -m "Congelar lector Excel para verificacion de la migracion"
```

---

### Task 4: `ExcelManager` sobre SQL — construcción y lectura de clientes

**Files:**
- Modify: `backend/excelManager.js`
- Test: `backend/test-migracion.js`

**Interfaces:**
- Consumes: `abrirDb`, `enTransaccion` de `./db`; `filaACliente` de `./mappers`.
- Produces: `new ExcelManager(rutaDb?)`, `initialize() -> Promise<void>`, `getClientes() -> Promise<object[]>`, `getCliente(id) -> Promise<object|undefined>`.

El parámetro opcional `rutaDb` existe solo para que las pruebas usen un directorio temporal. `server.js` llama `new ExcelManager()` sin argumentos y no cambia.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar en `backend/test-migracion.js`:

```js
const ExcelManager = require('./excelManager');

function nuevoManager() {
  return new ExcelManager(path.join(dirTemporal(), 'capella.db'));
}

prueba('getClientes devuelve vacio en una base nueva', async () => {
  const em = nuevoManager();
  await em.initialize();
  assert.deepStrictEqual(await em.getClientes(), []);
});

prueba('getCliente devuelve undefined si no existe', async () => {
  const em = nuevoManager();
  await em.initialize();
  assert.strictEqual(await em.getCliente('no-existe'), undefined);
});
```

El runner actual es síncrono. Reemplazar el bloque `// --- runner ---` por uno que soporte `async`:

```js
// --- runner ---
(async () => {
  let fallos = 0;
  for (const { nombre, fn } of pruebas) {
    try {
      await fn();
      console.log(`  ok   ${nombre}`);
    } catch (error) {
      fallos++;
      console.error(`  FALLA ${nombre}`);
      console.error(`        ${error.message}`);
    }
  }
  console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas pasaron`);
  process.exit(fallos > 0 ? 1 : 0);
})();
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node backend/test-migracion.js`
Expected: FALLA en las dos pruebas nuevas (`getClientes` todavía lee Excel y no acepta `rutaDb`)

- [ ] **Step 3: Reescribir el encabezado de `excelManager.js`**

Reemplazar las líneas 1 a 50 (requires, constructor con rutas y `_workbookCache`, `CLIENTE_COL`, `PAGO_COL`) por:

```js
const path = require('path');
const { abrirDb, enTransaccion } = require('./db');
const { filaACliente, filaAPago, filaAHistorial, parseJsonObjeto } = require('./mappers');

class ExcelManager {
  constructor(rutaDb) {
    this.dataPath = path.join(__dirname, '../data');
    // rutaDb solo se pasa desde las pruebas, para trabajar en un temporal.
    this.dbPath = rutaDb || path.join(this.dataPath, 'capella.db');
    this.db = abrirDb(this.dbPath);
  }
```

Eliminar por completo: `_workbookCache`, `CLIENTE_COL`, `PAGO_COL`, `clientesPath`, `pagosPath`, `historicalPath`, y el `require('exceljs')`.

- [ ] **Step 4: Reemplazar `initialize`, `getClientes` y `getCliente`**

`abrirDb` ya creó el esquema en el constructor, así que `initialize()` queda casi vacía pero se conserva porque `server.js` la llama:

```js
  async initialize() {
    // El esquema se crea en abrirDb() desde el constructor. Este método se
    // conserva porque runStartupInitialization() de server.js lo invoca.
    console.log('✓ Sistema de base de datos listo');
  }

  async getClientes() {
    const filas = this.db.prepare('SELECT * FROM clientes ORDER BY rowid').all();
    return filas.map(filaACliente);
  }

  async getCliente(id) {
    const fila = this.db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
    // Devuelve undefined y no null: getCliente() antes usaba Array.find().
    return fila ? filaACliente(fila) : undefined;
  }
```

`ORDER BY rowid` preserva el orden de inserción, que es el orden en que las filas aparecían en la planilla.

- [ ] **Step 5: Eliminar la maquinaria de Excel**

Borrar estos métodos completos de `excelManager.js`:

- `_invalidateWorkbookCache`
- `_loadWorkbookCache`
- `_getClientesWorkbook`, `_getPagosWorkbook`, `_getHistorialWorkbook`
- `getClientesColumns`
- `_buildClienteFromRow`, `_buildPagoFromRow`
- `_ensureClientesSheetStructure`, `_ensurePagosSheetStructure`
- `initializeClientesFile`, `initializePagosFile`, `initializeHistoricalFile`

Y reemplazar `_safeJsonParseObject` por una delegación al mapper:

```js
  _safeJsonParseObject(rawValue, fallback = {}) {
    return parseJsonObjeto(rawValue, fallback);
  }
```

**No tocar** (se conservan idénticos): `normalizeMonthKey`, `getCurrentMonthKey`, `getNextMonthKey`, `normalizePaymentStatus`, `_sanitizeHonorariosProgramados`, `_getHonorarioBaseMes`, `parseBooleanValue`, `_calcularHonorarioConInteres`, `formatearMes`, `_monthKeyToDate`, `_monthFloorDate`, `_buildMonthRange`, `_preservarHonorariosAnteriores`, `_calcularFinanzasCliente`, `_calcularDeudaCliente`, `calcularDeudaDinamica`.

En este punto el archivo no corre: los métodos de escritura todavía referencian workbooks. Las Tareas 5 a 11 los van arreglando. El test de esta tarea solo ejerce lectura de clientes.

- [ ] **Step 6: Correr y verificar que pasa**

Run: `node backend/test-migracion.js`
Expected: `10/10 pruebas pasaron`

- [ ] **Step 7: Commit**

```bash
git add backend/excelManager.js backend/test-migracion.js
git commit -m "Migrar lectura de clientes a SQLite y eliminar cache de workbooks"
```

---

### Task 5: Alta de cliente (`addCliente`)

**Files:**
- Modify: `backend/excelManager.js`
- Test: `backend/test-migracion.js`

**Interfaces:**
- Consumes: `this.db`, `filaACliente`.
- Produces: `addCliente(cliente) -> Promise<object>` con el cliente creado, incluido su `id`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
prueba('addCliente persiste y devuelve el cliente con id', async () => {
  const em = nuevoManager();
  await em.initialize();
  const creado = await em.addCliente({
    id: 'c1', nombre: 'Estudio Uno', telefono: '2625000000',
    honorario: 15000, tipoTrabajo: 'honorarios', dniCuit: '20111111119',
  });
  assert.strictEqual(creado.id, 'c1');
  const leido = await em.getCliente('c1');
  assert.strictEqual(leido.nombre, 'Estudio Uno');
  assert.strictEqual(leido.honorario, 15000);
  assert.strictEqual(leido.tipoTrabajo, 'honorarios');
  assert.deepStrictEqual(leido.honorariosProgramados, {});
});

prueba('addCliente rechaza un tipoTrabajo invalido', async () => {
  const em = nuevoManager();
  await em.initialize();
  await assert.rejects(() => em.addCliente({
    id: 'c2', nombre: 'Malo', honorario: 0, tipoTrabajo: 'inventado',
  }));
});

prueba('addCliente no tarda 200ms artificiales', async () => {
  const em = nuevoManager();
  await em.initialize();
  const t0 = Date.now();
  await em.addCliente({ id: 'c3', nombre: 'Rapido', honorario: 1000 });
  assert.ok(Date.now() - t0 < 100, 'el sleep de verificacion debe haber desaparecido');
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node backend/test-migracion.js`
Expected: FALLA en las tres pruebas nuevas

- [ ] **Step 3: Reemplazar `addCliente`**

Borrar el método entero (líneas ~574-674 del original, incluidos el reintento triple, el `sleep` de 200 ms y el bloque de verificación) y poner:

```js
  async addCliente(cliente) {
    const ahora = new Date();
    const tipoTrabajo = cliente.tipoTrabajo === 'particular' ? 'particular' : 'honorarios';
    const honorario = Math.round((parseFloat(cliente.honorario) || 0) * 100) / 100;
    // Cobro a mes vencido: el primer vencimiento es al inicio del mes siguiente.
    const proximaFacturacion = tipoTrabajo === 'particular'
      ? ''
      : new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1).toISOString();

    const nuevo = {
      id: cliente.id,
      nombre: cliente.nombre,
      telefono: (cliente.telefono || '').toString(),
      honorario,
      honorarioPeriodo: honorario,
      totalAdeudado: 0,
      proximaFacturacion,
      fechaCreacion: ahora.toISOString(),
      tipoTrabajo,
      interesMensualActivo: cliente.interesMensualActivo ? 1 : 0,
      interesMensualPorcentaje: Number(cliente.interesMensualPorcentaje) || 0,
      lastUpdate: ahora.toISOString(),
      dniCuit: (cliente.dniCuit || '').toString().trim().slice(0, 40),
      honorariosProgramados: '{}',
      mesesAdeudados: 0,
    };

    this.db.prepare(`
      INSERT INTO clientes (
        id, nombre, telefono, honorario, honorarioPeriodo, totalAdeudado,
        proximaFacturacion, fechaCreacion, tipoTrabajo, interesMensualActivo,
        interesMensualPorcentaje, lastUpdate, dniCuit, honorariosProgramados,
        mesesAdeudados
      ) VALUES (
        :id, :nombre, :telefono, :honorario, :honorarioPeriodo, :totalAdeudado,
        :proximaFacturacion, :fechaCreacion, :tipoTrabajo, :interesMensualActivo,
        :interesMensualPorcentaje, :lastUpdate, :dniCuit, :honorariosProgramados,
        :mesesAdeudados
      )
    `).run(nuevo);

    console.log(`✓ Cliente agregado: ${nuevo.nombre}`);
    return this.getCliente(nuevo.id);
  }
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node backend/test-migracion.js`
Expected: `13/13 pruebas pasaron`

- [ ] **Step 5: Commit**

```bash
git add backend/excelManager.js backend/test-migracion.js
git commit -m "Migrar alta de cliente a SQLite y quitar el sleep de 200ms"
```

---

### Task 6: Modificación y baja de cliente

**Files:**
- Modify: `backend/excelManager.js`
- Test: `backend/test-migracion.js`

**Interfaces:**
- Consumes: `this.db`, `enTransaccion`, `getCliente`, `recalculateClienteDeuda`.
- Produces: `updateCliente(id, updates) -> Promise<object>`, `deleteCliente(id) -> Promise<{success, message}>`, `envejecerCliente(clienteId, diasAtras) -> Promise<void>`.

`updateCliente` llama a `recalculateClienteDeuda`, que todavía no está migrado (Tarea 9). Hasta entonces las pruebas de esta tarea usan clientes sin pagos, donde el recálculo es trivial.

- [ ] **Step 1: Escribir los tests que fallan**

```js
prueba('updateCliente modifica solo los campos enviados', async () => {
  const em = nuevoManager();
  await em.initialize();
  await em.addCliente({ id: 'c1', nombre: 'Original', telefono: '111', honorario: 10000 });
  await em.updateCliente('c1', { telefono: '222' });
  const cliente = await em.getCliente('c1');
  assert.strictEqual(cliente.telefono, '222');
  assert.strictEqual(cliente.nombre, 'Original', 'no debe tocar lo no enviado');
  assert.strictEqual(cliente.honorario, 10000);
});

prueba('updateCliente tira si el cliente no existe', async () => {
  const em = nuevoManager();
  await em.initialize();
  await assert.rejects(() => em.updateCliente('fantasma', { telefono: '1' }),
    /Cliente no encontrado/);
});

prueba('deleteCliente borra sus pagos en cascada', async () => {
  const em = nuevoManager();
  await em.initialize();
  await em.addCliente({ id: 'c1', nombre: 'Uno', honorario: 10000 });
  em.db.prepare(
    "INSERT INTO pagos (id, clienteId, monto) VALUES ('p1', 'c1', 5000)"
  ).run();
  await em.deleteCliente('c1');
  assert.strictEqual(em.db.prepare('SELECT COUNT(*) n FROM pagos').get().n, 0,
    'el ON DELETE CASCADE debe haber borrado el pago');
  assert.strictEqual(await em.getCliente('c1'), undefined);
});

prueba('envejecerCliente retrocede la fecha de creacion', async () => {
  const em = nuevoManager();
  await em.initialize();
  await em.addCliente({ id: 'c1', nombre: 'Uno', honorario: 10000 });
  await em.envejecerCliente('c1', 400);
  const cliente = await em.getCliente('c1');
  const dias = (Date.now() - new Date(cliente.fechaCreacion)) / 86400000;
  assert.ok(dias > 399 && dias < 401, `esperaba ~400 dias, dio ${dias}`);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node backend/test-migracion.js`
Expected: FALLA en las cuatro pruebas nuevas

- [ ] **Step 3: Reemplazar `updateCliente`**

La lógica de `honorariosProgramados` se porta idéntica: se lee el JSON, se muta el objeto y se vuelve a escribir.

```js
  async updateCliente(id, updates) {
    const actual = this.db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
    if (!actual) throw new Error('Cliente no encontrado');

    const campos = {};

    if (updates.nombre !== undefined) campos.nombre = updates.nombre;
    if (updates.telefono !== undefined) campos.telefono = updates.telefono;
    if (updates.dniCuit !== undefined) {
      campos.dniCuit = (updates.dniCuit || '').toString().trim().slice(0, 40);
    }

    if (updates.honorario !== undefined) {
      // 1) honorario anterior ANTES de modificarlo
      const honorarioAnterior = Math.round((parseFloat(actual.honorario) || 0) * 100) / 100;
      const nuevoHonorario = Math.round((parseFloat(updates.honorario) || 0) * 100) / 100;

      // 2) preservar el honorario anterior en los meses históricos sin valor propio
      const programados = parseJsonObjeto(actual.honorariosProgramados, {});
      this._preservarHonorariosAnteriores(programados, honorarioAnterior, actual.fechaCreacion);

      // 3) el nuevo honorario rige desde el mes actual
      programados[this.getCurrentMonthKey()] = nuevoHonorario;
      campos.honorariosProgramados = JSON.stringify(
        this._sanitizeHonorariosProgramados(programados)
      );
      campos.honorario = nuevoHonorario;
    }

    if (updates.tipoTrabajo !== undefined) {
      const tipoTrabajo = updates.tipoTrabajo === 'particular' ? 'particular' : 'honorarios';
      campos.tipoTrabajo = tipoTrabajo;
      if (tipoTrabajo === 'particular') {
        campos.proximaFacturacion = '';
      } else if (!actual.proximaFacturacion) {
        const proxima = new Date();
        proxima.setDate(proxima.getDate() + 30);
        campos.proximaFacturacion = proxima.toISOString();
      }
    }

    if (updates.interesMensualActivo !== undefined) {
      campos.interesMensualActivo = updates.interesMensualActivo ? 1 : 0;
    }
    if (updates.interesMensualPorcentaje !== undefined) {
      campos.interesMensualPorcentaje = Number(updates.interesMensualPorcentaje) || 0;
    }
    if (updates.honorariosProgramados !== undefined) {
      campos.honorariosProgramados = JSON.stringify(
        this._sanitizeHonorariosProgramados(updates.honorariosProgramados)
      );
    }

    campos.lastUpdate = new Date().toISOString();

    const asignaciones = Object.keys(campos).map((c) => `${c} = :${c}`).join(', ');
    this.db.prepare(`UPDATE clientes SET ${asignaciones} WHERE id = :id`)
      .run({ ...campos, id });

    await this.recalculateClienteDeuda(id);
    return this.getCliente(id);
  }
```

- [ ] **Step 4: Reemplazar `deleteCliente` y `envejecerCliente`**

```js
  async deleteCliente(id) {
    const cliente = await this.getCliente(id);
    if (!cliente) throw new Error('Cliente no encontrado');

    // pagos e historial se van solos por ON DELETE CASCADE.
    this.db.prepare('DELETE FROM clientes WHERE id = ?').run(id);

    console.log(`✅ Cliente ${cliente.nombre} y todos sus registros eliminados`);
    return { success: true, message: `Cliente ${cliente.nombre} eliminado completamente` };
  }

  // Para testing: envejecer un cliente (cambiar su fecha de creación)
  async envejecerCliente(clienteId, diasAtras) {
    const nuevaFecha = new Date();
    nuevaFecha.setDate(nuevaFecha.getDate() - diasAtras);

    const { changes } = this.db.prepare(
      'UPDATE clientes SET fechaCreacion = ?, lastUpdate = ? WHERE id = ?'
    ).run(nuevaFecha.toISOString(), new Date().toISOString(), clienteId);

    if (changes === 0) throw new Error('Cliente no encontrado');
  }
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `node backend/test-migracion.js`
Expected: `17/17 pruebas pasaron`

- [ ] **Step 6: Commit**

```bash
git add backend/excelManager.js backend/test-migracion.js
git commit -m "Migrar modificacion y baja de cliente a SQLite con borrado en cascada"
```

---

### Task 7: Honorarios programados y deuda anterior

**Files:**
- Modify: `backend/excelManager.js`
- Test: `backend/test-migracion.js`

**Interfaces:**
- Consumes: `this.db`, `getCliente`, `recalculateClienteDeuda`.
- Produces: `updateClienteHonorario(id, honorario) -> Promise<object>`, `updateClienteHonorarioProgramado(id, periodoMes, honorario) -> Promise<object>`, `addClienteDeudaAnterior(id, periodoMes, deuda) -> Promise<object>`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
prueba('updateClienteHonorario preserva el honorario viejo en meses pasados', async () => {
  const em = nuevoManager();
  await em.initialize();
  await em.addCliente({ id: 'c1', nombre: 'Uno', honorario: 10000 });
  await em.envejecerCliente('c1', 100);           // ~3 meses de historia
  await em.updateClienteHonorario('c1', 20000);

  const cliente = await em.getCliente('c1');
  const programados = cliente.honorariosProgramados;
  const mesActual = em.getCurrentMonthKey();

  assert.strictEqual(programados[mesActual], 20000, 'el mes actual usa el nuevo');
  const mesesViejos = Object.keys(programados).filter((m) => m !== mesActual);
  assert.ok(mesesViejos.length > 0, 'debe haber preservado meses anteriores');
  for (const mes of mesesViejos) {
    assert.strictEqual(programados[mes], 10000, `${mes} debe conservar el viejo`);
  }
});

prueba('updateClienteHonorarioProgramado pisa un solo mes', async () => {
  const em = nuevoManager();
  await em.initialize();
  await em.addCliente({ id: 'c1', nombre: 'Uno', honorario: 10000 });
  await em.updateClienteHonorarioProgramado('c1', '03-2025', 7777);
  const cliente = await em.getCliente('c1');
  assert.strictEqual(cliente.honorariosProgramados['03-2025'], 7777);
  assert.strictEqual(cliente.honorario, 10000, 'el honorario base no cambia');
});

prueba('addClienteDeudaAnterior reemplaza el mes, no lo suma', async () => {
  const em = nuevoManager();
  await em.initialize();
  await em.addCliente({ id: 'c1', nombre: 'Uno', honorario: 10000 });
  await em.envejecerCliente('c1', 200);
  await em.updateClienteHonorarioProgramado('c1', '03-2025', 5000);
  await em.addClienteDeudaAnterior('c1', '03-2025', 8000);
  const cliente = await em.getCliente('c1');
  assert.strictEqual(cliente.honorariosProgramados['03-2025'], 8000,
    'debe reemplazar, no sumar a los 5000 previos');
});

prueba('addClienteDeudaAnterior rechaza clientes particulares', async () => {
  const em = nuevoManager();
  await em.initialize();
  await em.addCliente({
    id: 'c1', nombre: 'Unico', honorario: 50000, tipoTrabajo: 'particular',
  });
  await assert.rejects(() => em.addClienteDeudaAnterior('c1', '03-2025', 1000),
    /honorarios mensuales/);
});

prueba('addClienteDeudaAnterior retrocede el alta y rellena con 0', async () => {
  const em = nuevoManager();
  await em.initialize();
  await em.addCliente({ id: 'c1', nombre: 'Uno', honorario: 10000 });
  await em.envejecerCliente('c1', 60);                  // alta ~2 meses atrás
  const altaPrevia = new Date((await em.getCliente('c1')).fechaCreacion);

  // Un período bastante anterior al alta.
  const objetivo = new Date(altaPrevia.getFullYear(), altaPrevia.getMonth() - 3, 1);
  const mesObjetivo = em.formatearMes(objetivo);
  await em.addClienteDeudaAnterior('c1', mesObjetivo, 4500);

  const cliente = await em.getCliente('c1');
  assert.ok(new Date(cliente.fechaCreacion) < altaPrevia,
    'el alta debe haber retrocedido hasta el periodo objetivo');
  assert.strictEqual(cliente.honorariosProgramados[mesObjetivo], 4500);

  // Los meses entre el objetivo y el alta original deben quedar en 0,
  // no en el honorario base, para no inventar deuda.
  const mesAnteriorAlta = new Date(altaPrevia.getFullYear(), altaPrevia.getMonth() - 1, 1);
  const intermedios = em._buildMonthRange(objetivo, mesAnteriorAlta)
    .filter((m) => m !== mesObjetivo);
  for (const mes of intermedios) {
    assert.strictEqual(cliente.honorariosProgramados[mes], 0,
      `${mes} debe quedar en 0 y no generar deuda ficticia`);
  }
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node backend/test-migracion.js`
Expected: FALLA en las dos pruebas nuevas

- [ ] **Step 3: Reescribir los tres métodos**

Los tres siguen el mismo patrón: leer la fila, mutar el objeto JSON en memoria, escribir de vuelta.

```js
  // Helper interno: lee honorariosProgramados de un cliente, aplica una
  // mutación sobre el objeto y lo vuelve a guardar sanitizado.
  _mutarProgramados(id, mutar) {
    const actual = this.db.prepare(
      'SELECT honorario, fechaCreacion, honorariosProgramados FROM clientes WHERE id = ?'
    ).get(id);
    if (!actual) throw new Error('Cliente no encontrado');

    const programados = parseJsonObjeto(actual.honorariosProgramados, {});
    const campos = mutar(programados, actual) || {};

    this.db.prepare(`
      UPDATE clientes
         SET honorariosProgramados = :programados,
             honorario = COALESCE(:honorario, honorario),
             lastUpdate = :lastUpdate
       WHERE id = :id
    `).run({
      id,
      programados: JSON.stringify(this._sanitizeHonorariosProgramados(programados)),
      honorario: campos.honorario ?? null,
      lastUpdate: new Date().toISOString(),
    });
  }

  async updateClienteHonorario(id, honorario) {
    const nuevoHonorario = Math.round((parseFloat(honorario) || 0) * 100) / 100;

    this._mutarProgramados(id, (programados, actual) => {
      const honorarioAnterior = Math.round((parseFloat(actual.honorario) || 0) * 100) / 100;
      this._preservarHonorariosAnteriores(programados, honorarioAnterior, actual.fechaCreacion);
      programados[this.getCurrentMonthKey()] = nuevoHonorario;
      return { honorario: nuevoHonorario };
    });

    await this.recalculateClienteDeuda(id);
    return this.getCliente(id);
  }

  async updateClienteHonorarioProgramado(id, periodoMes, honorario) {
    const mesKey = this.normalizeMonthKey(periodoMes);
    if (!mesKey) throw new Error('Período inválido, se espera MM-YYYY');
    const monto = Math.round((parseFloat(honorario) || 0) * 100) / 100;

    this._mutarProgramados(id, (programados) => {
      programados[mesKey] = monto;
    });

    await this.recalculateClienteDeuda(id);
    return this.getCliente(id);
  }

  async addClienteDeudaAnterior(id, periodoMes, deuda) {
    const mesKey = this.normalizeMonthKey(periodoMes);
    if (!mesKey) throw new Error('Período inválido. Use formato MM-YYYY');

    const deudaFloat = parseFloat(deuda);
    if (!Number.isFinite(deudaFloat) || deudaFloat < 0) {
      throw new Error('Deuda inválida');
    }
    const deudaFinal = Math.round(deudaFloat * 100) / 100;

    const actual = this.db.prepare(
      'SELECT tipoTrabajo, fechaCreacion, honorariosProgramados FROM clientes WHERE id = ?'
    ).get(id);
    if (!actual) throw new Error('Cliente no encontrado');

    if ((actual.tipoTrabajo || 'honorarios').toString() === 'particular') {
      throw new Error('Solo se puede cargar deuda anterior en clientes de honorarios mensuales');
    }

    const programados = this._sanitizeHonorariosProgramados(
      parseJsonObjeto(actual.honorariosProgramados, {})
    );

    const fechaCreacionActual = this._monthFloorDate(actual.fechaCreacion);
    const fechaPeriodoObjetivo = this._monthKeyToDate(mesKey);
    if (!fechaPeriodoObjetivo) throw new Error('Período inválido. Use formato MM-YYYY');

    const campos = { fechaCreacion: null };

    // Si el período objetivo es anterior al alta, se retrocede la fecha de creación
    // y se completa con 0 los meses intermedios para no crear deudas ficticias.
    if (fechaPeriodoObjetivo < fechaCreacionActual) {
      const mesAnteriorAlta = new Date(
        fechaCreacionActual.getFullYear(), fechaCreacionActual.getMonth() - 1, 1
      );
      const mesesIntermedios = this._buildMonthRange(fechaPeriodoObjetivo, mesAnteriorAlta);
      mesesIntermedios.forEach((monthKey) => {
        if (programados[monthKey] === undefined) programados[monthKey] = 0;
      });
      campos.fechaCreacion = fechaPeriodoObjetivo.toISOString();
    }

    programados[mesKey] = deudaFinal;

    this.db.prepare(`
      UPDATE clientes SET
        honorariosProgramados = :programados,
        fechaCreacion = COALESCE(:fechaCreacion, fechaCreacion),
        lastUpdate = :lastUpdate
      WHERE id = :id
    `).run({
      id,
      programados: JSON.stringify(this._sanitizeHonorariosProgramados(programados)),
      fechaCreacion: campos.fechaCreacion,
      lastUpdate: new Date().toISOString(),
    });

    await this.recalculateClienteDeuda(id);
    return this.getCliente(id);
  }
```

Tres comportamientos de este método son fáciles de perder y están verificados contra el original (`backend/legacy/excelManagerXlsx.js`, líneas 1282-1355): **reemplaza** el valor del mes en lugar de sumarlo; **rechaza** clientes `particular`; y si el período es anterior al alta, **retrocede `fechaCreacion`** rellenando los meses intermedios con 0. Ese último es el que decide desde qué mes se adeuda: omitirlo genera deuda ficticia.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node backend/test-migracion.js`
Expected: `22/22 pruebas pasaron`

- [ ] **Step 5: Commit**

```bash
git add backend/excelManager.js backend/test-migracion.js
git commit -m "Migrar honorarios programados y deuda anterior a SQLite"
```

---

### Task 8: Lectura y alta de pagos

**Files:**
- Modify: `backend/excelManager.js`
- Test: `backend/test-migracion.js`

**Interfaces:**
- Consumes: `this.db`, `filaAPago`.
- Produces: `addPago(pago) -> Promise<object>`, `getPagosCliente(clienteId) -> Promise<object[]>`, `getAllPagos() -> Promise<object[]>`, `getPagoById(pagoId) -> Promise<object|null>`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
async function managerConCliente(id = 'c1') {
  const em = nuevoManager();
  await em.initialize();
  await em.addCliente({ id, nombre: 'Cliente ' + id, honorario: 15000 });
  return em;
}

prueba('addPago persiste y se recupera por cliente', async () => {
  const em = await managerConCliente();
  await em.addPago({
    id: 'p1', clienteId: 'c1', monto: 15000, tipoPago: 'Efectivo',
    detalles: 'Enero', fecha: '2025-01-15',
    timestamp: '2025-01-15T10:00:00.000Z', estado: 'activo',
  });
  const pagos = await em.getPagosCliente('c1');
  assert.strictEqual(pagos.length, 1);
  assert.strictEqual(pagos[0].monto, 15000);
  assert.strictEqual(pagos[0].estado, 'activo');
  assert.strictEqual(pagos[0].detalles, 'Enero');
});

prueba('getPagosCliente no devuelve pagos de otros clientes', async () => {
  const em = await managerConCliente('c1');
  await em.addCliente({ id: 'c2', nombre: 'Dos', honorario: 9000 });
  await em.addPago({ id: 'p1', clienteId: 'c1', monto: 100, estado: 'activo' });
  await em.addPago({ id: 'p2', clienteId: 'c2', monto: 200, estado: 'activo' });
  assert.strictEqual((await em.getPagosCliente('c1')).length, 1);
  assert.strictEqual((await em.getAllPagos()).length, 2);
});

prueba('addPago rechaza un estado invalido', async () => {
  const em = await managerConCliente();
  await assert.rejects(() => em.addPago({
    id: 'p1', clienteId: 'c1', monto: 100, estado: 'inventado',
  }));
});

prueba('addPago rechaza un cliente inexistente', async () => {
  const em = await managerConCliente();
  await assert.rejects(() => em.addPago({
    id: 'p1', clienteId: 'fantasma', monto: 100, estado: 'activo',
  }), 'la foreign key debe rechazarlo');
});

prueba('getPagoById devuelve null si no existe', async () => {
  const em = await managerConCliente();
  assert.strictEqual(await em.getPagoById('no-existe'), null);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node backend/test-migracion.js`
Expected: FALLA en las cinco pruebas nuevas

- [ ] **Step 3: Reescribir los cuatro métodos**

```js
  async addPago(pago) {
    this.db.prepare(`
      INSERT INTO pagos (
        id, clienteId, monto, tipoPago, detalles, fecha, timestamp,
        numeroCheque, nombreBanco, estado, anuladoAt, anuladoMotivo,
        reciboRelativePath, reciboFileName, reciboNumero
      ) VALUES (
        :id, :clienteId, :monto, :tipoPago, :detalles, :fecha, :timestamp,
        :numeroCheque, :nombreBanco, :estado, '', '', '', '', NULL
      )
    `).run({
      id: pago.id,
      clienteId: pago.clienteId,
      monto: parseFloat(pago.monto) || 0,
      tipoPago: pago.tipoPago || 'Efectivo',
      detalles: (pago.detalles || '').toString().slice(0, 1000),
      fecha: pago.fecha,
      timestamp: pago.timestamp,
      numeroCheque: (pago.numeroCheque || '').toString().slice(0, 80),
      nombreBanco: (pago.nombreBanco || '').toString().slice(0, 120),
      estado: this.normalizePaymentStatus(pago.estado),
    });

    console.log(`✓ Pago registrado: ${pago.id} - $${pago.monto}`);
    return pago;
  }

  async getPagosCliente(clienteId) {
    const filas = this.db.prepare(
      'SELECT * FROM pagos WHERE clienteId = ? ORDER BY rowid'
    ).all(clienteId);
    return filas.map(filaAPago);
  }

  async getAllPagos() {
    const filas = this.db.prepare('SELECT * FROM pagos ORDER BY rowid').all();
    return filas.map(filaAPago);
  }

  async getPagoById(pagoId) {
    const fila = this.db.prepare('SELECT * FROM pagos WHERE id = ?').get(pagoId);
    return fila ? filaAPago(fila) : null;
  }
```

`addPago` devuelve el objeto `pago` recibido, igual que hoy, porque `server.js` lo reenvía tal cual al frontend.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node backend/test-migracion.js`
Expected: `27/27 pruebas pasaron`

- [ ] **Step 5: Commit**

```bash
git add backend/excelManager.js backend/test-migracion.js
git commit -m "Migrar lectura y alta de pagos a SQLite"
```

---

### Task 9: Recálculo de deuda y transacción del pago

**Files:**
- Modify: `backend/excelManager.js`
- Test: `backend/test-migracion.js`

**Interfaces:**
- Consumes: `this.db`, `enTransaccion`, `_calcularFinanzasCliente`, `getCliente`.
- Produces: `recalculateClienteDeuda(clienteId) -> Promise<void>`, `registrarPagoYRecalcular(pago) -> Promise<object>`.

`registrarPagoYRecalcular` es nuevo y envuelve `addPago` + `recalculateClienteDeuda` en una transacción. No reemplaza a ninguno de los dos: ambos siguen existiendo con su firma actual.

- [ ] **Step 1: Escribir los tests que fallan**

```js
prueba('recalculateClienteDeuda descuenta los pagos activos', async () => {
  const em = await managerConCliente();
  await em.envejecerCliente('c1', 100);          // ~3 meses vencidos
  await em.recalculateClienteDeuda('c1');
  const deudaSinPagos = (await em.getCliente('c1')).totalAdeudado;
  assert.ok(deudaSinPagos > 0, 'con meses vencidos debe haber deuda');

  await em.addPago({ id: 'p1', clienteId: 'c1', monto: 15000, estado: 'activo' });
  await em.recalculateClienteDeuda('c1');
  assert.strictEqual(
    (await em.getCliente('c1')).totalAdeudado,
    Math.round((deudaSinPagos - 15000) * 100) / 100
  );
});

prueba('un pago anulado NO reduce la deuda', async () => {
  const em = await managerConCliente();
  await em.envejecerCliente('c1', 100);
  await em.recalculateClienteDeuda('c1');
  const deudaBase = (await em.getCliente('c1')).totalAdeudado;

  await em.addPago({ id: 'p1', clienteId: 'c1', monto: 15000, estado: 'anulado' });
  await em.recalculateClienteDeuda('c1');
  assert.strictEqual((await em.getCliente('c1')).totalAdeudado, deudaBase);
});

prueba('un cliente particular no factura por mes', async () => {
  const em = nuevoManager();
  await em.initialize();
  await em.addCliente({
    id: 'c1', nombre: 'Trabajo unico', honorario: 50000, tipoTrabajo: 'particular',
  });
  await em.envejecerCliente('c1', 400);          // 13 meses: no debe importar
  await em.recalculateClienteDeuda('c1');
  assert.strictEqual((await em.getCliente('c1')).totalAdeudado, 50000,
    'el particular adeuda su honorario unico, no 13 meses');
});

prueba('el mes en curso no se adeuda', async () => {
  const em = await managerConCliente();
  await em.envejecerCliente('c1', 5);            // creado hace 5 dias
  await em.recalculateClienteDeuda('c1');
  assert.strictEqual((await em.getCliente('c1')).totalAdeudado, 0,
    'cobro a mes vencido: el mes en curso todavia no se debe');
});

prueba('registrarPagoYRecalcular revierte todo si el recalculo falla', async () => {
  const em = await managerConCliente();
  const original = em._calcularFinanzasCliente.bind(em);
  em._calcularFinanzasCliente = async () => { throw new Error('falla simulada'); };
  await assert.rejects(() => em.registrarPagoYRecalcular({
    id: 'p1', clienteId: 'c1', monto: 15000, estado: 'activo',
  }));
  em._calcularFinanzasCliente = original;
  assert.strictEqual((await em.getAllPagos()).length, 0,
    'el pago no debe haber quedado guardado');
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node backend/test-migracion.js`
Expected: FALLA en las cinco pruebas nuevas

- [ ] **Step 3: Reescribir `recalculateClienteDeuda`**

La lógica de cálculo no cambia: sigue delegando en `_calcularFinanzasCliente` para honorarios, y usando la resta directa para particulares. Solo cambia dónde se guarda el resultado.

```js
  async recalculateClienteDeuda(clienteId) {
    const cliente = await this.getCliente(clienteId);
    if (!cliente) return;

    const tipoTrabajo = cliente.tipoTrabajo === 'particular' ? 'particular' : 'honorarios';
    const interesMensualActivo = Boolean(cliente.interesMensualActivo);
    const interesMensualPorcentaje = Number(cliente.interesMensualPorcentaje) || 0;

    if (tipoTrabajo === 'particular') {
      const pagos = await this.getPagosCliente(clienteId);
      const totalPagado = pagos
        .filter((p) => this.normalizePaymentStatus(p.estado) !== 'anulado')
        .reduce((suma, p) => suma + (parseFloat(p.monto) || 0), 0);
      const deudaUnica = Math.round(((cliente.honorario || 0) - totalPagado) * 100) / 100;

      this.db.prepare(`
        UPDATE clientes SET
          honorarioPeriodo = :honorario, totalAdeudado = :deuda,
          mesesAdeudados = :meses, proximaFacturacion = '',
          tipoTrabajo = 'particular', lastUpdate = :lastUpdate
        WHERE id = :id
      `).run({
        id: clienteId,
        honorario: cliente.honorario,
        deuda: deudaUnica,
        meses: deudaUnica > 0 ? 1 : 0,
        lastUpdate: new Date().toISOString(),
      });
      return;
    }

    // Honorarios: la misma regla de mes vencido que usan historial y resumen.
    const finanzas = await this._calcularFinanzasCliente(cliente);
    const deudaFinal = Math.round((finanzas.deuda || 0) * 100) / 100;
    const mesesAdeudados = (finanzas.historial || [])
      .filter((entrada) => (parseFloat(entrada.deudaPendiente) || 0) > 0).length;

    const honorarioMesActual = this._getHonorarioBaseMes(cliente, this.getCurrentMonthKey());
    const nuevoHonorarioPeriodo = this._calcularHonorarioConInteres(
      honorarioMesActual, interesMensualActivo, interesMensualPorcentaje
    );

    const ahora = new Date();
    const nextBilling = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);

    this.db.prepare(`
      UPDATE clientes SET
        honorarioPeriodo = :honorarioPeriodo, totalAdeudado = :deuda,
        mesesAdeudados = :meses, proximaFacturacion = :proxima,
        tipoTrabajo = 'honorarios', interesMensualActivo = :interesActivo,
        interesMensualPorcentaje = :interesPorcentaje, lastUpdate = :lastUpdate
      WHERE id = :id
    `).run({
      id: clienteId,
      honorarioPeriodo: nuevoHonorarioPeriodo,
      deuda: deudaFinal,
      meses: mesesAdeudados,
      proxima: nextBilling.toISOString(),
      interesActivo: interesMensualActivo ? 1 : 0,
      interesPorcentaje: interesMensualPorcentaje,
      lastUpdate: new Date().toISOString(),
    });

    console.log(`✅ Deuda recalculada para ${cliente.nombre}: $${deudaFinal}`);
  }
```

- [ ] **Step 4: Agregar `registrarPagoYRecalcular`**

```js
  // Alta de pago y recálculo como una sola unidad atómica. Con Excel eran dos
  // escrituras de archivo independientes: si el proceso moría entre medio,
  // el pago quedaba guardado y la deuda del cliente desactualizada.
  async registrarPagoYRecalcular(pago) {
    let resultado;
    await enTransaccion(this.db, () => {
      resultado = this.addPago(pago);
    });
    await this.recalculateClienteDeuda(pago.clienteId);
    return resultado;
  }
```

`_calcularFinanzasCliente` es `async`, así que no puede correr dentro del callback síncrono de `enTransaccion`. La escritura del pago es atómica y el recálculo es idempotente: si falla, la deuda se corrige en el siguiente recálculo y ningún dato se pierde. Si el pago no entra, no hay nada que recalcular.

- [ ] **Step 5: Usar el método nuevo desde la ruta de pagos**

Sin este paso `registrarPagoYRecalcular` es código muerto: `server.js` seguiría llamando a `addPago` y `recalculateClienteDeuda` por separado, que es exactamente el hueco de atomicidad que la Tarea 9 viene a cerrar.

En `backend/server.js`, dentro de `POST /api/pagos` (alrededor de la línea 907), reemplazar:

```js
    const pago = await excelManager.addPago({
      id: uuidv4(),
      clienteId,
      monto: montoNormalizado,
      tipoPago: tipoPagoFinal,
      detalles: (detalles || '').toString().slice(0, 1000),
      numeroCheque: numeroChequeFinal,
      nombreBanco: nombreBancoFinal,
      estado: 'activo',
      fecha: fecha || new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString()
    });

    console.log(`✅ Pago registrado`);

    // Recalcular la deuda del cliente después de agregar el pago
    // Esto automáticamente agrega los meses al historial
    await excelManager.recalculateClienteDeuda(clienteId);
    console.log(`✅ Deuda del cliente ${clienteId} recalculada y historial actualizado`);
```

por:

```js
    // El alta del pago y el recálculo van juntos: si el proceso muere entre
    // medio, no puede quedar un pago guardado con la deuda sin actualizar.
    const pago = await excelManager.registrarPagoYRecalcular({
      id: uuidv4(),
      clienteId,
      monto: montoNormalizado,
      tipoPago: tipoPagoFinal,
      detalles: (detalles || '').toString().slice(0, 1000),
      numeroCheque: numeroChequeFinal,
      nombreBanco: nombreBancoFinal,
      estado: 'activo',
      fecha: fecha || new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString()
    });

    console.log(`✅ Pago registrado y deuda del cliente ${clienteId} recalculada`);
```

Lo que sigue (el `getCliente` y el `res.json({ pago, cliente: clienteActualizado })`) **no se toca**: la respuesta que recibe el frontend queda idéntica.

- [ ] **Step 6: Verificar el diff de `server.js`**

Run: `git diff backend/server.js`
Expected: un único bloque de cambio, dentro de `POST /api/pagos`. Si aparece cualquier otra parte del archivo, revertir y rehacer.

- [ ] **Step 7: Correr y verificar que pasa**

Run: `node backend/test-migracion.js`
Expected: `32/32 pruebas pasaron`

- [ ] **Step 8: Commit**

```bash
git add backend/excelManager.js backend/server.js backend/test-migracion.js
git commit -m "Migrar recalculo de deuda a SQLite y hacer atomico el alta de pago"
```

---

### Task 10: Anulación de pagos y metadatos de recibo

**Files:**
- Modify: `backend/excelManager.js`
- Test: `backend/test-migracion.js`

**Interfaces:**
- Consumes: `this.db`, `getPagoById`, `recalculateClienteDeuda`.
- Produces: `anularPago(pagoId, motivo) -> Promise<object>`, `anularPagoPorReciboPath(reciboRelativePath, motivo) -> Promise<object>`, `updatePagoReciboMeta(pagoId, reciboData) -> Promise<object|null>`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
prueba('anularPago marca el estado y recalcula la deuda', async () => {
  const em = await managerConCliente();
  await em.envejecerCliente('c1', 100);
  await em.addPago({ id: 'p1', clienteId: 'c1', monto: 15000, estado: 'activo' });
  await em.recalculateClienteDeuda('c1');
  const deudaConPago = (await em.getCliente('c1')).totalAdeudado;

  const anulado = await em.anularPago('p1', 'error de carga');
  assert.strictEqual(anulado.estado, 'anulado');
  assert.strictEqual(anulado.anuladoMotivo, 'error de carga');
  assert.ok(anulado.anuladoAt !== '', 'debe registrar cuando se anulo');
  assert.strictEqual(
    (await em.getCliente('c1')).totalAdeudado,
    Math.round((deudaConPago + 15000) * 100) / 100,
    'anular devuelve la deuda'
  );
});

prueba('anularPago tira si el pago no existe', async () => {
  const em = await managerConCliente();
  await assert.rejects(() => em.anularPago('fantasma', 'x'), /Pago no encontrado/);
});

prueba('anularPagoPorReciboPath encuentra el pago por su ruta', async () => {
  const em = await managerConCliente();
  await em.addPago({ id: 'p1', clienteId: 'c1', monto: 15000, estado: 'activo' });
  await em.updatePagoReciboMeta('p1', {
    relativePath: 'Honorarios Estudio Capella/Tomas/Recibo 1.pdf',
    fileName: 'Recibo 1.pdf', numeroRecibo: 1,
  });
  const anulado = await em.anularPagoPorReciboPath(
    'Honorarios Estudio Capella/Tomas/Recibo 1.pdf', 'anulado por el estudio'
  );
  assert.strictEqual(anulado.id, 'p1');
  assert.strictEqual(anulado.estado, 'anulado');
});

prueba('updatePagoReciboMeta devuelve null si el pago no existe', async () => {
  const em = await managerConCliente();
  assert.strictEqual(
    await em.updatePagoReciboMeta('fantasma', { relativePath: 'x', fileName: 'y', numeroRecibo: 1 }),
    null
  );
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node backend/test-migracion.js`
Expected: FALLA en las cuatro pruebas nuevas

- [ ] **Step 3: Reescribir los tres métodos**

```js
  async anularPago(pagoId, motivo) {
    const pago = this.db.prepare('SELECT clienteId FROM pagos WHERE id = ?').get(pagoId);
    if (!pago) throw new Error('Pago no encontrado');

    const ahora = new Date().toISOString();
    this.db.prepare(`
      UPDATE pagos SET estado = 'anulado', anuladoAt = ?, anuladoMotivo = ?, timestamp = ?
      WHERE id = ?
    `).run(ahora, (motivo || '').toString().slice(0, 250), ahora, pagoId);

    if (pago.clienteId) {
      await this.recalculateClienteDeuda(pago.clienteId);
    }
    return this.getPagoById(pagoId);
  }

  async anularPagoPorReciboPath(reciboRelativePath, motivo) {
    const pathKey = (reciboRelativePath || '').toString().trim();
    if (!pathKey) throw new Error('Ruta de recibo inválida');

    // Con idx_pagos_recibo esto es una búsqueda por índice, no un escaneo.
    const pago = this.db.prepare(
      'SELECT id FROM pagos WHERE TRIM(reciboRelativePath) = ?'
    ).get(pathKey);
    if (!pago) throw new Error('No se encontró un pago vinculado a ese recibo');

    return this.anularPago(pago.id, motivo);
  }

  async updatePagoReciboMeta(pagoId, reciboData) {
    const { changes } = this.db.prepare(`
      UPDATE pagos SET
        reciboRelativePath = :relativePath,
        reciboFileName = :fileName,
        reciboNumero = :numeroRecibo,
        estado = CASE WHEN estado IS NULL OR estado = '' THEN 'activo' ELSE estado END
      WHERE id = :id
    `).run({
      id: pagoId,
      relativePath: (reciboData?.relativePath || '').toString(),
      fileName: (reciboData?.fileName || '').toString(),
      numeroRecibo: Number.isInteger(reciboData?.numeroRecibo) ? reciboData.numeroRecibo : null,
    });

    if (changes === 0) return null;
    return this.getPagoById(pagoId);
  }
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node backend/test-migracion.js`
Expected: `36/36 pruebas pasaron`

- [ ] **Step 5: Commit**

```bash
git add backend/excelManager.js backend/test-migracion.js
git commit -m "Migrar anulacion de pagos y metadatos de recibo a SQLite"
```

---

### Task 11: Historial, resumen y sincronización

**Files:**
- Modify: `backend/excelManager.js`, `backend/rebuild-historial.js`
- Test: `backend/test-migracion.js`

**Interfaces:**
- Consumes: `this.db`, `filaAHistorial`, `getClientes`, `getAllPagos`.
- Produces: `addHistorialEntry(clienteId, nombreCliente, mesFacturado, honorario) -> Promise<{success, alreadyExists?}>`, `getAllHistorial() -> Promise<object[]>`, `reiniciarTodosDatos() -> Promise<{success, message}>`.

`getHistorialCliente`, `getResumen`, `getChangesAfter` y `getHonorarioConfig` **no se modifican**: ya operan sobre `getClientes()`, `getAllPagos()` y `_calcularFinanzasCliente()`, que a esta altura son todos SQL.

- [ ] **Step 1: Escribir los tests que fallan**

```js
prueba('addHistorialEntry no duplica el mismo mes', async () => {
  const em = await managerConCliente();
  const primera = await em.addHistorialEntry('c1', 'Cliente c1', '01-2025', 15000);
  assert.strictEqual(primera.alreadyExists, undefined);
  const segunda = await em.addHistorialEntry('c1', 'Cliente c1', '01-2025', 99999);
  assert.strictEqual(segunda.alreadyExists, true);
  assert.strictEqual((await em.getAllHistorial()).length, 1);
});

prueba('getAllHistorial expone la clave comision con tilde', async () => {
  const em = await managerConCliente();
  await em.addHistorialEntry('c1', 'Cliente c1', '01-2025', 15000);
  const entrada = (await em.getAllHistorial())[0];
  assert.strictEqual(entrada['comisión'], 15000);
  assert.strictEqual(entrada.mes, '01-2025');
});

prueba('reiniciarTodosDatos deja las tres tablas vacias', async () => {
  const em = await managerConCliente();
  await em.addPago({ id: 'p1', clienteId: 'c1', monto: 100, estado: 'activo' });
  await em.addHistorialEntry('c1', 'Cliente c1', '01-2025', 15000);
  await em.reiniciarTodosDatos();
  assert.deepStrictEqual(await em.getClientes(), []);
  assert.deepStrictEqual(await em.getAllPagos(), []);
  assert.deepStrictEqual(await em.getAllHistorial(), []);
});

prueba('getResumen suma solo la deuda de los clientes que deben', async () => {
  const em = nuevoManager();
  await em.initialize();
  await em.addCliente({ id: 'c1', nombre: 'Debe', honorario: 15000 });
  await em.addCliente({ id: 'c2', nombre: 'Al dia', honorario: 15000 });
  await em.envejecerCliente('c1', 100);
  await em.recalculateClienteDeuda('c1');
  await em.recalculateClienteDeuda('c2');

  const resumen = await em.getResumen();
  assert.strictEqual(resumen.totalClientes, 2);
  assert.strictEqual(resumen.clientesConDeuda, 1);
  assert.strictEqual(resumen.clientesPagoDia, 1);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node backend/test-migracion.js`
Expected: FALLA en las cuatro pruebas nuevas

- [ ] **Step 3: Reescribir los métodos de historial y el reinicio**

```js
  async addHistorialEntry(clienteId, nombreCliente, mesFacturado, honorario) {
    const yaExiste = this.db.prepare(
      'SELECT 1 FROM historial WHERE clienteId = ? AND mes = ?'
    ).get(clienteId, mesFacturado);

    if (yaExiste) {
      console.log(`⚠️ El mes ${mesFacturado} ya está registrado para este cliente`);
      return { success: true, alreadyExists: true };
    }

    this.db.prepare(`
      INSERT INTO historial (id, clienteId, nombreCliente, mes, comision, fechaCobro, timestamp)
      VALUES (:id, :clienteId, :nombreCliente, :mes, :comision, :fechaCobro, :timestamp)
    `).run({
      id: `${clienteId}_${mesFacturado}`,
      clienteId,
      nombreCliente,
      mes: mesFacturado,
      comision: Math.round((parseFloat(honorario) || 0) * 100) / 100,
      fechaCobro: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }

  async getAllHistorial() {
    const filas = this.db.prepare('SELECT * FROM historial ORDER BY rowid').all();
    return filas.map(filaAHistorial);
  }

  async reiniciarTodosDatos() {
    console.log('🗑️ REINICIANDO TODOS LOS DATOS...');
    enTransaccion(this.db, () => {
      // pagos e historial primero: las foreign keys apuntan a clientes.
      this.db.prepare('DELETE FROM pagos').run();
      this.db.prepare('DELETE FROM historial').run();
      this.db.prepare('DELETE FROM clientes').run();
    });
    console.log('✅ TODOS LOS DATOS REINICIADOS A CERO');
    return { success: true, message: 'Todos los datos han sido reiniciados a cero' };
  }
```

- [ ] **Step 4: Portar `rebuild-historial.js`**

El bucle de reconstrucción no cambia: ya opera con `getClientes()`, `getHistorialCliente()` y `addHistorialEntry()`, todos migrados. Lo que hay que reemplazar es el preámbulo, que hoy hace backup del `.xlsx`, lo borra y lo recrea con `initializeHistoricalFile()` — método que ya no existe.

Reemplazar el archivo completo por:

```js
const ExcelManager = require('./excelManager');

async function main() {
  const excelManager = new ExcelManager();

  try {
    await excelManager.initialize();

    // Antes se hacía copia del .xlsx y se borraba el archivo. Ahora el backup
    // del día ya cubre la base entera (ver createDataZipBackup en server.js),
    // así que acá solo se vacía la tabla para reconstruirla limpia.
    const { n: previas } = excelManager.db
      .prepare('SELECT COUNT(*) n FROM historial').get();
    excelManager.db.prepare('DELETE FROM historial').run();
    console.log(`Historial vaciado para reconstruccion limpia (${previas} entradas previas)`);

    const clientes = await excelManager.getClientes();
    let clientesProcesados = 0;
    let entradasAgregadas = 0;

    for (const cliente of clientes) {
      clientesProcesados += 1;

      const historialCalculado = await excelManager.getHistorialCliente(cliente.id);
      for (const item of historialCalculado) {
        const monto = parseFloat(item.deuda) || 0;
        const result = await excelManager.addHistorialEntry(
          cliente.id,
          cliente.nombre,
          item.mes,
          monto
        );

        if (!result.alreadyExists) {
          entradasAgregadas += 1;
        }
      }
    }

    console.log('Reconstruccion finalizada');
    console.log(`Clientes procesados: ${clientesProcesados}`);
    console.log(`Entradas agregadas: ${entradasAgregadas}`);
  } catch (error) {
    console.error('Error reconstruyendo historial:', error.message);
    process.exitCode = 1;
  }
}

main();
```

Desaparecen los `require` de `fs` y `path` y el helper `stampForFile()`, que solo servían para nombrar el backup del `.xlsx`.

Run: `node backend/rebuild-historial.js`
Expected: `Reconstruccion finalizada` con la cantidad de clientes procesados, sin error.

- [ ] **Step 5: Correr y verificar que pasa**

Run: `node backend/test-migracion.js`
Expected: `40/40 pruebas pasaron`

- [ ] **Step 6: Commit**

```bash
git add backend/excelManager.js backend/rebuild-historial.js backend/test-migracion.js
git commit -m "Migrar historial y reinicio de datos a SQLite"
```

---

### Task 12: Script de migración — traspaso de datos

**Files:**
- Create: `backend/migrar-a-sqlite.js`

**Interfaces:**
- Consumes: `ExcelManagerXlsx` de `./legacy/excelManagerXlsx`, `ExcelManager` de `./excelManager`.
- Produces: ejecutable por CLI. Escribe `data/capella.db` y `data/migracion-verificacion.txt`.

- [ ] **Step 1: Escribir el traspaso**

```js
#!/usr/bin/env node
// Migración de una sola vez: lee los .xlsx y escribe data/capella.db.
// Los .xlsx se abren SOLO EN LECTURA y nunca se modifican ni se borran:
// esa es la base de la vuelta atrás.
const fs = require('node:fs');
const path = require('node:path');

const ExcelManagerXlsx = require('./legacy/excelManagerXlsx');
const ExcelManager = require('./excelManager');

const DATA_DIR = path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'capella.db');
const REPORTE_PATH = path.join(DATA_DIR, 'migracion-verificacion.txt');

const forzar = process.argv.includes('--force');

// Backup ZIP de data/ antes de tocar nada. No se reusa createDataZipBackup()
// de server.js porque importarlo levanta el servidor entero (server.js llama a
// app.listen al cargarse). Son 12 líneas contra arrancar un puerto de más.
function backupPrevio() {
  const archiver = require('archiver');
  const backupsDir = path.join(__dirname, '../backups');
  fs.mkdirSync(backupsDir, { recursive: true });

  const nombre = `pre-migracion-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
  const destino = path.join(backupsDir, nombre);

  return new Promise((resolve, reject) => {
    const salida = fs.createWriteStream(destino);
    const zip = archiver('zip', { zlib: { level: 9 } });
    salida.on('close', () => resolve(destino));
    zip.on('error', reject);
    zip.pipe(salida);
    zip.directory(DATA_DIR, 'data');
    zip.finalize();
  });
}

async function migrar() {
  if (fs.existsSync(DB_PATH) && !forzar) {
    console.error(`✖ Ya existe ${DB_PATH}. Usá --force para sobrescribir.`);
    process.exit(1);
  }

  const zipPath = await backupPrevio();
  console.log(`✓ Backup previo: ${zipPath}`);

  if (fs.existsSync(DB_PATH) && forzar) {
    fs.unlinkSync(DB_PATH);
    console.log('⚠ Base anterior eliminada por --force');
  }

  const viejo = new ExcelManagerXlsx();
  const nuevo = new ExcelManager(DB_PATH);
  await nuevo.initialize();

  const clientes = await viejo.getClientes();
  const pagos = await viejo.getAllPagos();
  const historial = await viejo.getAllHistorial();

  console.log(`Leído de Excel: ${clientes.length} clientes, ${pagos.length} pagos, ${historial.length} entradas de historial`);

  const insCliente = nuevo.db.prepare(`
    INSERT INTO clientes (
      id, nombre, telefono, honorario, honorarioPeriodo, totalAdeudado,
      proximaFacturacion, fechaCreacion, tipoTrabajo, interesMensualActivo,
      interesMensualPorcentaje, lastUpdate, dniCuit, honorariosProgramados, mesesAdeudados
    ) VALUES (
      :id, :nombre, :telefono, :honorario, :honorarioPeriodo, :totalAdeudado,
      :proximaFacturacion, :fechaCreacion, :tipoTrabajo, :interesMensualActivo,
      :interesMensualPorcentaje, :lastUpdate, :dniCuit, :honorariosProgramados, :mesesAdeudados
    )`);

  const insPago = nuevo.db.prepare(`
    INSERT INTO pagos (
      id, clienteId, monto, tipoPago, detalles, fecha, timestamp, numeroCheque,
      nombreBanco, estado, anuladoAt, anuladoMotivo, reciboRelativePath,
      reciboFileName, reciboNumero
    ) VALUES (
      :id, :clienteId, :monto, :tipoPago, :detalles, :fecha, :timestamp, :numeroCheque,
      :nombreBanco, :estado, :anuladoAt, :anuladoMotivo, :reciboRelativePath,
      :reciboFileName, :reciboNumero
    )`);

  const insHistorial = nuevo.db.prepare(`
    INSERT INTO historial (id, clienteId, nombreCliente, mes, comision, fechaCobro, timestamp)
    VALUES (:id, :clienteId, :nombreCliente, :mes, :comision, :fechaCobro, :timestamp)`);

  // Normaliza a texto ISO lo que ExcelJS pudo devolver como Date.
  const aTexto = (valor) => {
    if (valor === null || valor === undefined) return '';
    if (valor instanceof Date) return valor.toISOString();
    return valor.toString();
  };

  const idsClientes = new Set(clientes.map((c) => c.id));
  const pagosHuerfanos = [];

  nuevo.db.exec('BEGIN');
  try {
    for (const c of clientes) {
      insCliente.run({
        id: c.id,
        nombre: c.nombre,
        telefono: aTexto(c.telefono),
        honorario: parseFloat(c.honorario) || 0,
        honorarioPeriodo: parseFloat(c.honorarioPeriodo) || 0,
        totalAdeudado: parseFloat(c.totalAdeudado) || 0,
        proximaFacturacion: aTexto(c.proximaFacturacion),
        fechaCreacion: aTexto(c.fechaCreacion),
        tipoTrabajo: c.tipoTrabajo === 'particular' ? 'particular' : 'honorarios',
        interesMensualActivo: c.interesMensualActivo ? 1 : 0,
        interesMensualPorcentaje: Number(c.interesMensualPorcentaje) || 0,
        lastUpdate: aTexto(c.lastUpdate),
        dniCuit: aTexto(c.dniCuit),
        honorariosProgramados: JSON.stringify(c.honorariosProgramados || {}),
        mesesAdeudados: parseInt(c.mesesAdeudados, 10) || 0,
      });
    }

    for (const p of pagos) {
      // Un pago sin cliente vivo no puede entrar: la foreign key lo rechazaría
      // y abortaría toda la migración. Se aparta y se reporta.
      if (!idsClientes.has(p.clienteId)) {
        pagosHuerfanos.push(p);
        continue;
      }
      insPago.run({
        id: p.id,
        clienteId: p.clienteId,
        monto: parseFloat(p.monto) || 0,
        tipoPago: p.tipoPago || 'Efectivo',
        detalles: aTexto(p.detalles),
        fecha: aTexto(p.fecha),
        timestamp: aTexto(p.timestamp),
        numeroCheque: aTexto(p.numeroCheque),
        nombreBanco: aTexto(p.nombreBanco),
        estado: p.estado === 'anulado' ? 'anulado' : 'activo',
        anuladoAt: aTexto(p.anuladoAt),
        anuladoMotivo: aTexto(p.anuladoMotivo),
        reciboRelativePath: aTexto(p.reciboRelativePath),
        reciboFileName: aTexto(p.reciboFileName),
        reciboNumero: Number.isInteger(p.reciboNumero) ? p.reciboNumero : null,
      });
    }

    for (const h of historial) {
      if (!idsClientes.has(h.clienteId)) continue;
      insHistorial.run({
        id: h.id,
        clienteId: h.clienteId,
        nombreCliente: aTexto(h.nombreCliente),
        mes: aTexto(h.mes),
        comision: parseFloat(h['comisión']) || 0,
        fechaCobro: aTexto(h.fechaCobro),
        timestamp: aTexto(h.timestamp),
      });
    }

    nuevo.db.exec('COMMIT');
  } catch (error) {
    nuevo.db.exec('ROLLBACK');
    console.error('✖ La migración falló y se revirtió por completo:', error.message);
    process.exit(1);
  }

  console.log('✓ Datos traspasados');
  return { viejo, nuevo, clientes, pagos, historial, pagosHuerfanos };
}

module.exports = { migrar, DB_PATH, REPORTE_PATH };

if (require.main === module) {
  migrar().then(() => console.log('Traspaso completo. Falta la verificación (Tarea 13).'));
}
```

- [ ] **Step 2: Ensayar el traspaso**

Este paso es un **ensayo**, no la migración de verdad. Se corre contra los datos de prueba de la máquina de desarrollo, o sin datos si no hay. La `capella.db` que salga se descarta.

Run: `node backend/migrar-a-sqlite.js`
Expected: imprime `✓ Backup previo: backups/pre-migracion-....zip`, los conteos leídos y `✓ Datos traspasados`. Si `data/` está vacío, imprime ceros sin error — eso también es un resultado válido y prueba que el script no se rompe con una base vacía.

Confirmar que el ZIP existe: `ls -la backups/pre-migracion-*.zip`

- [ ] **Step 3: Verificar que se niega a pisar una base existente**

Run: `node backend/migrar-a-sqlite.js`
Expected: `✖ Ya existe ... Usá --force para sobrescribir.` y código de salida 1.

- [ ] **Step 4: Commit**

```bash
git add backend/migrar-a-sqlite.js
git commit -m "Agregar traspaso de datos de Excel a SQLite"
```

---

### Task 13: Script de migración — los 7 chequeos de verificación

**Files:**
- Modify: `backend/migrar-a-sqlite.js`

**Interfaces:**
- Consumes: el objeto devuelto por `migrar()`.
- Produces: `verificar(contexto) -> Promise<{ok, lineas}>`; escribe `data/migracion-verificacion.txt`; sale con código 1 si algo no coincide.

- [ ] **Step 1: Escribir la verificación**

Reemplazar el bloque `if (require.main === module)` del final por:

```js
async function verificar({ viejo, nuevo, clientes, pagos, historial, pagosHuerfanos }) {
  const lineas = [];
  let ok = true;
  const chequeo = (nombre, condicion, detalle = '') => {
    lineas.push(`${condicion ? 'OK  ' : 'FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
    if (!condicion) ok = false;
  };

  const centavos = (n) => Math.round((parseFloat(n) || 0) * 100);

  // 1. Conteos
  const nClientes = nuevo.db.prepare('SELECT COUNT(*) n FROM clientes').get().n;
  const nPagos = nuevo.db.prepare('SELECT COUNT(*) n FROM pagos').get().n;
  const nHistorial = nuevo.db.prepare('SELECT COUNT(*) n FROM historial').get().n;
  chequeo('1. Cantidad de clientes', nClientes === clientes.length,
    `excel=${clientes.length} sqlite=${nClientes}`);
  chequeo('1. Cantidad de pagos', nPagos === pagos.length - pagosHuerfanos.length,
    `excel=${pagos.length} huerfanos=${pagosHuerfanos.length} sqlite=${nPagos}`);
  chequeo('1. Cantidad de historial', nHistorial <= historial.length,
    `excel=${historial.length} sqlite=${nHistorial}`);

  if (pagosHuerfanos.length > 0) {
    ok = false;
    lineas.push(`FALLA 1b. Hay ${pagosHuerfanos.length} pago(s) sin cliente existente:`);
    for (const p of pagosHuerfanos) {
      lineas.push(`        pago ${p.id} apunta al cliente inexistente ${p.clienteId} ($${p.monto})`);
    }
  }

  // 2. Pagos por estado
  for (const estado of ['activo', 'anulado']) {
    const enExcel = pagos.filter(
      (p) => viejo.normalizePaymentStatus(p.estado) === estado
        && !pagosHuerfanos.includes(p)
    ).length;
    const enSqlite = nuevo.db.prepare('SELECT COUNT(*) n FROM pagos WHERE estado = ?')
      .get(estado).n;
    chequeo(`2. Pagos en estado ${estado}`, enExcel === enSqlite,
      `excel=${enExcel} sqlite=${enSqlite}`);
  }

  // 3. Suma de montos
  for (const estado of ['activo', 'anulado']) {
    const sumaExcel = pagos
      .filter((p) => viejo.normalizePaymentStatus(p.estado) === estado && !pagosHuerfanos.includes(p))
      .reduce((s, p) => s + centavos(p.monto), 0);
    const sumaSqlite = centavos(
      nuevo.db.prepare('SELECT COALESCE(SUM(monto),0) s FROM pagos WHERE estado = ?')
        .get(estado).s
    );
    chequeo(`3. Suma de montos ${estado}`, sumaExcel === sumaSqlite,
      `excel=${sumaExcel / 100} sqlite=${sumaSqlite / 100}`);
  }

  // 4. Deuda por cliente — la prueba real
  let deudasIguales = 0;
  for (const clienteExcel of clientes) {
    const clienteSqlite = await nuevo.getCliente(clienteExcel.id);
    if (!clienteSqlite) {
      chequeo(`4. Cliente ${clienteExcel.nombre}`, false, 'no existe en SQLite');
      continue;
    }
    const finExcel = await viejo._calcularFinanzasCliente(clienteExcel);
    const finSqlite = await nuevo._calcularFinanzasCliente(clienteSqlite);

    const deudaIgual = centavos(finExcel.deuda) === centavos(finSqlite.deuda);
    const mesesIgual = finExcel.historial.length === finSqlite.historial.length;

    if (deudaIgual && mesesIgual) {
      deudasIguales++;
    } else {
      chequeo(`4. Deuda de ${clienteExcel.nombre} (${clienteExcel.id})`, false,
        `excel=$${finExcel.deuda} (${finExcel.historial.length} meses) ` +
        `sqlite=$${finSqlite.deuda} (${finSqlite.historial.length} meses)`);
    }
  }
  chequeo(`4. Deuda coincide al centavo en los ${clientes.length} clientes`,
    deudasIguales === clientes.length, `coinciden ${deudasIguales}/${clientes.length}`);

  // 5. Vínculos con los recibos
  let recibosIguales = 0;
  for (const pagoExcel of pagos) {
    if (pagosHuerfanos.includes(pagoExcel)) continue;
    const pagoSqlite = await nuevo.getPagoById(pagoExcel.id);
    const igual = pagoSqlite
      && pagoSqlite.reciboRelativePath === pagoExcel.reciboRelativePath
      && pagoSqlite.reciboFileName === pagoExcel.reciboFileName
      && pagoSqlite.reciboNumero === pagoExcel.reciboNumero;
    if (igual) {
      recibosIguales++;
    } else {
      chequeo(`5. Recibo del pago ${pagoExcel.id}`, false,
        `excel="${pagoExcel.reciboRelativePath}" sqlite="${pagoSqlite?.reciboRelativePath}"`);
    }
  }
  chequeo('5. Vínculos de recibo intactos',
    recibosIguales === pagos.length - pagosHuerfanos.length,
    `coinciden ${recibosIguales}/${pagos.length - pagosHuerfanos.length}`);

  // 6. honorariosProgramados, clave por clave
  let programadosIguales = 0;
  for (const clienteExcel of clientes) {
    const clienteSqlite = await nuevo.getCliente(clienteExcel.id);
    const a = clienteExcel.honorariosProgramados || {};
    const b = clienteSqlite?.honorariosProgramados || {};
    const clavesA = Object.keys(a).sort();
    const clavesB = Object.keys(b).sort();
    const igual = clavesA.length === clavesB.length
      && clavesA.every((k, i) => k === clavesB[i] && centavos(a[k]) === centavos(b[k]));
    if (igual) {
      programadosIguales++;
    } else {
      const faltantes = clavesA.filter((k) => !(k in b));
      chequeo(`6. honorariosProgramados de ${clienteExcel.nombre}`, false,
        `excel=${clavesA.length} claves, sqlite=${clavesB.length}` +
        (faltantes.length ? `, faltan: ${faltantes.join(', ')}` : ''));
    }
  }
  chequeo('6. honorariosProgramados idénticos',
    programadosIguales === clientes.length,
    `coinciden ${programadosIguales}/${clientes.length}`);

  // 7. Fechas: el mes de inicio debe ser el mismo en ambos motores
  let fechasIguales = 0;
  for (const clienteExcel of clientes) {
    const clienteSqlite = await nuevo.getCliente(clienteExcel.id);
    const mesExcel = viejo.formatearMes(new Date(clienteExcel.fechaCreacion));
    const mesSqlite = nuevo.formatearMes(new Date(clienteSqlite.fechaCreacion));
    if (mesExcel === mesSqlite) {
      fechasIguales++;
    } else {
      chequeo(`7. Mes de inicio de ${clienteExcel.nombre}`, false,
        `excel=${mesExcel} sqlite=${mesSqlite}`);
    }
  }
  chequeo('7. Mes de inicio idéntico', fechasIguales === clientes.length,
    `coinciden ${fechasIguales}/${clientes.length}`);

  return { ok, lineas };
}

if (require.main === module) {
  migrar()
    .then(async (contexto) => {
      const { ok, lineas } = await verificar(contexto);
      const encabezado = [
        `Verificación de migración Excel → SQLite`,
        `Fecha: ${new Date().toISOString()}`,
        `Clientes: ${contexto.clientes.length} | Pagos: ${contexto.pagos.length} | Historial: ${contexto.historial.length}`,
        '',
      ];
      const reporte = [...encabezado, ...lineas, '',
        ok ? 'RESULTADO: migración verificada.' : 'RESULTADO: MIGRACIÓN FALLIDA — revisar las líneas FALLA.',
      ].join('\n');

      fs.writeFileSync(REPORTE_PATH, reporte, 'utf8');
      console.log(`\n${reporte}\n`);
      console.log(`Reporte guardado en ${REPORTE_PATH}`);

      if (!ok) {
        console.error('✖ La verificación encontró diferencias. NO usar esta base.');
        process.exit(1);
      }
      console.log('✓ Migración verificada.');
    })
    .catch((error) => {
      console.error('✖ Error durante la migración:', error);
      process.exit(1);
    });
}

module.exports = { migrar, verificar, DB_PATH, REPORTE_PATH };
```

- [ ] **Step 2: Ensayar la verificación completa**

Otra vez: ensayo con los datos de prueba, la base resultante se descarta. Lo que se está probando acá es **el script**, no los datos.

```bash
rm -f data/capella.db
node backend/migrar-a-sqlite.js
```

Expected: imprime los 7 grupos de chequeos, todos `OK`, y `✓ Migración verificada.` Sale con código 0.

Si no hay datos de prueba en `data/`, los chequeos pasan con cero elementos. Eso prueba que el script corre, pero **no** prueba que la verificación detecte diferencias: para eso está el Step 3, que es el que realmente importa.

- [ ] **Step 3: Verificar que detecta una corrupción deliberada**

La verificación no vale nada si no falla cuando debe. Alterar un monto a mano y confirmar que el chequeo 3 y el 4 lo detectan:

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/capella.db');
db.prepare('UPDATE pagos SET monto = monto + 1 WHERE rowid = (SELECT MIN(rowid) FROM pagos)').run();
"
node backend/migrar-a-sqlite.js --force
```

Nota: `--force` vuelve a migrar desde Excel, así que la corrupción se pierde. Para probar la detección de verdad, correr `verificar()` sobre la base corrupta sin re-migrar:

```bash
node -e "
const {verificar}=require('./backend/migrar-a-sqlite');
const Viejo=require('./backend/legacy/excelManagerXlsx');
const Nuevo=require('./backend/excelManager');
(async()=>{
  const viejo=new Viejo(), nuevo=new Nuevo('data/capella.db');
  const r=await verificar({viejo,nuevo,
    clientes:await viejo.getClientes(),pagos:await viejo.getAllPagos(),
    historial:await viejo.getAllHistorial(),pagosHuerfanos:[]});
  console.log(r.ok ? 'NO DETECTO LA CORRUPCION (mal)' : 'Detecto la corrupcion (bien)');
})();
"
```

Expected: `Detecto la corrupcion (bien)`

Después, regenerar limpio: `node backend/migrar-a-sqlite.js --force`

- [ ] **Step 4: Commit**

```bash
git add backend/migrar-a-sqlite.js
git commit -m "Agregar los 7 chequeos de verificacion de la migracion"
```

---

### Task 14: Benchmark de regresión

**Files:**
- Create: `backend/bench-pagos.js`

**Interfaces:**
- Consumes: `ExcelManager`.
- Produces: ejecutable por CLI; imprime el tiempo de un alta de pago sobre un histórico sintético.

- [ ] **Step 1: Escribir el benchmark**

```js
#!/usr/bin/env node
// Prueba de regresión de rendimiento: confirma con números que la migración
// eliminó el costo lineal por pago. Trabaja en un temporal, nunca en data/.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelManager = require('./excelManager');

const N_CLIENTES = 200;
const N_PAGOS = Number(process.argv[2] || 40000);
const LIMITE_MS = 50;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capella-bench-'));
  const em = new ExcelManager(path.join(dir, 'capella.db'));
  await em.initialize();

  const vieja = new Date(Date.now() - 400 * 864e5).toISOString();
  em.db.exec('BEGIN');
  const insC = em.db.prepare(
    'INSERT INTO clientes (id,nombre,honorario,fechaCreacion,tipoTrabajo) VALUES (?,?,?,?,?)'
  );
  for (let i = 0; i < N_CLIENTES; i++) {
    insC.run(`cli-${i}`, `Cliente ${i}`, 15000, vieja, 'honorarios');
  }
  const insP = em.db.prepare(
    'INSERT INTO pagos (id,clienteId,monto,tipoPago,estado) VALUES (?,?,?,?,?)'
  );
  for (let i = 0; i < N_PAGOS; i++) {
    insP.run(`p-${i}`, `cli-${i % N_CLIENTES}`, 15000, 'Efectivo', 'activo');
  }
  em.db.exec('COMMIT');

  const t0 = process.hrtime.bigint();
  await em.registrarPagoYRecalcular({
    id: 'bench-1', clienteId: 'cli-100', monto: 15000, tipoPago: 'Efectivo',
    detalles: '', fecha: '2025-06-01', timestamp: new Date().toISOString(),
    numeroCheque: '', nombreBanco: '', estado: 'activo',
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  console.log(`Histórico: ${N_PAGOS} pagos, ${N_CLIENTES} clientes`);
  console.log(`Alta de pago + recálculo: ${ms.toFixed(1)}ms  (antes de migrar: 9772ms)`);

  fs.rmSync(dir, { recursive: true, force: true });

  if (ms > LIMITE_MS) {
    console.error(`✖ Supera el límite de ${LIMITE_MS}ms del criterio de éxito.`);
    process.exit(1);
  }
  console.log('✓ Dentro del criterio de éxito.');
})();
```

- [ ] **Step 2: Correr el benchmark**

Run: `node backend/bench-pagos.js`
Expected: menos de 50 ms y `✓ Dentro del criterio de éxito.`

- [ ] **Step 3: Commit**

```bash
git add backend/bench-pagos.js
git commit -m "Agregar benchmark de regresion de alta de pago"
```

---

### Task 15: Backup consistente del `.db`

**Files:**
- Modify: `backend/server.js` (solo dentro de `createDataZipBackup`, líneas ~45-75)

**Interfaces:**
- Consumes: `excelManager.db`.
- Produces: `createDataZipBackup()` con el mismo comportamiento externo.

- [ ] **Step 1: Leer la función actual**

```bash
sed -n '40,80p' backend/server.js
```

- [ ] **Step 2: Agregar el snapshot antes de comprimir**

Dentro de `createDataZipBackup()`, justo antes de `archive.directory(DATA_DIR, 'data')`, insertar:

```js
  // Copiar un SQLite mientras hay una escritura en vuelo puede producir una
  // copia corrupta. VACUUM INTO genera un snapshot consistente sin bloquear.
  const snapshotPath = path.join(DATA_DIR, '_backup_capella.db');
  try {
    await fs.promises.unlink(snapshotPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  excelManager.db.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);
```

Y después de que el ZIP se haya cerrado, borrar el snapshot:

```js
  try {
    await fs.promises.unlink(snapshotPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
```

- [ ] **Step 3: Probar el backup**

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
require('./backend/server.js');
setTimeout(()=>process.exit(0), 4000);
"
ls -la backups/
```

Expected: aparece un ZIP del día y **no** queda un `data/_backup_capella.db` colgado.

- [ ] **Step 4: Commit**

```bash
git add backend/server.js
git commit -m "Usar VACUUM INTO para un backup consistente del .db"
```

---

### Task 16: Cutover — limpieza y arranque

**Files:**
- Delete: `backend/legacy/excelManagerXlsx.js`
- Modify: `SW-Capella-Codigo/CLAUDE.md` (el de la raíz del repo)
- Modify: `iniciar.bat` (solo si la PC del estudio corre Node 22)

**Interfaces:** ninguna.

Esta tarea se ejecuta **después** de correr la migración verificada en la PC del estudio.

- [ ] **Step 1: Confirmar la versión de Node en la PC del estudio**

Run: `node --version`

- Si empieza con `v24` o superior: nada que hacer.
- Si empieza con `v22`: editar `iniciar.bat` y cambiar `node server.js` por `node --experimental-sqlite server.js`. Dejar anotado en el commit que conviene actualizar a Node 24.

- [ ] **Step 2: Correr la migración verificada en la PC del estudio**

```bash
node backend/migrar-a-sqlite.js
```

Expected: los 7 chequeos en `OK` y `✓ Migración verificada.`

**Si algún chequeo falla, detenerse acá.** No borrar nada, no seguir. Revisar `data/migracion-verificacion.txt`, corregir, y volver a correr con `--force`.

- [ ] **Step 3: Arrancar y probar a mano el flujo completo**

Arrancar el sistema y verificar en la interfaz:

1. La pestaña General muestra la misma deuda total que antes de migrar.
2. Registrar un pago de prueba a un cliente real: debe ser instantáneo.
3. El recibo PDF se genera y aparece en la lista de recibos.
4. Anular ese recibo: el archivo se renombra con `[ANULADO]` y la deuda vuelve a su valor.
5. Editar el teléfono de un cliente y confirmar que persiste.

- [ ] **Step 4: Borrar la copia congelada**

```bash
git rm -r backend/legacy
```

- [ ] **Step 5: Actualizar la documentación del proyecto**

En `CLAUDE.md`, reemplazar la sección "Data layer — Excel files, no database" por la descripción de SQLite: un solo `data/capella.db`, las tres tablas, los PRAGMAs, y que `node:sqlite` no requiere dependencias. Actualizar también la tabla de comandos con `node backend/test-migracion.js` y `node backend/bench-pagos.js`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Completar cutover a SQLite y borrar el lector Excel congelado"
```

---

## Vuelta atrás

Si algo sale mal después del cutover, en la PC del estudio:

```bash
git revert --no-commit HEAD~5..HEAD   # ajustar el rango a los commits de la migración
rm data/capella.db
```

Los tres `.xlsx` siguen intactos en `data/` porque ninguna tarea los modificó. El sistema arranca como antes, lento pero correcto. No hay backup que restaurar ni migración a medias que deshacer.

## Criterio de éxito

- [ ] `node backend/test-migracion.js` → 40/40 pruebas pasan
- [ ] `node backend/migrar-a-sqlite.js` → los 7 chequeos en OK contra los datos reales del estudio
- [ ] `node backend/bench-pagos.js` → menos de 50 ms con 40.000 pagos (antes: 9.772 ms)
- [ ] `git diff` sobre `server.js` muestra exactamente dos bloques: uno en `POST /api/pagos` y otro en `createDataZipBackup()`
- [ ] El sistema arranca en la PC del estudio sin instalar ninguna dependencia nueva

# Migración de SW-Capella de Excel a SQLite

Fecha: 2026-09-16
Estado: aprobado, pendiente de plan de implementación

## Problema

Registrar un pago tarda varios segundos y empeora sin parar. La causa está medida, no supuesta.

`exceljs` no puede agregar una fila a un archivo existente. `workbook.xlsx.writeFile()` serializa
todas las filas, vuelve a comprimir el workbook completo y reescribe el archivo desde cero. Guardar
un pago reescribe todos los pagos de la historia, así que el costo de cada operación es proporcional
al volumen acumulado.

Medición sobre los caminos calientes reales, con 200 clientes fijos y variando el histórico:

| pagos en `pagos.xlsx` | tamaño  | `POST /api/pagos` |
|-----------------------|---------|-------------------|
| 500                   | 30 KB   | 98 ms             |
| 2.000                 | 99 KB   | 304 ms            |
| 5.000                 | 240 KB  | 526 ms            |
| 10.000                | 474 KB  | 1.024 ms          |
| 20.000                | 940 KB  | 2.015 ms          |
| 40.000                | 1,9 MB  | 4.035 ms          |

El crecimiento es lineal. La interfaz además llama a `/api/generar-recibo` inmediatamente después,
que reescribe el mismo archivo por segunda vez: el flujo completo con 40.000 pagos tarda **9.772 ms**.

Lo que **no** es el problema, también medido:

- `_calcularFinanzasCliente` (el motor de deuda) corre en 2 ms
- `GET /clientes` y `GET /resumen` tardan 1 ms en caliente, 14 ms en frío
- el polling de 5 segundos del frontend
- el índice de recibos, que ya está cacheado en JSON

Con `node:sqlite`, un INSERT equivalente tarda 0,03 ms y no crece con el volumen.

## Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Motor | `node:sqlite` | Incluido en el runtime. Cero dependencias nuevas, ningún módulo nativo que compilar o distribuir. |
| Alcance | Los tres archivos | Decisión del responsable del proyecto. La recomendación técnica era migrar solo `pagos`, que es el 100% del problema medido; se optó por dejar el sistema coherente en una sola tecnología. |
| `pagos.xlsx` legible | No se conserva | Nadie del estudio lo abre a mano. Sin capa de exportación. |
| Cutover | Único, con vuelta atrás | Datos contables reales en producción. |
| Estructura del cambio | Reemplazo detrás de la misma interfaz | `server.js` no se toca; el riesgo queda contenido en un archivo. |

### Por qué "reemplazo detrás de la misma interfaz"

`ExcelManager` conserva su API pública completa, así que las 1.450 líneas de rutas de `server.js`
quedan intactas y sirven como referencia de que el comportamiento no cambió.

Durante una migración se cambia **una sola cosa**: dónde viven los datos. Las reglas contables —
mes vencido, honorarios programados, interés mensual, exclusión de anulados — se portan carácter
por carácter, sin mejoras de paso. Así, si después de migrar la deuda de un cliente no coincide,
la causa solo puede estar en la lectura de datos y no en el cálculo. Esa certeza es la que hace
verificable la migración, y se pierde con cualquier enfoque que reescriba ambas capas a la vez.

Se descartaron:

- **Capa de repositorio nueva + adaptador**: mejor estructura final, pero dos capas conviviendo
  durante la migración y más superficie donde un error contable se esconde.
- **Reescribir `server.js` y la capa de datos juntos**: el estado final más limpio, pero un diff
  imposible de verificar contra datos reales.

## Esquema

Un solo archivo `data/capella.db` reemplaza los tres `.xlsx`. Los nombres de campo se conservan
sin renombrar, para que el mapeo contra las columnas actuales sea verificable a simple vista.

```sql
CREATE TABLE clientes (
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

CREATE TABLE pagos (
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

CREATE INDEX idx_pagos_cliente ON pagos(clienteId);
CREATE INDEX idx_pagos_recibo  ON pagos(reciboRelativePath);

CREATE TABLE historial (
  id            TEXT PRIMARY KEY,
  clienteId     TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombreCliente TEXT,
  mes           TEXT,
  comision      REAL,
  fechaCobro    TEXT,
  timestamp     TEXT
);
```

### `historial` es casi vestigial

Conviene saberlo antes de planificar la Fase 3, porque baja mucho su riesgo:

- `getHistorialCliente()` **no lee `historial.xlsx`**. Calcula todo con `_calcularFinanzasCliente`
  y filtra el resultado (`excelManager.js:1550`). Es lo que usa la pantalla de historial del cliente.
- El archivo solo lo leen `getAllHistorial()` (ruta `GET /api/historial`) y lo escribe
  `addHistorialEntry()`.

La tabla se migra por completitud y porque `rebuild-historial.js` la reconstruye, pero casi ningún
cálculo depende de ella.

**Detalle de nombre:** la columna SQL es `comision` sin tilde, pero `getAllHistorial()` hoy devuelve
la clave `comisión` **con** tilde. El mapper debe seguir emitiendo `comisión`, porque es lo que sale
por la API hacia el frontend.

### Decisiones de esquema

**`honorariosProgramados` sigue siendo una columna JSON.** Normalizarlo a `(clienteId, mes,
honorario)` sería más correcto, pero obliga a reescribir `_getHonorarioBaseMes` y la lógica contable
durante la migración. Queda como mejora posterior.

**`ON DELETE CASCADE` reemplaza el borrado manual** que hoy hace `deleteCliente` recorriendo
`pagos.xlsx` fila por fila (`excelManager.js:911`). Requiere `PRAGMA foreign_keys = ON` en la
conexión; sin eso el borrado falla en silencio y quedan pagos huérfanos.

**`idx_pagos_recibo`** existe por `anularPagoPorReciboPath`, que hoy escanea todos los pagos para
encontrar uno por ruta de archivo.

**Los `CHECK` son nuevos.** Hoy `estado` y `tipoTrabajo` se normalizan en código pero nada impide
un valor inválido en la planilla. Es la única regla que se agrega, y es defensiva: una restricción
en un límite de confianza, no un cambio de comportamiento.

**`totalAdeudado` y `mesesAdeudados` siguen siendo columnas cacheadas** que `recalculateClienteDeuda`
reescribe, igual que hoy. La deuda se sigue calculando dinámicamente en JavaScript, con el mismo
código. No se mueve el cálculo a SQL.

## Capa de acceso

`ExcelManager` conserva nombre de archivo, clase y todos sus métodos públicos con la misma firma.
Los métodos siguen siendo `async` aunque `node:sqlite` sea síncrono: resuelven de inmediato y
ningún `await` de las rutas cambia.

### Lo que se elimina

Toda la maquinaria que existía solo para pelear con Excel, entre 400 y 500 líneas:

- `_loadWorkbookCache`, `_invalidateWorkbookCache` y los tres `_get*Workbook`
- `_ensureClientesSheetStructure` y `_ensurePagosSheetStructure`; la migración implícita de esquema
  pasa a ser `CREATE TABLE IF NOT EXISTS` más `PRAGMA user_version`
- `initializeClientesFile`, `initializePagosFile`, `initializeHistoricalFile`
- Las 25 llamadas a `xlsx.writeFile`
- El `sleep` de 200 ms de `addCliente` (`excelManager.js:656`) y su bloque de verificación posterior
- El reintento triple de escritura de `addCliente`: una transacción confirma o falla, sin estado
  intermedio que reintentar

Son justamente las líneas donde vivían los bugs de cache invalidado.

### Contrato de los mappers

`_buildClienteFromRow` y `_buildPagoFromRow` se reducen a una función por tabla, pero su contrato
de salida debe replicarse exactamente:

- `interesMensualActivo` vuelve como `0`/`1` → se convierte a booleano
- `honorariosProgramados` vuelve como TEXT → se parsea con `_safeJsonParseObject`, que se conserva
- los campos de texto vuelven `NULL` → se normalizan a `''`, como hoy
- `reciboNumero` conserva su comportamiento actual `|| null`, que también convierte `0` en `null`

### Única diferencia de comportamiento

Hoy ExcelJS devuelve a veces objetos `Date` y a veces strings en `fechaCreacion`,
`proximaFacturacion`, `fecha` y `timestamp`, según cómo se escribió la celda. SQLite siempre
devuelve TEXT ISO. Los consumidores hacen `new Date(...)` o serializan a JSON, así que el resultado
final es el mismo string ISO — pero es la diferencia que la migración debe verificar explícitamente.

### Conexión

Una sola instancia `DatabaseSync` abierta en el constructor, viva mientras corre el proceso:

```sql
PRAGMA foreign_keys = ON;   -- sin esto el ON DELETE CASCADE no actúa
PRAGMA synchronous = FULL;  -- datos contables: no se negocia durabilidad por velocidad
```

**No se activa WAL**, a propósito. Su beneficio son lectores concurrentes durante una escritura, y
hay un solo proceso Node con un solo escritor. A cambio agregaría `capella.db-wal` y `capella.db-shm`,
que complican el backup. Con `synchronous = FULL` un pago sigue costando bastante menos de 1 ms.

### Transacciones

`addPago` + `recalculateClienteDeuda` pasan a ser una sola transacción. Hoy son dos escrituras de
archivo independientes: si el proceso muere entre medio, el pago queda guardado y la deuda
desactualizada. Es la segunda mejora de comportamiento introducida, y como los `CHECK`, es
defensiva: evita pérdida de integridad, no cambia ningún cálculo.

## Migración y verificación

Script de una sola vez: `backend/migrar-a-sqlite.js`.

Para poder leer Excel después de que `excelManager.js` ya sea SQL, el archivo actual se congela como
copia en `backend/legacy/excelManagerXlsx.js` — solo lectura, usado únicamente por el script, y se
borra al completar el cutover.

Los `.xlsx` se abren en modo lectura y **nunca se modifican ni se borran**. Esa es la base de la
vuelta atrás.

**Guardas:** si `capella.db` ya existe, el script se niega a correr salvo `--force`. Antes de empezar
dispara un ZIP de `data/` reusando `createDataZipBackup()`.

### Chequeos de verificación

Si alguno falla, el script marca la migración como fallida y termina con código distinto de cero.

1. **Conteos** — clientes, pagos e historial: misma cantidad de filas.
2. **Pagos por estado** — cuántos `activo` y cuántos `anulado`. Un `estado` vacío que se normalizaba
   a `activo` debe seguir siendo `activo`.
3. **Suma de montos** — total de activos y total de anulados por separado, al centavo.
4. **Deuda por cliente (la prueba real)** — para cada cliente se corre `_calcularFinanzasCliente`
   dos veces: una con el lector Excel congelado y otra con la capa SQLite. Ambas deudas deben
   coincidir al centavo, y también la cantidad de meses adeudados. Es el mismo código de cálculo
   alimentado por dos fuentes: si coincide para todos los clientes, la migración está probada.
5. **Vínculos con los recibos** — `reciboRelativePath`, `reciboFileName` y `reciboNumero` idénticos.
   De esto depende que los PDF ya emitidos sigan asociados a su pago y que anular un recibo lo encuentre.
6. **`honorariosProgramados`** — JSON parseado, comparado clave por clave. Ahí viven los honorarios
   históricos; perder una clave recalcula mal un mes viejo sin que nadie lo note.
7. **Fechas** — que `fechaCreacion` normalizada produzca el mismo mes de inicio en ambos motores,
   ya que decide desde qué mes se adeuda.

Salida a `data/migracion-verificacion.txt`, con una línea por chequeo y el detalle de cada
diferencia cliente por cliente.

### Vuelta atrás

Tres pasos, deliberadamente aburridos: revertir el commit, borrar `capella.db`, arrancar. Los `.xlsx`
siguen como estaban porque nunca se tocaron. No hay que restaurar backups ni deshacer una migración
a medias.

### Fuera de alcance

Los PDF en `Trabajos Estudio Capella/`, `_contador_recibos.json`,
`_indice_carpetas_particulares.json` y `data/recibos-index.json` quedan como están. Los `id` de pago
se preservan, así que el índice de recibos sigue apuntando bien y la numeración correlativa continúa.

## Backups

`createDataZipBackup()` hoy comprime `data/` tal cual. Copiar un SQLite mientras hay una escritura
en vuelo puede producir una copia corrupta, así que antes de comprimir se genera un snapshot
consistente:

```sql
VACUUM INTO 'data/_backup_capella.db'
```

Se comprime ese snapshot y se borra. La retención de 10 archivos queda igual.

`reiniciarTodosDatos()` pasa de `unlinkSync` sobre archivos a `DELETE FROM` de las tres tablas
dentro de una transacción.

## Requisito de despliegue

`node:sqlite` llegó en Node 22.5 **detrás del flag `--experimental-sqlite`**; recién desde Node 23.4
está disponible sin flag. Hay que confirmar la versión exacta en la PC del estudio:

- Node 24 → no hace falta nada
- Node 22 → `iniciar.bat` necesita `node --experimental-sqlite server.js`

Recomendación: si está en Node 22, actualizar a Node 24 como paso previo, para no dejar la
aplicación atada a un flag experimental.

## Fases

Unidades de desarrollo y revisión, no de despliegue. En la PC del estudio se hace **un solo cutover**
al final. Cada fase intermedia deja el sistema funcionando con almacenamiento mixto, lo que permite
probarla aislada sin que eso implique instalarla.

| Fase | Contenido |
|------|-----------|
| 0 | Conexión, esquema, PRAGMAs, `user_version`. No cambia comportamiento. |
| 1 | **Pagos** — los 7 métodos de pago. El 100% del problema medido. |
| 2 | **Clientes** — incluye borrado en cascada y salida del `sleep` de 200 ms. |
| 3 | **Historial** — más el port de `rebuild-historial.js`. |
| 4 | Backups, `reiniciarTodosDatos`, borrado de `legacy/`. |

## Pruebas

El backend no tiene framework de tests y no se agrega uno para esto. Tres verificaciones,
ejecutables con `node`:

1. **El script de verificación** es la prueba principal y corre contra los datos reales del estudio.
   Ninguna prueba sintética vale más que esa.
2. **`backend/test-migracion.js`** — chequeos con `assert` sobre los casos borde que la comparación
   de totales no cubre: un pago anulado no reduce deuda; un cliente `particular` no factura por mes;
   un `honorarioProgramado` pisa el honorario base del mes correcto; borrar un cliente borra sus
   pagos en cascada; los campos de texto vacíos vuelven `''` y no `null`.
3. **Benchmark de regresión** — se vuelve a correr con 40.000 pagos después de migrar.
   Criterio de éxito: de 9.772 ms a menos de 50 ms por pago.

## Criterio de éxito

- Los 7 chequeos de verificación pasan contra los datos reales del estudio.
- Registrar un pago con 40.000 pagos históricos tarda menos de 50 ms.
- `server.js` no tiene cambios funcionales.
- El sistema arranca en la PC del estudio sin instalar dependencias nuevas.

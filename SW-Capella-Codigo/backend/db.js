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

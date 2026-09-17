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

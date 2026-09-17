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

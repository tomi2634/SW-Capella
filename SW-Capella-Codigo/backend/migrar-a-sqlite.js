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

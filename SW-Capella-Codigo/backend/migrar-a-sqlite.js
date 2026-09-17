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

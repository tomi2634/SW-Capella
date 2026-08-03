const fs = require('fs');
const path = require('path');
const ExcelManager = require('./excelManager');

function stampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function main() {
  const excelManager = new ExcelManager();
  const dataDir = path.resolve(__dirname, '../data');
  const historialPath = path.join(dataDir, 'historial.xlsx');

  try {
    if (!fs.existsSync(dataDir)) {
      throw new Error(`No existe la carpeta de datos: ${dataDir}`);
    }

    if (fs.existsSync(historialPath)) {
      const backupPath = path.join(dataDir, `historial.backup.${stampForFile()}.xlsx`);
      fs.copyFileSync(historialPath, backupPath);
      console.log(`Backup creado: ${backupPath}`);
    }

    if (fs.existsSync(historialPath)) {
      fs.unlinkSync(historialPath);
      console.log('Archivo historial.xlsx eliminado para reconstruccion limpia');
    }

    await excelManager.initializeHistoricalFile();

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

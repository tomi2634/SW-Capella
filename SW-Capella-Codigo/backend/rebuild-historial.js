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

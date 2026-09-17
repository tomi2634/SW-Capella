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

  _safeJsonParseObject(rawValue, fallback = {}) {
    return parseJsonObjeto(rawValue, fallback);
  }

  normalizeMonthKey(value) {
    const raw = (value || '').toString().trim();
    const directMatch = raw.match(/^(\d{2})-(\d{4})$/);
    if (directMatch) {
      return `${directMatch[1]}-${directMatch[2]}`;
    }

    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return this.formatearMes(date);
    }

    return null;
  }

  getCurrentMonthKey() {
    return this.formatearMes(new Date());
  }

  getNextMonthKey() {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return this.formatearMes(nextMonth);
  }

  normalizePaymentStatus(value) {
    const normalized = (value || '').toString().trim().toLowerCase();
    return normalized === 'anulado' ? 'anulado' : 'activo';
  }

  _sanitizeHonorariosProgramados(value) {
    const source = value && typeof value === 'object' ? value : {};
    const clean = {};

    Object.entries(source).forEach(([monthKey, amount]) => {
      const mes = this.normalizeMonthKey(monthKey);
      const honorario = parseFloat(amount);
      if (!mes || !Number.isFinite(honorario) || honorario < 0) {
        return;
      }
      clean[mes] = Math.round(honorario * 100) / 100;
    });

    return clean;
  }

  _getHonorarioBaseMes(cliente, mesKey) {
    const honorariosProgramados = this._safeJsonParseObject(cliente?.honorariosProgramados, {});
    const mesNormalizado = this.normalizeMonthKey(mesKey);
    const honorarioProgramado = parseFloat(honorariosProgramados[mesNormalizado]);
    if (mesNormalizado && Number.isFinite(honorarioProgramado) && honorarioProgramado >= 0) {
      return honorarioProgramado;
    }
    return parseFloat(cliente?.honorario) || 0;
  }

  parseBooleanValue(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const normalized = (value || '').toString().trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'si' || normalized === 'sí';
  }

  _calcularHonorarioConInteres(honorarioBase, interesActivo, interesPorcentaje) {
    const base = parseFloat(honorarioBase) || 0;
    if (!interesActivo) {
      return base;
    }

    const porcentaje = Number(interesPorcentaje);
    if (!Number.isFinite(porcentaje) || porcentaje <= 0) {
      return base;
    }

    const conInteres = base * (1 + (porcentaje / 100));
    return Math.round(conInteres * 100) / 100;
  }

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

  // Reiniciar todos los datos
  async reiniciarTodosDatos() {
    try {
      console.log('🗑️ REINICIANDO TODOS LOS DATOS...');
      
      // Eliminar archivos
      if (fs.existsSync(this.clientesPath)) {
        fs.unlinkSync(this.clientesPath);
        console.log('✓ Archivo clientes.xlsx eliminado');
      }
      
      if (fs.existsSync(this.pagosPath)) {
        fs.unlinkSync(this.pagosPath);
        console.log('✓ Archivo pagos.xlsx eliminado');
      }
      
      if (fs.existsSync(this.historicalPath)) {
        fs.unlinkSync(this.historicalPath);
        console.log('✓ Archivo historial.xlsx eliminado');
      }

      this._invalidateWorkbookCache('clientes');
      this._invalidateWorkbookCache('pagos');
      this._invalidateWorkbookCache('historial');
      
      // Reinicializar archivos vacíos
      await this.initializeClientesFile();
      await this.initializePagosFile();
      await this.initializeHistoricalFile();
      
      console.log('✅ TODOS LOS DATOS REINICIADOS A CERO');
      return { success: true, message: 'Todos los datos han sido reiniciados a cero' };
    } catch (error) {
      console.error('❌ Error reiniciando datos:', error);
      throw error;
    }
  }

  // ==================== CLIENTES ====================

  async addCliente(cliente) {
    const ahora = new Date();
    // No coercionar en silencio un tipoTrabajo inválido: el CHECK de la
    // tabla no puede rechazar lo que el código ya "arregló" antes del INSERT.
    if (cliente.tipoTrabajo !== undefined
      && cliente.tipoTrabajo !== 'honorarios'
      && cliente.tipoTrabajo !== 'particular') {
      throw new Error(`tipoTrabajo inválido: ${cliente.tipoTrabajo}`);
    }
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

  _preservarHonorariosAnteriores(honorariosProgramados, honorarioAnterior, fechaCreacion) {
    const fechaInicio = this._monthFloorDate(fechaCreacion || new Date());
    const ahora = new Date();
    const inicioMesActual = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const cursor = new Date(fechaInicio);

    while (cursor < inicioMesActual) {
      const mesKey = this.formatearMes(cursor);
      if (honorariosProgramados[mesKey] === undefined) {
        honorariosProgramados[mesKey] = honorarioAnterior;
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return honorariosProgramados;
  }

  async updateClienteHonorario(id, honorario) {
    try {
      const { workbook, sheet } = await this._getClientesWorkbook();
      const structureChanged = this._ensureClientesSheetStructure(sheet);
      if (structureChanged) {
        await workbook.xlsx.writeFile(this.clientesPath);
      }

      let found = false;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (row.getCell(this.CLIENTE_COL.id).value === id) {
          // 1) Obtener el honorario anterior ANTES de modificarlo
          const honorarioAnterior = Math.round((parseFloat(
            row.getCell(this.CLIENTE_COL.honorario).value
          ) || 0) * 100) / 100;

          const nuevoHonorario = Math.round((parseFloat(honorario) || 0) * 100) / 100;

          // 2) Preservar el honorario anterior para todos los meses históricos
          //    que aún no tengan un valor programado explícito.
          const honorariosProgramados = this._safeJsonParseObject(
            row.getCell(this.CLIENTE_COL.honorariosProgramados).value,
            {}
          );
          const fechaCreacion = row.getCell(this.CLIENTE_COL.fechaCreacion).value;
          this._preservarHonorariosAnteriores(honorariosProgramados, honorarioAnterior, fechaCreacion);

          // 3) Guardar el nuevo honorario para el mes próximo
          honorariosProgramados[this.getNextMonthKey()] = nuevoHonorario;
          row.getCell(this.CLIENTE_COL.honorariosProgramados).value = JSON.stringify(
            this._sanitizeHonorariosProgramados(honorariosProgramados)
          );

          // 4) Actualizar el honorario base
          row.getCell(this.CLIENTE_COL.honorario).value = nuevoHonorario;

          row.getCell(this.CLIENTE_COL.lastUpdate).value = new Date().toISOString();
          console.log(`💰 Honorario actualizado para cliente ${id}: $${nuevoHonorario}`);
          console.log(`   ℹ️ Honorario anterior preservado para meses históricos: $${honorarioAnterior}`);
          console.log(`   ℹ️ Nuevo honorario aplicará a partir del mes siguiente (${this.getNextMonthKey()})`);
          found = true;
        }
      });

      if (!found) throw new Error('Cliente no encontrado');

      await workbook.xlsx.writeFile(this.clientesPath);

      // Recalcular deuda con el nuevo honorario para futuros períodos
      await this.recalculateClienteDeuda(id);

      return this.getCliente(id);
    } catch (error) {
      console.error('Error actualizando honorario:', error);
      throw error;
    }
  }

  async updateClienteHonorarioProgramado(id, periodoMes, honorario) {
    try {
      const mesKey = this.normalizeMonthKey(periodoMes);
      if (!mesKey) {
        throw new Error('Período inválido. Use formato MM-YYYY');
      }

      const nuevoHonorario = parseFloat(honorario);
      if (!Number.isFinite(nuevoHonorario) || nuevoHonorario < 0) {
        throw new Error('Honorario inválido');
      }
      const honorarioFinal = Math.round(nuevoHonorario * 100) / 100;

      const { workbook, sheet } = await this._getClientesWorkbook();
      this._ensureClientesSheetStructure(sheet);

      let found = false;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (row.getCell(this.CLIENTE_COL.id).value === id) {
          const honorariosProgramados = this._safeJsonParseObject(
            row.getCell(this.CLIENTE_COL.honorariosProgramados).value,
            {}
          );
          honorariosProgramados[mesKey] = honorarioFinal;
          row.getCell(this.CLIENTE_COL.honorariosProgramados).value = JSON.stringify(
            this._sanitizeHonorariosProgramados(honorariosProgramados)
          );

          if (mesKey === this.getCurrentMonthKey()) {
            row.getCell(this.CLIENTE_COL.honorario).value = honorarioFinal;
          }

          row.getCell(this.CLIENTE_COL.lastUpdate).value = new Date().toISOString();
          found = true;
        }
      });

      if (!found) throw new Error('Cliente no encontrado');

      await workbook.xlsx.writeFile(this.clientesPath);
      await this.recalculateClienteDeuda(id);
      return this.getCliente(id);
    } catch (error) {
      console.error('Error actualizando honorario programado:', error);
      throw error;
    }
  }

  async deleteCliente(id) {
    const cliente = await this.getCliente(id);
    if (!cliente) throw new Error('Cliente no encontrado');

    // pagos e historial se van solos por ON DELETE CASCADE.
    this.db.prepare('DELETE FROM clientes WHERE id = ?').run(id);

    console.log(`✅ Cliente ${cliente.nombre} y todos sus registros eliminados`);
    return { success: true, message: `Cliente ${cliente.nombre} eliminado completamente` };
  }

  // ==================== PAGOS ====================

  async addPago(pago) {
    try {
      console.log(`📝 Registrando pago: ${pago.id} - Cliente: ${pago.clienteId} - Monto: $${pago.monto}`);
      
      // Agregar a la hoja de pagos
      const { workbook, sheet } = await this._getPagosWorkbook();
      const structureChanged = this._ensurePagosSheetStructure(sheet);
      if (structureChanged) {
        await workbook.xlsx.writeFile(this.pagosPath);
      }

      // Usar array de valores en lugar de objeto (funciona mejor con ExcelJS)
      const newRow = sheet.addRow([
        pago.id,              // Columna 1: ID Pago
        pago.clienteId,       // Columna 2: ID Cliente
        parseFloat(pago.monto) || 0,  // Columna 3: Monto Pagado
        pago.tipoPago || 'Efectivo',    // Columna 4: Tipo de Pago
        (pago.detalles || '').toString().slice(0, 1000), // Columna 5: Detalles
        pago.fecha,           // Columna 6: Fecha del Pago
        pago.timestamp,       // Columna 7: Timestamp
        (pago.numeroCheque || '').toString().slice(0, 80),
        (pago.nombreBanco || '').toString().slice(0, 120),
        this.normalizePaymentStatus(pago.estado),
        '',
        '',
        '',
        '',
        null
      ]);

      console.log(`✏️ Fila de pago agregada`);

      await workbook.xlsx.writeFile(this.pagosPath);
      console.log(`💾 Pago guardado en archivo`);

      return pago;
    } catch (error) {
      console.error('❌ Error agregando pago:', error);
      throw error;
    }
  }

  async getPagosCliente(clienteId) {
    try {
      const { workbook, sheet } = await this._getPagosWorkbook();
      const structureChanged = this._ensurePagosSheetStructure(sheet);
      if (structureChanged) {
        await workbook.xlsx.writeFile(this.pagosPath);
      }

      const pagos = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (row.getCell(2).value === clienteId) {
          pagos.push(this._buildPagoFromRow(row));
        }
      });

      return pagos;
    } catch (error) {
      console.error('Error obteniendo pagos:', error);
      return [];
    }
  }

  async getAllPagos() {
    try {
      const { workbook, sheet } = await this._getPagosWorkbook();
      const structureChanged = this._ensurePagosSheetStructure(sheet);
      if (structureChanged) {
        await workbook.xlsx.writeFile(this.pagosPath);
      }

      const pagos = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        pagos.push(this._buildPagoFromRow(row));
      });

      return pagos;
    } catch (error) {
      console.error('Error obteniendo pagos:', error);
      return [];
    }
  }

  async getPagoById(pagoId) {
    try {
      const pagos = await this.getAllPagos();
      return pagos.find(p => p.id === pagoId) || null;
    } catch (error) {
      console.error('Error obteniendo pago por ID:', error);
      return null;
    }
  }

  async updatePagoReciboMeta(pagoId, reciboData) {
    try {
      const { workbook, sheet } = await this._getPagosWorkbook();
      this._ensurePagosSheetStructure(sheet);

      let found = false;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (row.getCell(this.PAGO_COL.id).value === pagoId) {
          row.getCell(this.PAGO_COL.reciboRelativePath).value = (reciboData?.relativePath || '').toString();
          row.getCell(this.PAGO_COL.reciboFileName).value = (reciboData?.fileName || '').toString();
          row.getCell(this.PAGO_COL.reciboNumero).value = Number.isInteger(reciboData?.numeroRecibo)
            ? reciboData.numeroRecibo
            : null;
          if (!row.getCell(this.PAGO_COL.estado).value) {
            row.getCell(this.PAGO_COL.estado).value = 'activo';
          }
          found = true;
        }
      });

      if (!found) {
        return null;
      }

      await workbook.xlsx.writeFile(this.pagosPath);
      this._invalidateWorkbookCache('pagos');
      return this.getPagoById(pagoId);
    } catch (error) {
      console.error('Error actualizando metadatos del recibo en pago:', error);
      throw error;
    }
  }

  async anularPago(pagoId, motivo) {
    try {
      const { workbook, sheet } = await this._getPagosWorkbook();
      this._ensurePagosSheetStructure(sheet);

      let pagoClienteId = null;
      let found = false;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (row.getCell(this.PAGO_COL.id).value === pagoId) {
          row.getCell(this.PAGO_COL.estado).value = 'anulado';
          row.getCell(this.PAGO_COL.anuladoAt).value = new Date().toISOString();
          row.getCell(this.PAGO_COL.anuladoMotivo).value = (motivo || '').toString().slice(0, 250);
          row.getCell(this.PAGO_COL.timestamp).value = new Date().toISOString();
          pagoClienteId = row.getCell(this.PAGO_COL.clienteId).value;
          found = true;
        }
      });

      if (!found) {
        throw new Error('Pago no encontrado');
      }

      await workbook.xlsx.writeFile(this.pagosPath);
      this._invalidateWorkbookCache('pagos');
      if (pagoClienteId) {
        await this.recalculateClienteDeuda(pagoClienteId);
      }
      return this.getPagoById(pagoId);
    } catch (error) {
      console.error('Error anulando pago:', error);
      throw error;
    }
  }

  async anularPagoPorReciboPath(reciboRelativePath, motivo) {
    const pathKey = (reciboRelativePath || '').toString().trim();
    if (!pathKey) {
      throw new Error('Ruta de recibo inválida');
    }

    const pagos = await this.getAllPagos();
    const pago = pagos.find((p) => (p.reciboRelativePath || '').toString().trim() === pathKey);

    if (!pago) {
      throw new Error('No se encontró un pago vinculado a ese recibo');
    }

    return this.anularPago(pago.id, motivo);
  }

  // Recalcular deuda del cliente basado en facturación cada 30 días
  async recalculateClienteDeuda(clienteId) {
    try {
      const cliente = await this.getCliente(clienteId);
      if (!cliente) return;

      const pagos = await this.getPagosCliente(clienteId);
      const pagosActivos = pagos.filter((p) => this.normalizePaymentStatus(p.estado) !== 'anulado');
      const totalPagado = pagosActivos.reduce((sum, p) => sum + (parseFloat(p.monto) || 0), 0);
      const tipoTrabajo = cliente.tipoTrabajo === 'particular' ? 'particular' : 'honorarios';
      const interesMensualActivo = Boolean(cliente.interesMensualActivo);
      const interesMensualPorcentaje = Number(cliente.interesMensualPorcentaje) || 0;

      if (tipoTrabajo === 'particular') {
        const deudaUnica = Math.round(((cliente.honorario || 0) - totalPagado) * 100) / 100;
        const mesesAdeudados = deudaUnica > 0 ? 1 : 0;

        const { workbook, sheet } = await this._getClientesWorkbook();
        const structureChanged = this._ensureClientesSheetStructure(sheet);

        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          if (row.getCell(this.CLIENTE_COL.id).value === clienteId) {
            row.getCell(this.CLIENTE_COL.honorario).value = cliente.honorario;
            row.getCell(this.CLIENTE_COL.honorarioPeriodo).value = cliente.honorario;
            row.getCell(this.CLIENTE_COL.totalAdeudado).value = deudaUnica;
            row.getCell(this.CLIENTE_COL.mesesAdeudados).value = mesesAdeudados;
            row.getCell(this.CLIENTE_COL.proximaFacturacion).value = '';
            row.getCell(this.CLIENTE_COL.tipoTrabajo).value = 'particular';
            row.getCell(this.CLIENTE_COL.lastUpdate).value = new Date().toISOString();
          }
        });

        await workbook.xlsx.writeFile(this.clientesPath);
        if (structureChanged) {
          console.log('ℹ️ Estructura de clientes actualizada a versión con tipo de trabajo e interés mensual');
        }
        return;
      }

      // Centralizar la deuda en la misma regla usada por historial/resumen:
      // para honorarios solo se adeudan meses ya vencidos (sin incluir el mes en curso).
      const finanzas = await this._calcularFinanzasCliente(cliente);
      const deudaFinal = Math.round((finanzas.deuda || 0) * 100) / 100;
      const mesesAdeudados = (finanzas.historial || []).filter((entry) => {
        return (parseFloat(entry.deudaPendiente) || 0) > 0;
      }).length;

      const honorarioMesActual = this._getHonorarioBaseMes(cliente, this.getCurrentMonthKey());
      const nuevoHonorarioPeriodo = this._calcularHonorarioConInteres(
        honorarioMesActual,
        interesMensualActivo,
        interesMensualPorcentaje
      );

      const ahora = new Date();
      const nextBilling = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);

      console.log(`📊 Cliente: ${cliente.nombre}`);
      console.log(`   - Honorario Mensual Actual: $${cliente.honorario}`);
      if (interesMensualActivo) {
        console.log(`   - Interés mensual activo: ${interesMensualPorcentaje}%`);
      }
      console.log(`   - Total pagado: $${totalPagado}`);
      console.log(`   - Deuda final (mes vencido): $${deudaFinal}`);
      console.log(`   - Próxima facturación prevista: ${nextBilling.toISOString().split('T')[0]}`);

      const { workbook, sheet } = await this._getClientesWorkbook();
      this._ensureClientesSheetStructure(sheet);

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (row.getCell(this.CLIENTE_COL.id).value === clienteId) {
          row.getCell(this.CLIENTE_COL.honorario).value = cliente.honorario;
          row.getCell(this.CLIENTE_COL.honorarioPeriodo).value = nuevoHonorarioPeriodo;
          row.getCell(this.CLIENTE_COL.totalAdeudado).value = deudaFinal;
          row.getCell(this.CLIENTE_COL.mesesAdeudados).value = mesesAdeudados;
          row.getCell(this.CLIENTE_COL.proximaFacturacion).value = nextBilling.toISOString();
          row.getCell(this.CLIENTE_COL.tipoTrabajo).value = 'honorarios';
          row.getCell(this.CLIENTE_COL.interesMensualActivo).value = interesMensualActivo;
          row.getCell(this.CLIENTE_COL.interesMensualPorcentaje).value = interesMensualPorcentaje;
          row.getCell(this.CLIENTE_COL.lastUpdate).value = new Date().toISOString();
        }
      });

      await workbook.xlsx.writeFile(this.clientesPath);
      this._invalidateWorkbookCache('clientes');
      console.log(`✅ Deuda recalculada para ${cliente.nombre}`);
    } catch (error) {
      console.error('Error recalculando deuda:', error);
    }
  }

  // Formatea una fecha a "MM-YYYY"
  formatearMes(fecha) {
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const año = fecha.getFullYear();
    return `${mes}-${año}`;
  }

  _monthKeyToDate(monthKey) {
    const normalized = this.normalizeMonthKey(monthKey);
    if (!normalized) {
      return null;
    }

    const [mes, anio] = normalized.split('-').map((v) => parseInt(v, 10));
    if (!Number.isInteger(mes) || !Number.isInteger(anio) || mes < 1 || mes > 12) {
      return null;
    }

    return new Date(anio, mes - 1, 1);
  }

  _monthFloorDate(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  _buildMonthRange(startDate, endDate) {
    const months = [];
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

    while (cursor <= end) {
      months.push(this.formatearMes(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return months;
  }

  async addClienteDeudaAnterior(id, periodoMes, deuda) {
    try {
      const mesKey = this.normalizeMonthKey(periodoMes);
      if (!mesKey) {
        throw new Error('Período inválido. Use formato MM-YYYY');
      }

      const deudaFloat = parseFloat(deuda);
      if (!Number.isFinite(deudaFloat) || deudaFloat < 0) {
        throw new Error('Deuda inválida');
      }
      const deudaFinal = Math.round(deudaFloat * 100) / 100;

      const { workbook, sheet } = await this._getClientesWorkbook();
      this._ensureClientesSheetStructure(sheet);

      let found = false;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (row.getCell(this.CLIENTE_COL.id).value !== id) return;

        const tipoTrabajo = (row.getCell(this.CLIENTE_COL.tipoTrabajo).value || 'honorarios').toString();
        if (tipoTrabajo === 'particular') {
          throw new Error('Solo se puede cargar deuda anterior en clientes de honorarios mensuales');
        }

        const honorariosProgramados = this._sanitizeHonorariosProgramados(
          this._safeJsonParseObject(row.getCell(this.CLIENTE_COL.honorariosProgramados).value, {})
        );

        const fechaCreacionActual = this._monthFloorDate(row.getCell(this.CLIENTE_COL.fechaCreacion).value);
        const fechaPeriodoObjetivo = this._monthKeyToDate(mesKey);

        if (!fechaPeriodoObjetivo) {
          throw new Error('Período inválido. Use formato MM-YYYY');
        }

        // Si el período objetivo es anterior al alta, se retrocede la fecha de creación
        // y se completa con 0 los meses intermedios para no crear deudas ficticias.
        if (fechaPeriodoObjetivo < fechaCreacionActual) {
          const mesAnteriorAlta = new Date(fechaCreacionActual.getFullYear(), fechaCreacionActual.getMonth() - 1, 1);
          const mesesIntermedios = this._buildMonthRange(fechaPeriodoObjetivo, mesAnteriorAlta);
          mesesIntermedios.forEach((monthKey) => {
            if (honorariosProgramados[monthKey] === undefined) {
              honorariosProgramados[monthKey] = 0;
            }
          });
          row.getCell(this.CLIENTE_COL.fechaCreacion).value = fechaPeriodoObjetivo.toISOString();
        }

        honorariosProgramados[mesKey] = deudaFinal;
        row.getCell(this.CLIENTE_COL.honorariosProgramados).value = JSON.stringify(
          this._sanitizeHonorariosProgramados(honorariosProgramados)
        );
        row.getCell(this.CLIENTE_COL.lastUpdate).value = new Date().toISOString();
        found = true;
      });

      if (!found) {
        throw new Error('Cliente no encontrado');
      }

      await workbook.xlsx.writeFile(this.clientesPath);
      this._invalidateWorkbookCache('clientes');
      await this.recalculateClienteDeuda(id);
      return this.getCliente(id);
    } catch (error) {
      console.error('Error cargando deuda anterior:', error);
      throw error;
    }
  }

  // Función centralizada que calcula TODA la información financiera del cliente
  async _calcularFinanzasCliente(cliente) {
    try {
      if (!cliente || !cliente.id) {
        return { deuda: 0, meses: [], historial: [] };
      }

      const tipoTrabajo = cliente.tipoTrabajo === 'particular' ? 'particular' : 'honorarios';
      if (tipoTrabajo === 'particular') {
        const pagos = await this.getPagosCliente(cliente.id);
        const pagosActivos = pagos.filter((p) => this.normalizePaymentStatus(p.estado) !== 'anulado');
        const totalPagado = pagosActivos.reduce((sum, p) => sum + (parseFloat(p.monto) || 0), 0);
        const honorarioUnico = parseFloat(cliente.honorario) || 0;
        const deudaFinal = Math.round((honorarioUnico - totalPagado) * 100) / 100;
        const mesBase = this.formatearMes(cliente.fechaCreacion ? new Date(cliente.fechaCreacion) : new Date());

        return {
          deuda: deudaFinal,
          meses: [{ mes: mesBase, honorario: honorarioUnico }],
          historial: [{
            id: `${cliente.id}_${mesBase}`,
            clienteId: cliente.id,
            nombreCliente: cliente.nombre,
            mes: mesBase,
            deuda: honorarioUnico,
            estado: deudaFinal > 0 ? 'adeudado' : 'pagado',
            montoPagado: Math.min(totalPagado, honorarioUnico),
            deudaPendiente: deudaFinal,
            fechaCobro: new Date().toISOString().split('T')[0],
            timestamp: new Date().toISOString()
          }]
        };
      }

      // Generar todos los meses desde la fecha de creación hasta hoy
      // Cobro a "mes vencido": solo se incluyen meses que ya terminaron completamente,
      // nunca el mes en curso (el mes actual se adeuda recién cuando termina).
      const fechaCreacion = cliente.fechaCreacion ? new Date(cliente.fechaCreacion) : new Date();
      const ahora = new Date();
      const inicioMesActual = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      const interesActivo = Boolean(cliente.interesMensualActivo);
      const interesPorcentaje = Number(cliente.interesMensualPorcentaje) || 0;
      
      // Generar lista de meses
      const meses = [];
      let fechaActual = new Date(fechaCreacion);
      
      while (fechaActual < inicioMesActual) {
        const mesKey = this.formatearMes(fechaActual);
        const honorarioBaseMes = this._getHonorarioBaseMes(cliente, mesKey);
        const honorarioMesConInteres = this._calcularHonorarioConInteres(
          honorarioBaseMes,
          interesActivo,
          interesPorcentaje
        );

        meses.push({
          mes: mesKey,
          honorario: honorarioMesConInteres
        });
        fechaActual.setMonth(fechaActual.getMonth() + 1);
      }

      // Obtener pagos realizados
      const pagos = await this.getPagosCliente(cliente.id);
      const pagosActivos = pagos.filter((p) => this.normalizePaymentStatus(p.estado) !== 'anulado');
      const totalPagado = pagosActivos.reduce((sum, p) => sum + (parseFloat(p.monto) || 0), 0);
      
      // Calcular deuda total teórica
      const deudaTeorica = meses.reduce((sum, m) => sum + (parseFloat(m.honorario) || 0), 0);
      // Redondear a 2 decimales para evitar residuos de precisión
      const deudaFinal = Math.round((deudaTeorica - totalPagado) * 100) / 100;

      console.log(`📊 ${cliente.nombre}: ${meses.length} meses, $${totalPagado} pagado, deuda: $${deudaFinal}`);

      // Generar historial COMPLETO: todos los meses con estado (pagado/adeudado)
      let saldoPagos = totalPagado;
      const historial = [];

      for (let i = 0; i < meses.length; i++) {
        const mesData = meses[i];
        
        if (saldoPagos >= mesData.honorario) {
          // Este mes está completamente pagado
          historial.push({
            id: `${cliente.id}_${mesData.mes}`,
            clienteId: cliente.id,
            nombreCliente: cliente.nombre,
            mes: mesData.mes,
            deuda: mesData.honorario,
            estado: 'pagado',
            montoPagado: mesData.honorario,
            deudaPendiente: 0,
            fechaCobro: new Date().toISOString().split('T')[0],
            timestamp: new Date().toISOString()
          });
          saldoPagos -= mesData.honorario;
        } else {
          // Este mes tiene deuda (parcial o total) - redondear a 2 decimales
          const deudaMes = Math.round((mesData.honorario - saldoPagos) * 100) / 100;
          historial.push({
            id: `${cliente.id}_${mesData.mes}`,
            clienteId: cliente.id,
            nombreCliente: cliente.nombre,
            mes: mesData.mes,
            deuda: mesData.honorario,
            estado: 'adeudado',
            montoPagado: Math.round(saldoPagos * 100) / 100,
            deudaPendiente: deudaMes,
            fechaCobro: new Date().toISOString().split('T')[0],
            timestamp: new Date().toISOString()
          });
          saldoPagos = 0;
        }
      }

      return { deuda: deudaFinal, meses: meses, historial: historial };
    } catch (error) {
      console.error('Error calculando finanzas:', error);
      return { deuda: 0, meses: [], historial: [] };
    }
  }

  // Función helper para calcular deuda SIN recursión
  async _calcularDeudaCliente(cliente) {
    const finanzas = await this._calcularFinanzasCliente(cliente);
    return finanzas.deuda;
  }


  // Calcula la deuda actual dinámicamente basada en fecha de creación y pagos
  async calcularDeudaDinamica(clienteId) {
    try {
      const { workbook, sheet } = await this._getClientesWorkbook();
      this._ensureClientesSheetStructure(sheet);

      let cliente = null;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (row.getCell(this.CLIENTE_COL.id).value === clienteId) {
          cliente = this._buildClienteFromRow(row);
        }
      });

      if (!cliente) return 0;
      return await this._calcularDeudaCliente(cliente);
    } catch (error) {
      console.error('Error calculando deuda dinámica:', error);
      return 0;
    }
  }


  // ==================== HISTORIAL ====================

  async addHistorialEntry(clienteId, nombreCliente, mesFacturado, honorario) {
    try {
      console.log(`📝 Agregando mes de facturación al historial para ${nombreCliente}: ${mesFacturado} - $${honorario}`);
      
      const { workbook, sheet } = await this._getHistorialWorkbook();

      // Verificar si ya existe el registro para este cliente y mes
      let mesYaRegistrado = false;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (row.getCell(2).value === clienteId && row.getCell(4).value === mesFacturado) {
          mesYaRegistrado = true;
        }
      });

      if (mesYaRegistrado) {
        console.log(`⚠️ El mes ${mesFacturado} ya está registrado para este cliente`);
        return { success: true, alreadyExists: true };
      }
      
      const newRow = sheet.addRow([
        `${clienteId}_${mesFacturado}`,  // ID único
        clienteId,                       // ID Cliente
        nombreCliente,                   // Nombre Cliente
        mesFacturado,                    // Mes (formato MM-YYYY)
        Math.round((parseFloat(honorario) || 0) * 100) / 100,    // Comisión a cobrar ese mes (es el honorario)
        new Date().toISOString().split('T')[0], // Fecha de registro
        new Date().toISOString()         // Timestamp
      ]);

      await workbook.xlsx.writeFile(this.historicalPath);
      this._invalidateWorkbookCache('historial');
      console.log(`✓ Mes ${mesFacturado} agregado al historial con monto $${honorario}`);
      
      return { success: true };
    } catch (error) {
      console.error('Error agregando al historial:', error);
      throw error;
    }
  }

  async getHistorialCliente(clienteId) {
    try {
      // Obtener el cliente para saber su fecha de creación
      const cliente = await this.getCliente(clienteId);
      if (!cliente) {
        return [];
      }

      // Usar la función centralizada
      const finanzas = await this._calcularFinanzasCliente(cliente);
      return finanzas.historial.filter((entry) => {
        const deuda = parseFloat(entry.deuda) || 0;
        const pagado = parseFloat(entry.montoPagado) || 0;
        const pendiente = parseFloat(entry.deudaPendiente) || 0;
        return deuda > 0 || pagado > 0 || pendiente > 0;
      });
    } catch (error) {
      console.error('Error obteniendo historial:', error);
      return [];
    }
  }

  async getAllHistorial() {
    try {
      const { sheet } = await this._getHistorialWorkbook();

      const historial = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        historial.push({
          id: row.getCell(1).value,
          clienteId: row.getCell(2).value,
          nombreCliente: row.getCell(3).value,
          mes: row.getCell(4).value,
          comisión: row.getCell(5).value,
          fechaCobro: row.getCell(6).value,
          timestamp: row.getCell(7).value
        });
      });

      return historial;
    } catch (error) {
      console.error('Error obteniendo historial completo:', error);
      return [];
    }
  }

  // ==================== RESUMEN ====================

  async getResumen() {
    try {
      const clientes = await this.getClientes();
      
      const resumen = {
        totalClientes: clientes.length,
        totalAdeudado: 0,
        clientesConDeuda: 0,
        clientesPagoDia: 0
      };

      for (const cliente of clientes) {
        if (cliente.totalAdeudado > 0) {
          resumen.totalAdeudado += cliente.totalAdeudado;
          resumen.clientesConDeuda++;
        } else {
          resumen.clientesPagoDia++;
        }
      }

      return resumen;
    } catch (error) {
      console.error('Error generando resumen:', error);
      return {};
    }
  }

  async getHonorarioConfig() {
    return {
      message: 'Configure los honorarios directamente en la tabla de clientes'
    };
  }

  async getChangesAfter(lastSync) {
    const clientes = await this.getClientes();
    const pagos = await this.getAllPagos();

    const clientesCambiados = clientes.filter(c => 
      c.lastUpdate && new Date(c.lastUpdate) > lastSync
    );

    const pagosCambiados = pagos.filter(p =>
      p.timestamp && new Date(p.timestamp) > lastSync
    );

    return {
      clientes: clientesCambiados,
      pagos: pagosCambiados,
      timestamp: new Date().toISOString()
    };
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
}

module.exports = ExcelManager;

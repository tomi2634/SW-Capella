const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

class ExcelManager {
  constructor() {
    this.dataPath = path.join(__dirname, '../data');
    this.clientesPath = path.join(this.dataPath, 'clientes.xlsx');
    this.pagosPath = path.join(this.dataPath, 'pagos.xlsx');
    this.historicalPath = path.join(this.dataPath, 'historial.xlsx');
    this._workbookCache = {
      clientes: null,
      pagos: null,
      historial: null
    };
    this.CLIENTE_COL = {
      id: 1,
      nombre: 2,
      telefono: 3,
      honorario: 4,
      honorarioPeriodo: 5,
      totalAdeudado: 6,
      proximaFacturacion: 7,
      fechaCreacion: 8,
      tipoTrabajo: 9,
      interesMensualActivo: 10,
      interesMensualPorcentaje: 11,
      lastUpdate: 12,
      dniCuit: 13,
      honorariosProgramados: 14,
      mesesAdeudados: 15
    };
    this.PAGO_COL = {
      id: 1,
      clienteId: 2,
      monto: 3,
      tipoPago: 4,
      detalles: 5,
      fecha: 6,
      timestamp: 7,
      numeroCheque: 8,
      nombreBanco: 9,
      estado: 10,
      anuladoAt: 11,
      anuladoMotivo: 12,
      reciboRelativePath: 13,
      reciboFileName: 14,
      reciboNumero: 15
    };
  }

  _safeJsonParseObject(rawValue, fallback = {}) {
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      return rawValue;
    }

    try {
      const parsed = JSON.parse((rawValue || '').toString());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      return fallback;
    } catch (_) {
      return fallback;
    }
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

  _invalidateWorkbookCache(cacheKey) {
    this._workbookCache[cacheKey] = null;
  }

  async _loadWorkbookCache(cacheKey, filePath, sheetName, initFn) {
    const cached = this._workbookCache[cacheKey];
    if (cached?.workbook) {
      return cached;
    }

    if (cached?.loading) {
      return cached.loading;
    }

    const loading = (async () => {
      if (!fs.existsSync(filePath)) {
        if (typeof initFn === 'function') {
          await initFn.call(this);
        }
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      let sheet = workbook.getWorksheet(sheetName);
      if (!sheet) {
        sheet = workbook.addWorksheet(sheetName);
      }

      const entry = { workbook, sheet };
      this._workbookCache[cacheKey] = entry;
      return entry;
    })();

    this._workbookCache[cacheKey] = { loading };
    return loading;
  }

  async _getClientesWorkbook() {
    return this._loadWorkbookCache('clientes', this.clientesPath, 'Clientes', this.initializeClientesFile);
  }

  async _getPagosWorkbook() {
    return this._loadWorkbookCache('pagos', this.pagosPath, 'Pagos', this.initializePagosFile);
  }

  async _getHistorialWorkbook() {
    return this._loadWorkbookCache('historial', this.historicalPath, 'Historial', this.initializeHistoricalFile);
  }

  getClientesColumns() {
    return [
      { header: 'ID', key: 'id', width: 40 },
      { header: 'Nombre', key: 'nombre', width: 30 },
      { header: 'Teléfono', key: 'telefono', width: 15 },
      { header: 'Honorario Mensual', key: 'honorario', width: 18 },
      { header: 'Honorario Período Actual', key: 'honorarioPeriodo', width: 22 },
      { header: 'Total Adeudado', key: 'totalAdeudado', width: 18 },
      { header: 'Próxima Facturación', key: 'proximaFacturacion', width: 20 },
      { header: 'Fecha Creación', key: 'fechaCreacion', width: 20 },
      { header: 'Tipo Trabajo', key: 'tipoTrabajo', width: 20 },
      { header: 'Interés Mensual Activo', key: 'interesMensualActivo', width: 22 },
      { header: 'Interés Mensual (%)', key: 'interesMensualPorcentaje', width: 20 },
      { header: 'Fecha Última Actualización', key: 'lastUpdate', width: 25 },
      { header: 'DNI/CUIT', key: 'dniCuit', width: 20 },
      { header: 'Honorarios Programados (JSON)', key: 'honorariosProgramados', width: 45 },
      { header: 'Meses Adeudados', key: 'mesesAdeudados', width: 18 }
    ];
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

  _buildClienteFromRow(row) {
    const tipoTrabajo = row.getCell(this.CLIENTE_COL.tipoTrabajo).value || 'honorarios';
    return {
      id: row.getCell(this.CLIENTE_COL.id).value,
      nombre: row.getCell(this.CLIENTE_COL.nombre).value,
      telefono: row.getCell(this.CLIENTE_COL.telefono).value || '',
      honorario: parseFloat(row.getCell(this.CLIENTE_COL.honorario).value) || 0,
      honorarioPeriodo: parseFloat(row.getCell(this.CLIENTE_COL.honorarioPeriodo).value) || 0,
      totalAdeudado: parseFloat(row.getCell(this.CLIENTE_COL.totalAdeudado).value) || 0,
      proximaFacturacion: row.getCell(this.CLIENTE_COL.proximaFacturacion).value,
      fechaCreacion: row.getCell(this.CLIENTE_COL.fechaCreacion).value,
      tipoTrabajo,
      interesMensualActivo: this.parseBooleanValue(row.getCell(this.CLIENTE_COL.interesMensualActivo).value),
      interesMensualPorcentaje: parseFloat(row.getCell(this.CLIENTE_COL.interesMensualPorcentaje).value) || 0,
      lastUpdate: row.getCell(this.CLIENTE_COL.lastUpdate).value,
      dniCuit: row.getCell(this.CLIENTE_COL.dniCuit).value || '',
      honorariosProgramados: this._safeJsonParseObject(row.getCell(this.CLIENTE_COL.honorariosProgramados).value, {}),
        mesesAdeudados: parseInt(row.getCell(this.CLIENTE_COL.mesesAdeudados).value, 10) || 0
    };
  }

  _buildPagoFromRow(row) {
    const tipoPago = row.getCell(this.PAGO_COL.tipoPago).value || 'Efectivo';
    const detalles = row.getCell(this.PAGO_COL.detalles).value || '';
    const fecha = row.getCell(this.PAGO_COL.fecha).value;
    const timestamp = row.getCell(this.PAGO_COL.timestamp).value;

    // Compatibilidad con versiones anteriores que no tenían columnas nuevas.
    const estadoRaw = row.getCell(this.PAGO_COL.estado).value;
    const estado = this.normalizePaymentStatus(estadoRaw);

    return {
      id: row.getCell(this.PAGO_COL.id).value,
      clienteId: row.getCell(this.PAGO_COL.clienteId).value,
      monto: parseFloat(row.getCell(this.PAGO_COL.monto).value) || 0,
      tipoPago,
      detalles,
      fecha,
      timestamp,
      numeroCheque: (row.getCell(this.PAGO_COL.numeroCheque).value || '').toString(),
      nombreBanco: (row.getCell(this.PAGO_COL.nombreBanco).value || '').toString(),
      estado,
      anuladoAt: row.getCell(this.PAGO_COL.anuladoAt).value || '',
      anuladoMotivo: (row.getCell(this.PAGO_COL.anuladoMotivo).value || '').toString(),
      reciboRelativePath: (row.getCell(this.PAGO_COL.reciboRelativePath).value || '').toString(),
      reciboFileName: (row.getCell(this.PAGO_COL.reciboFileName).value || '').toString(),
      reciboNumero: row.getCell(this.PAGO_COL.reciboNumero).value || null
    };
  }

  _ensureClientesSheetStructure(sheet) {
    if (!sheet) return false;

    const desiredColumns = this.getClientesColumns();
    let changed = false;

    if (sheet.columnCount < desiredColumns.length) {
      changed = true;
    }

    sheet.columns = desiredColumns;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const tipoTrabajoCell = row.getCell(this.CLIENTE_COL.tipoTrabajo);
      if (!tipoTrabajoCell.value) {
        tipoTrabajoCell.value = 'honorarios';
        changed = true;
      }

      const interesActivoCell = row.getCell(this.CLIENTE_COL.interesMensualActivo);
      if (interesActivoCell.value === null || interesActivoCell.value === undefined || interesActivoCell.value === '') {
        interesActivoCell.value = false;
        changed = true;
      }

      const interesPorcentajeCell = row.getCell(this.CLIENTE_COL.interesMensualPorcentaje);
      if (interesPorcentajeCell.value === null || interesPorcentajeCell.value === undefined || interesPorcentajeCell.value === '') {
        interesPorcentajeCell.value = 0;
        changed = true;
      }

      const lastUpdateCell = row.getCell(this.CLIENTE_COL.lastUpdate);
      if (!lastUpdateCell.value) {
        lastUpdateCell.value = new Date().toISOString();
        changed = true;
      }

      const dniCuitCell = row.getCell(this.CLIENTE_COL.dniCuit);
      if (dniCuitCell.value === null || dniCuitCell.value === undefined) {
        dniCuitCell.value = '';
        changed = true;
      }

      const honorariosProgramadosCell = row.getCell(this.CLIENTE_COL.honorariosProgramados);
      if (honorariosProgramadosCell.value === null || honorariosProgramadosCell.value === undefined || honorariosProgramadosCell.value === '') {
        honorariosProgramadosCell.value = '{}';
        changed = true;
      }
        const mesesAdeudadosCell = row.getCell(this.CLIENTE_COL.mesesAdeudados);
        if (mesesAdeudadosCell.value === null || mesesAdeudadosCell.value === undefined) {
          mesesAdeudadosCell.value = 0;
          changed = true;
        }
    });

    return changed;
  }

  _ensurePagosSheetStructure(sheet) {
    if (!sheet) return false;

    const desiredColumns = [
      { header: 'ID Pago', key: 'id', width: 40 },
      { header: 'ID Cliente', key: 'clienteId', width: 40 },
      { header: 'Monto Pagado', key: 'monto', width: 15 },
      { header: 'Tipo de Pago', key: 'tipoPago', width: 20 },
      { header: 'Detalles', key: 'detalles', width: 50 },
      { header: 'Fecha del Pago', key: 'fecha', width: 15 },
      { header: 'Timestamp', key: 'timestamp', width: 25 },
      { header: 'Número Cheque', key: 'numeroCheque', width: 20 },
      { header: 'Banco Cheque', key: 'nombreBanco', width: 22 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Anulado At', key: 'anuladoAt', width: 24 },
      { header: 'Motivo Anulación', key: 'anuladoMotivo', width: 35 },
      { header: 'Recibo Relative Path', key: 'reciboRelativePath', width: 45 },
      { header: 'Recibo File Name', key: 'reciboFileName', width: 45 },
      { header: 'Recibo Número', key: 'reciboNumero', width: 18 }
    ];

    let changed = false;
    if (sheet.columnCount < desiredColumns.length) {
      changed = true;
    }
    sheet.columns = desiredColumns;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const estadoCell = row.getCell(this.PAGO_COL.estado);
      if (!estadoCell.value) {
        estadoCell.value = 'activo';
        changed = true;
      }

      const numeroChequeCell = row.getCell(this.PAGO_COL.numeroCheque);
      if (numeroChequeCell.value === null || numeroChequeCell.value === undefined) {
        numeroChequeCell.value = '';
        changed = true;
      }

      const bancoCell = row.getCell(this.PAGO_COL.nombreBanco);
      if (bancoCell.value === null || bancoCell.value === undefined) {
        bancoCell.value = '';
        changed = true;
      }

      const anuladoAtCell = row.getCell(this.PAGO_COL.anuladoAt);
      if (anuladoAtCell.value === null || anuladoAtCell.value === undefined) {
        anuladoAtCell.value = '';
        changed = true;
      }

      const anuladoMotivoCell = row.getCell(this.PAGO_COL.anuladoMotivo);
      if (anuladoMotivoCell.value === null || anuladoMotivoCell.value === undefined) {
        anuladoMotivoCell.value = '';
        changed = true;
      }

      const reciboPathCell = row.getCell(this.PAGO_COL.reciboRelativePath);
      if (reciboPathCell.value === null || reciboPathCell.value === undefined) {
        reciboPathCell.value = '';
        changed = true;
      }

      const reciboFileNameCell = row.getCell(this.PAGO_COL.reciboFileName);
      if (reciboFileNameCell.value === null || reciboFileNameCell.value === undefined) {
        reciboFileNameCell.value = '';
        changed = true;
      }
    });

    return changed;
  }

  // Inicializar archivos de Excel si no existen
  async initialize() {
    try {
      this._invalidateWorkbookCache('clientes');
      this._invalidateWorkbookCache('pagos');
      this._invalidateWorkbookCache('historial');

      if (!fs.existsSync(this.dataPath)) {
        fs.mkdirSync(this.dataPath, { recursive: true });
        console.log('✓ Carpeta data creada');
      }

      if (!fs.existsSync(this.clientesPath)) {
        await this.initializeClientesFile();
      }

      if (!fs.existsSync(this.pagosPath)) {
        await this.initializePagosFile();
      }

      if (!fs.existsSync(this.historicalPath)) {
        await this.initializeHistoricalFile();
      }
      
      console.log('✓ Sistema de base de datos listo');
    } catch (error) {
      console.error('❌ Error inicializando:', error);
    }
  }

  // Crear archivo de clientes
  async initializeClientesFile() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Clientes');

    sheet.columns = this.getClientesColumns();

    // Estilizar encabezado
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF366092' }
    };

    await workbook.xlsx.writeFile(this.clientesPath);
    console.log('✓ Archivo clientes.xlsx creado');
  }

  // Crear archivo de pagos
  async initializePagosFile() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Pagos');

    this._ensurePagosSheetStructure(sheet);

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF366092' }
    };

    await workbook.xlsx.writeFile(this.pagosPath);
    console.log('✓ Archivo pagos.xlsx creado');
  }

  // Crear archivo de historial de facturación
  async initializeHistoricalFile() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Historial');

    sheet.columns = [
      { header: 'ID Registro', key: 'id', width: 40 },
      { header: 'ID Cliente', key: 'clienteId', width: 40 },
      { header: 'Nombre Cliente', key: 'nombreCliente', width: 30 },
      { header: 'Mes', key: 'mes', width: 15 },
      { header: 'Comisión Cobrada', key: 'comisión', width: 15 },
      { header: 'Fecha de Cobro', key: 'fechaCobro', width: 15 },
      { header: 'Timestamp', key: 'timestamp', width: 25 }
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF366092' }
    };

    await workbook.xlsx.writeFile(this.historicalPath);
    console.log('✓ Archivo historial.xlsx creado');
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

  async getClientes() {
    try {
      const { workbook, sheet } = await this._getClientesWorkbook();
      const structureChanged = this._ensureClientesSheetStructure(sheet);
      if (structureChanged) {
        await workbook.xlsx.writeFile(this.clientesPath);
      }
      
      const clientes = [];
      if (sheet) {
        console.log(`📖 Leyendo ${sheet.rowCount} filas del archivo clientes.xlsx`);
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return; // Saltar encabezado
          const id = row.getCell(this.CLIENTE_COL.id).value;
          const nombre = row.getCell(this.CLIENTE_COL.nombre).value;
          
          // Solo incluir si tiene ID y nombre
          if (id && nombre) {
            const cliente = this._buildClienteFromRow(row);
            clientes.push(cliente);
            console.log(`  ✓ Cliente leído: ${nombre} - Deuda: $${cliente.totalAdeudado}`);
          }
        });
      }
      
      console.log(`✅ ${clientes.length} clientes encontrados`);
      
      return clientes;
    } catch (error) {
      console.error('❌ Error leyendo clientes:', error.message);
      return [];
    }
  }

  async getCliente(id) {
    const clientes = await this.getClientes();
    return clientes.find(c => c.id === id);
  }

  async addCliente(cliente) {
    try {
      console.log('📝 INICIO: Agregando cliente:', cliente.nombre);
      
      // Asegurar que el archivo existe
      if (!fs.existsSync(this.clientesPath)) {
        console.log('⚠ Archivo no existe, creando...');
        await this.initializeClientesFile();
        await new Promise(resolve => setTimeout(resolve, 200));
        this._invalidateWorkbookCache('clientes');
      }

      const { workbook, sheet } = await this._getClientesWorkbook();
      const structureChanged = this._ensureClientesSheetStructure(sheet);
      if (structureChanged) {
        await workbook.xlsx.writeFile(this.clientesPath);
      }

      console.log(`📊 Sheet tiene ${sheet.rowCount} filas actualmente`);

      // Agregar nueva fila usando valores en array (orden de columnas)
      // Cobro a mes vencido: el primer vencimiento es al inicio del mes siguiente.
      const now = new Date();
      const proximaFacturacion = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      
      const fechaCreacion = new Date().toISOString();
      const tipoTrabajo = cliente.tipoTrabajo === 'particular' ? 'particular' : 'honorarios';
      const interesMensualActivo = Boolean(cliente.interesMensualActivo);
      const interesMensualPorcentaje = Number(cliente.interesMensualPorcentaje) || 0;
      const dniCuit = (cliente.dniCuit || '').toString().trim().slice(0, 40);
      const honorarioBase = parseInt(cliente.honorario, 10) || 0;
      const honorarioInicialPeriodo = tipoTrabajo === 'honorarios'
        ? 0
        : honorarioBase;
      
      const newRow = sheet.addRow([
        cliente.id,
        cliente.nombre,
        cliente.telefono || '',
        honorarioBase,
        honorarioInicialPeriodo,
        honorarioInicialPeriodo,
        tipoTrabajo === 'honorarios' ? proximaFacturacion.toISOString() : '',
        fechaCreacion,
        tipoTrabajo,
        interesMensualActivo,
        interesMensualPorcentaje,
        new Date().toISOString(),
        dniCuit,
        '{}',
        0
      ]);
      
      console.log(`✏️ Fila agregada con valores`);
      console.log(`   - ID: ${cliente.id}`);
      console.log(`   - Nombre: ${cliente.nombre}`);
      console.log(`   - Tipo de trabajo: ${tipoTrabajo}`);
      console.log(`   - Honorario: $${honorarioBase}`);
      console.log(`   - Total Adeudado (inicial): $${honorarioInicialPeriodo}`);
      if (tipoTrabajo === 'honorarios') {
        console.log(`   - Próxima Facturación: ${proximaFacturacion.toISOString()}`);
      }

      // Guardar archivo con reintentos
      let writeSuccess = false;
      for (let i = 0; i < 3; i++) {
        try {
          console.log(`💾 Guardando archivo (intento ${i + 1}/3)...`);
          await workbook.xlsx.writeFile(this.clientesPath);
          writeSuccess = true;
          console.log('✓ Archivo guardado correctamente');
          break;
        } catch (err) {
          console.log(`❌ Error en guardado: ${err.message}`);
          if (i < 2) await new Promise(r => setTimeout(r, 300));
        }
      }
      
      if (!writeSuccess) throw new Error('No se pudo guardar el archivo después de 3 intentos');

      // Verificar que se guardó
      console.log('🔍 Verificando que se guardó correctamente...');
      await new Promise(r => setTimeout(r, 200));
      
      const { sheet: verifySheet } = await this._getClientesWorkbook();
      console.log(`✅ Verificación: ${verifySheet.rowCount} filas en archivo`);
      
      // Verificar que la última fila tiene el cliente
      const lastRow = verifySheet.getRow(verifySheet.rowCount);
      const nombreGuardado = lastRow.getCell(2).value;
      console.log(`✅ Última fila - Nombre: "${nombreGuardado}"`);
      
      console.log('✅ EXITO: Cliente agregado completamente');
      return cliente;
    } catch (error) {
      console.error('❌ ERROR FINAL:', error.message);
      throw error;
    }
  }

  async updateCliente(id, updates) {
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
          if (updates.nombre !== undefined) row.getCell(this.CLIENTE_COL.nombre).value = updates.nombre;
          if (updates.telefono !== undefined) row.getCell(this.CLIENTE_COL.telefono).value = updates.telefono;
          if (updates.dniCuit !== undefined) row.getCell(this.CLIENTE_COL.dniCuit).value = (updates.dniCuit || '').toString().trim().slice(0, 40);
          if (updates.honorario !== undefined) {
            // 1) Obtener el honorario anterior ANTES de modificarlo
            const honorarioAnterior = Math.round((parseFloat(
              row.getCell(this.CLIENTE_COL.honorario).value
            ) || 0) * 100) / 100;

            const nuevoHonorario = Math.round((parseFloat(updates.honorario) || 0) * 100) / 100;

            // 2) Preservar el honorario anterior para todos los meses históricos
            //    que aún no tengan un valor programado explícito.
            const honorariosProgramados = this._safeJsonParseObject(
              row.getCell(this.CLIENTE_COL.honorariosProgramados).value,
              {}
            );
            const fechaCreacion = row.getCell(this.CLIENTE_COL.fechaCreacion).value;
            this._preservarHonorariosAnteriores(honorariosProgramados, honorarioAnterior, fechaCreacion);

            // 3) Guardar el nuevo honorario para el mes actual
            honorariosProgramados[this.getCurrentMonthKey()] = nuevoHonorario;
            row.getCell(this.CLIENTE_COL.honorariosProgramados).value = JSON.stringify(
              this._sanitizeHonorariosProgramados(honorariosProgramados)
            );

            row.getCell(this.CLIENTE_COL.honorario).value = nuevoHonorario;
          }

          if (updates.tipoTrabajo !== undefined) {
            const tipoTrabajo = updates.tipoTrabajo === 'particular' ? 'particular' : 'honorarios';
            row.getCell(this.CLIENTE_COL.tipoTrabajo).value = tipoTrabajo;
            if (tipoTrabajo === 'particular') {
              row.getCell(this.CLIENTE_COL.proximaFacturacion).value = '';
            } else if (!row.getCell(this.CLIENTE_COL.proximaFacturacion).value) {
              const proximaFacturacion = new Date();
              proximaFacturacion.setDate(proximaFacturacion.getDate() + 30);
              row.getCell(this.CLIENTE_COL.proximaFacturacion).value = proximaFacturacion.toISOString();
            }
          }

          if (updates.interesMensualActivo !== undefined) {
            row.getCell(this.CLIENTE_COL.interesMensualActivo).value = Boolean(updates.interesMensualActivo);
          }

          if (updates.interesMensualPorcentaje !== undefined) {
            row.getCell(this.CLIENTE_COL.interesMensualPorcentaje).value = Number(updates.interesMensualPorcentaje) || 0;
          }

          if (updates.honorariosProgramados !== undefined) {
            const cleanProgramados = this._sanitizeHonorariosProgramados(updates.honorariosProgramados);
            row.getCell(this.CLIENTE_COL.honorariosProgramados).value = JSON.stringify(cleanProgramados);
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
      console.error('Error actualizando cliente:', error);
      throw error;
    }
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
    try {
      console.log(`🗑️ INICIO: Eliminando cliente con ID: ${id}`);
      
      // Obtener datos del cliente antes de eliminar
      const cliente = await this.getCliente(id);
      if (!cliente) {
        throw new Error('Cliente no encontrado');
      }

      // Eliminar del archivo de clientes
      const { workbook: clientesWorkbook, sheet: clientesSheet } = await this._getClientesWorkbook();

      let rowToDelete = null;
      clientesSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (row.getCell(1).value === id) {
          rowToDelete = rowNumber;
        }
      });

      if (rowToDelete) {
        clientesSheet.spliceRows(rowToDelete, 1);
        console.log(`✓ Cliente ${cliente.nombre} eliminado del archivo de clientes`);
      }

      await clientesWorkbook.xlsx.writeFile(this.clientesPath);
      this._invalidateWorkbookCache('clientes');

      // Eliminar todos los pagos asociados del archivo de pagos
      const { workbook: pagosWorkbook, sheet: pagosSheet } = await this._getPagosWorkbook();

      let rowsToDelete = [];
      pagosSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (row.getCell(2).value === id) {
          rowsToDelete.push(rowNumber);
        }
      });

      // Eliminar en orden inverso para no afectar los índices
      for (let i = rowsToDelete.length - 1; i >= 0; i--) {
        pagosSheet.spliceRows(rowsToDelete[i], 1);
      }

      if (rowsToDelete.length > 0) {
        console.log(`✓ ${rowsToDelete.length} pago(s) del cliente eliminado(s)`);
      }

      await pagosWorkbook.xlsx.writeFile(this.pagosPath);
      this._invalidateWorkbookCache('pagos');

      // Eliminar del historial
      const { workbook: historicalWorkbook, sheet: historicalSheet } = await this._getHistorialWorkbook();

      let histRowsToDelete = [];
      historicalSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (row.getCell(2).value === id) {
          histRowsToDelete.push(rowNumber);
        }
      });

      for (let i = histRowsToDelete.length - 1; i >= 0; i--) {
        historicalSheet.spliceRows(histRowsToDelete[i], 1);
      }

      if (histRowsToDelete.length > 0) {
        console.log(`✓ ${histRowsToDelete.length} registro(s) del historial eliminado(s)`);
      }

      await historicalWorkbook.xlsx.writeFile(this.historicalPath);
      this._invalidateWorkbookCache('historial');

      console.log(`✅ Cliente ${cliente.nombre} y todos sus registros eliminados completamente`);
      return { success: true, message: `Cliente ${cliente.nombre} eliminado completamente` };
    } catch (error) {
      console.error('❌ Error eliminando cliente:', error.message);
      throw error;
    }
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
    const { workbook, sheet: worksheet } = await this._getClientesWorkbook();

    let rowNum = null;
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && row.getCell(this.CLIENTE_COL.id).value == clienteId) {
        rowNum = rowNumber;
      }
    });

    if (!rowNum) {
      throw new Error('Cliente no encontrado');
    }

    // Calcular nueva fecha: diasAtras hacia el pasado
    const ahora = new Date();
    const nuevaFecha = new Date(ahora);
    nuevaFecha.setDate(nuevaFecha.getDate() - diasAtras);

    worksheet.getCell(rowNum, this.CLIENTE_COL.fechaCreacion).value = nuevaFecha.toISOString();
    worksheet.getCell(rowNum, this.CLIENTE_COL.lastUpdate).value = new Date().toISOString();

    await workbook.xlsx.writeFile(this.clientesPath);
    this._invalidateWorkbookCache('clientes');
  }
}

module.exports = ExcelManager;

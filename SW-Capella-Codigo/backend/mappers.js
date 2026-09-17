// Estos mappers replican exactamente el contrato de salida que tenían
// _buildClienteFromRow y _buildPagoFromRow sobre Excel. Las rarezas que parecen
// bugs (reciboNumero 0 -> null, textos vacíos como '' y no null) son
// deliberadas: la API ya las expone así y el frontend las espera.

function parseJsonObjeto(valor, fallback = {}) {
  if (valor && typeof valor === 'object') return valor;
  if (typeof valor !== 'string' || valor.trim() === '') return fallback;
  try {
    const parseado = JSON.parse(valor);
    return parseado && typeof parseado === 'object' && !Array.isArray(parseado)
      ? parseado
      : fallback;
  } catch {
    return fallback;
  }
}

function filaACliente(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    nombre: fila.nombre,
    telefono: fila.telefono || '',
    honorario: parseFloat(fila.honorario) || 0,
    honorarioPeriodo: parseFloat(fila.honorarioPeriodo) || 0,
    totalAdeudado: parseFloat(fila.totalAdeudado) || 0,
    proximaFacturacion: fila.proximaFacturacion || '',
    fechaCreacion: fila.fechaCreacion,
    tipoTrabajo: fila.tipoTrabajo || 'honorarios',
    interesMensualActivo: fila.interesMensualActivo === 1,
    interesMensualPorcentaje: parseFloat(fila.interesMensualPorcentaje) || 0,
    lastUpdate: fila.lastUpdate,
    dniCuit: fila.dniCuit || '',
    honorariosProgramados: parseJsonObjeto(fila.honorariosProgramados, {}),
    mesesAdeudados: parseInt(fila.mesesAdeudados, 10) || 0,
  };
}

function filaAPago(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    clienteId: fila.clienteId,
    monto: parseFloat(fila.monto) || 0,
    tipoPago: fila.tipoPago || 'Efectivo',
    detalles: fila.detalles || '',
    fecha: fila.fecha,
    timestamp: fila.timestamp,
    numeroCheque: (fila.numeroCheque || '').toString(),
    nombreBanco: (fila.nombreBanco || '').toString(),
    estado: fila.estado === 'anulado' ? 'anulado' : 'activo',
    anuladoAt: fila.anuladoAt || '',
    anuladoMotivo: (fila.anuladoMotivo || '').toString(),
    reciboRelativePath: (fila.reciboRelativePath || '').toString(),
    reciboFileName: (fila.reciboFileName || '').toString(),
    reciboNumero: fila.reciboNumero || null,
  };
}

function filaAHistorial(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    clienteId: fila.clienteId,
    nombreCliente: fila.nombreCliente,
    mes: fila.mes,
    // Con tilde a propósito: es la clave que getAllHistorial() ya devuelve
    // por la API hacia el frontend. La columna SQL se llama `comision`.
    'comisión': fila.comision,
    fechaCobro: fila.fechaCobro,
    timestamp: fila.timestamp,
  };
}

module.exports = { filaACliente, filaAPago, filaAHistorial, parseJsonObjeto };

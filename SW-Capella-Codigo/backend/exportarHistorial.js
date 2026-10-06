// Exporta el historial de un cliente (lo mismo que muestra el modal "Historial")
// a PDF o a Excel, para no tener que sacar capturas de pantalla.
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// "03-2026" → "Marzo 2026"
const mesLegible = (mes) => {
  const [m, anio] = (mes || '').split('-');
  return MESES[parseInt(m, 10) - 1] ? `${MESES[parseInt(m, 10) - 1]} ${anio}` : (mes || '');
};

const claveOrden = (mes) => {
  const [m, anio] = (mes || '').split('-');
  return (parseInt(anio, 10) || 0) * 100 + (parseInt(m, 10) || 0);
};

const pesos = (v) => '$ ' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const redondear = (v) => Math.round(v * 100) / 100;

// Filas ordenadas del mes más viejo al más nuevo, con los mismos totales que el modal.
function armarResumen(historial) {
  const filas = [...historial]
    .sort((a, b) => claveOrden(a.mes) - claveOrden(b.mes))
    .map((h) => ({
      mes: mesLegible(h.mes),
      deuda: parseFloat(h.deuda) || 0,
      pagado: parseFloat(h.montoPagado) || 0,
      pendiente: parseFloat(h.deudaPendiente) || 0,
      estado: h.estado === 'pagado' ? 'PAGADO' : 'ADEUDADO',
    }));

  return {
    filas,
    totalPagado: redondear(filas.reduce((s, f) => s + f.pagado, 0)),
    totalAdeudado: redondear(filas.reduce((s, f) => s + f.pendiente, 0)),
  };
}

function generarPdf(cliente, historial, logoPath) {
  const { filas, totalPagado, totalAdeudado } = armarResumen(historial);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const buffers = [];
    doc.on('data', (b) => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    if (logoPath) {
      const y = doc.y;
      doc.image(logoPath, (doc.page.width - 220) / 2, y, { fit: [220, 72], align: 'center' });
      doc.y = y + 85;
    }

    doc.font('Helvetica-Bold').fontSize(15).text(`Resumen de cuenta: ${cliente.nombre}`, { align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#555')
      .text(`${cliente.dniCuit ? `DNI/CUIT: ${cliente.dniCuit}  ·  ` : ''}Emitido el ${new Date().toLocaleDateString('es-AR')}`, { align: 'center' });
    doc.fillColor('black').moveDown(1.2);

    // Tabla: Mes | Deuda Original | Pagado | Pendiente | Estado
    const x0 = doc.page.margins.left;
    const anchos = [130, 100, 100, 100, 85];
    const titulos = ['Mes', 'Deuda Original', 'Pagado', 'Pendiente', 'Estado'];
    const altoFila = 20;

    const dibujarFila = (celdas, { negrita = false, fondo = null } = {}) => {
      if (doc.y + altoFila > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
      const y = doc.y;
      const anchoTotal = anchos.reduce((a, b) => a + b, 0);
      if (fondo) doc.rect(x0, y, anchoTotal, altoFila).fill(fondo).fillColor('black');
      doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
      let x = x0;
      celdas.forEach((texto, i) => {
        doc.text(texto, x + 5, y + 6, { width: anchos[i] - 10, align: i === 0 ? 'left' : i === 4 ? 'center' : 'right', lineBreak: false });
        x += anchos[i];
      });
      doc.moveTo(x0, y + altoFila).lineTo(x0 + anchoTotal, y + altoFila).strokeColor('#ccc').stroke();
      doc.x = x0;
      doc.y = y + altoFila;
    };

    dibujarFila(titulos, { negrita: true, fondo: '#e3e8f3' });
    filas.forEach((f) => dibujarFila([f.mes, pesos(f.deuda), pesos(f.pagado), pesos(f.pendiente), f.estado]));

    doc.moveDown(1.5);
    doc.font('Helvetica').fontSize(11).text(`Total pagado: ${pesos(totalPagado)}`, x0, doc.y, { align: 'right', width: 515 });
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#1d3e8a')
      .text(`Total adeudado: ${pesos(totalAdeudado)}`, x0, doc.y, { align: 'right', width: 515 });

    doc.end();
  });
}

async function generarExcel(cliente, historial) {
  const { filas, totalPagado, totalAdeudado } = armarResumen(historial);
  const formatoPesos = '"$"#,##0.00';

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Resumen');

  hoja.addRow([`Resumen de cuenta: ${cliente.nombre}`]).font = { bold: true, size: 14 };
  hoja.addRow([`${cliente.dniCuit ? `DNI/CUIT: ${cliente.dniCuit} · ` : ''}Emitido el ${new Date().toLocaleDateString('es-AR')}`]);
  hoja.addRow([]);

  const encabezado = hoja.addRow(['Mes', 'Deuda Original', 'Pagado', 'Pendiente', 'Estado']);
  encabezado.font = { bold: true };
  encabezado.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3E8F3' } };
    c.border = { bottom: { style: 'thin' } };
  });

  filas.forEach((f) => hoja.addRow([f.mes, f.deuda, f.pagado, f.pendiente, f.estado]));

  hoja.addRow([]);
  hoja.addRow(['Total pagado', null, totalPagado]).font = { bold: true };
  const filaAdeudado = hoja.addRow(['Total adeudado', null, null, totalAdeudado]);
  filaAdeudado.font = { bold: true, size: 12, color: { argb: 'FF1D3E8A' } };

  [20, 18, 18, 18, 14].forEach((ancho, i) => { hoja.getColumn(i + 1).width = ancho; });
  [2, 3, 4].forEach((n) => { hoja.getColumn(n).numFmt = formatoPesos; });
  hoja.getColumn(5).alignment = { horizontal: 'center' };

  return libro.xlsx.writeBuffer();
}

module.exports = { armarResumen, generarPdf, generarExcel };

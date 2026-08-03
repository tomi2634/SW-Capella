const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

class PDFGenerator {
  getLogoPath() {
    const candidates = [
      path.join(__dirname, '..', 'frontend', 'public', 'images', 'isologotipo-capella.png'),
      path.join(__dirname, '..', 'frontend', 'public', 'images', 'isologotipo-capella_sinfondo.png')
    ];

    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  drawHeader(doc) {
    const logoPath = this.getLogoPath();

    if (logoPath) {
      const startY = doc.y;
      const logoWidth = 260;
      const logoHeight = 86;
      const logoX = (doc.page.width - logoWidth) / 2;

      doc.image(logoPath, logoX, startY, {
        fit: [logoWidth, logoHeight],
        align: 'center'
      });

      doc.y = startY + 88;
      return;
    }

    // Fallback por si falta el archivo de logo en despliegues antiguos.
    doc.fontSize(18).font('Helvetica-Bold').text('ESTUDIO CONTABLE CAPELLA', {
      align: 'center'
    });
  }

  generarRecibo(datos) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A5',
          margin: 20,
          bufferPages: true
        });

        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          resolve(Buffer.concat(buffers));
        });

        // Encabezado
        this.drawHeader(doc);

        doc.fontSize(10).font('Helvetica').text('Roca 276', { align: 'center' });
        doc.fontSize(10).text('Teléfono: (2625) 436867', { align: 'center' });

        // Separador
        doc.moveTo(20, doc.y + 8).lineTo(290, doc.y + 8).stroke();

        doc.moveDown(2);

        // Título del recibo
        doc.fontSize(14).font('Helvetica-Bold').text('RECIBO DE PAGO', {
          align: 'center'
        });

        const numeroRecibo = Number.isInteger(datos.numeroRecibo) ? datos.numeroRecibo : this.generarNumeroRecibo();
        doc.fontSize(10).font('Helvetica').text(`Numero de Recibo: ${numeroRecibo}`, {
          align: 'center'
        });

        // Separador
        doc.moveTo(20, doc.y + 8).lineTo(290, doc.y + 8).stroke();

        doc.moveDown(2);

        // Datos del cliente
        doc.fontSize(9).font('Helvetica-Bold').text('CLIENTE:');
        doc.fontSize(9).font('Helvetica').text(datos.cliente.nombre);
        doc.text(`Teléfono: ${datos.cliente.telefono || 'N/A'}`);

        doc.moveDown(1.5);

        // Detalles del pago
        doc.fontSize(9).font('Helvetica-Bold').text('DETALLE DEL PAGO:');

        const table = {
          x: 20,
          y: doc.y + 8,
          width: 270,
          rows: [
            ['Concepto', 'Valor'],
            ['Honorarios Profesionales', `$${datos.monto.toFixed(2)}`],
          ]
        };

        this.drawTable(doc, table);

        doc.moveDown(1.5);

        doc.fontSize(9).font('Helvetica-Bold').text('TIPO DE PAGO: ', { continued: true });
        doc.fontSize(9).font('Helvetica').text(datos.tipoPago || 'Efectivo');

        if ((datos.tipoPago || '').toString().toLowerCase().includes('cheque')) {
          doc.moveDown(0.5);
          doc.fontSize(9).font('Helvetica-Bold').text('DATOS DEL CHEQUE:');
          const cheques = (datos.numeroCheque || '').split(/[,;]+/).map(c => c.trim()).filter(c => c);
          const bancos = (datos.nombreBanco || '').split(/[,;]+/).map(b => b.trim()).filter(b => b);
          cheques.forEach((cheque, index) => {
            doc.fontSize(8).font('Helvetica').text(`Número de cheque ${index + 1}: ${cheque}`);
            if (bancos[index]) {
              doc.fontSize(8).text(`Banco ${index + 1}: ${bancos[index]}`);
            }
          });
        }

        if (datos.detalles && datos.detalles.trim()) {
          doc.moveDown(0.5);
          doc.fontSize(9).font('Helvetica-Bold').text('DETALLES:');
          doc.fontSize(8).font('Helvetica').text(datos.detalles.trim(), {
            width: 270,
            align: 'left'
          });
          doc.moveDown(1);
        } else {
          doc.moveDown(0.5);
          doc.fontSize(9).font('Helvetica-Bold').text('DETALLES:');
          doc.fontSize(8).font('Helvetica').text('Sin detalles especificados', {
            width: 270,
            align: 'left'
          });
          doc.moveDown(1);
        }

        // Total
        doc.fontSize(11).font('Helvetica-Bold').text(`TOTAL: $${datos.monto.toFixed(2)}`, {
          align: 'center'
        });

        doc.moveDown(1.5);

        // Fecha
        doc.fontSize(8).font('Helvetica').text(
          `Fecha: ${datos.fecha.toLocaleDateString('es-AR')}`,
          { align: 'center' }
        );

        doc.fontSize(8).text(
          `Hora: ${datos.fecha.toLocaleTimeString('es-AR')}`,
          { align: 'center' }
        );

        doc.moveDown(1);

        // Separador final
        doc.moveTo(20, doc.y + 8).lineTo(290, doc.y + 8).stroke();

        const footerText = 'Por favor, conserve este recibo como comprobante de pago.';
        const footerWidth = 240;
        const footerX = (doc.page.width - footerWidth) / 2;
        const footerY = doc.page.height - doc.page.margins.bottom - 28;

        doc.fontSize(6.5).font('Helvetica');
        doc.text(footerText, footerX, footerY, {
          width: footerWidth,
          align: 'center',
          lineGap: 1,
          paragraphGap: 0
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  drawTable(doc, table) {
    const { x, y, width, rows } = table;
    const rowHeight = 25;
    const colWidths = [190, 80];

    let currentY = y;

    rows.forEach((row, rowIndex) => {
      let colX = x;

      row.forEach((cell, colIndex) => {
        const colWidth = colWidths[colIndex];

        // Dibujar el rectángulo PRIMERO
        doc.rect(colX, currentY, colWidth, rowHeight).stroke();

        // LUEGO escribir el texto con mejor alineación y más espacio
        if (rowIndex === 0) {
          // Encabezados: negrita y centrado
          doc.fontSize(8).font('Helvetica-Bold');
          doc.text(cell, colX + 8, currentY + 7, { 
            width: colWidth - 16,
            align: 'center'
          });
        } else {
          // Datos normales
          doc.fontSize(8).font('Helvetica');
          doc.text(cell, colX + 8, currentY + 8, { 
            width: colWidth - 16,
            align: 'center'
          });
        }

        colX += colWidth;
      });

      currentY += rowHeight;
    });

    // Actualizar la posición Y del documento
    doc.y = currentY + 5;
  }

  generarNumeroRecibo() {
    return `RCP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }
}

module.exports = PDFGenerator;

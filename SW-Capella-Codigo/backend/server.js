const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const ExcelManager = require('./excelManager');
const PDFGenerator = require('./pdfGenerator');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
let archiver = null;

try {
  archiver = require('archiver');
} catch (_) {
  console.warn('⚠️ Dependencia opcional "archiver" no instalada. Los backups ZIP quedarán deshabilitados hasta ejecutar npm install en backend.');
}

const app = express();
const PORT = 5000;
const excelManager = new ExcelManager();
const pdfGenerator = new PDFGenerator();
const TRABAJOS_ROOT_DIR = path.join(__dirname, '..', 'Trabajos Estudio Capella');
const HONORARIOS_DIR_NAME = 'Honorarios Estudio Capella';
const PARTICULARES_DIR_NAME = 'Trabajos Particulares Estudio Capella';
const HONORARIOS_DIR = path.join(TRABAJOS_ROOT_DIR, HONORARIOS_DIR_NAME);
const PARTICULARES_DIR = path.join(TRABAJOS_ROOT_DIR, PARTICULARES_DIR_NAME);
const LEGACY_RECIBOS_ROOT_DIR = path.join(__dirname, '..', 'Recibos Honorarios Estudio Capella');
const LEGACY_HONORARIOS_ROOT_DIR = path.join(__dirname, '..', 'Honorarios Estudio Capella');
const RECIBOS_COUNTER_FILE = path.join(TRABAJOS_ROOT_DIR, '_contador_recibos.json');
const PARTICULARES_FOLDER_INDEX_FILE = path.join(TRABAJOS_ROOT_DIR, '_indice_carpetas_particulares.json');
const DATA_DIR = path.join(__dirname, '..', 'data');
const RECIBOS_INDEX_FILE = path.join(DATA_DIR, 'recibos-index.json');
const BACKUPS_DIR = path.join(__dirname, '..', 'backups');
const BACKUP_RETENTION_MAX_FILES = Number.parseInt(process.env.BACKUP_RETENTION_MAX_FILES || '10', 10);
let recibosIndexCache = null;
let recibosIndexLoadPromise = null;

const stampForFile = (date = new Date()) => {
  return date.toISOString().replace(/[:.]/g, '-');
};

const createDataZipBackup = async () => {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  await fs.promises.mkdir(BACKUPS_DIR, { recursive: true });

  if (!archiver) {
    throw new Error('No se pudo crear backup ZIP: falta la dependencia "archiver". Ejecute npm install en la carpeta backend.');
  }

  const fileName = `data.backup.${stampForFile()}.zip`;
  const outputPath = path.join(BACKUPS_DIR, fileName);

  // Copiar un SQLite mientras hay una escritura en vuelo puede producir una
  // copia corrupta. VACUUM INTO genera un snapshot consistente sin bloquear.
  const snapshotPath = path.join(DATA_DIR, '_backup_capella.db');
  try {
    await fs.promises.unlink(snapshotPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  excelManager.db.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(DATA_DIR, 'data');
    archive.finalize();
  });

  try {
    await fs.promises.unlink(snapshotPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const stats = await fs.promises.stat(outputPath);

  const retentionSummary = await cleanupZipBackupsRetention();

  return {
    fileName,
    fullPath: outputPath,
    sizeBytes: stats.size,
    createdAt: new Date().toISOString(),
    retention: retentionSummary
  };
};

const getDayStamp = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const hasBackupForDay = async (dayStamp) => {
  if (!fs.existsSync(BACKUPS_DIR)) {
    return false;
  }

  const entries = await fs.promises.readdir(BACKUPS_DIR, { withFileTypes: true });
  return entries.some((entry) => {
    if (!entry.isFile()) {
      return false;
    }
    const fileName = entry.name.toLowerCase();
    return fileName.endsWith('.zip') && fileName.includes(`data.backup.${dayStamp.toLowerCase()}t`);
  });
};

const ensureDailyStartupBackup = async () => {
  try {
    await fs.promises.mkdir(BACKUPS_DIR, { recursive: true });

    const dayStamp = getDayStamp(new Date());
    const alreadyExists = await hasBackupForDay(dayStamp);

    if (alreadyExists) {
      console.log(`ℹ️ Backup diario ya existe para ${dayStamp}. No se crea uno nuevo.`);
      return;
    }

    const backup = await createDataZipBackup();
    console.log(`✅ Backup diario creado al iniciar servidor: ${backup.fileName}`);
  } catch (error) {
    console.error('❌ No se pudo crear el backup diario al iniciar:', error.message);
  }
};

const cleanupZipBackupsRetention = async () => {
  const maxBackups = Number.isInteger(BACKUP_RETENTION_MAX_FILES) && BACKUP_RETENTION_MAX_FILES > 0
    ? BACKUP_RETENTION_MAX_FILES
    : 20;

  const entries = await fs.promises.readdir(BACKUPS_DIR, { withFileTypes: true });
  const zipBackups = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.zip'))
    .map((entry) => path.join(BACKUPS_DIR, entry.name));

  if (zipBackups.length <= maxBackups) {
    return {
      maxBackups,
      deletedCount: 0,
      deletedFiles: []
    };
  }

  const backupsWithStats = await Promise.all(
    zipBackups.map(async (fullPath) => {
      const stats = await fs.promises.stat(fullPath);
      return {
        fullPath,
        fileName: path.basename(fullPath),
        mtimeMs: stats.mtimeMs
      };
    })
  );

  backupsWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const filesToDelete = backupsWithStats.slice(maxBackups);

  for (const item of filesToDelete) {
    await fs.promises.unlink(item.fullPath);
  }

  return {
    maxBackups,
    deletedCount: filesToDelete.length,
    deletedFiles: filesToDelete.map((item) => item.fileName)
  };
};

const normalizeMonto = (value) => {
  return parseFloat(value.toString().replace(/,/g, '.'));
};

const normalizeTipoTrabajo = (value) => {
  return value === 'particular' ? 'particular' : 'honorarios';
};

const getTrabajoFolderByTipo = (tipoTrabajo) => {
  return normalizeTipoTrabajo(tipoTrabajo) === 'particular' ? PARTICULARES_DIR : HONORARIOS_DIR;
};

const normalizeDocumento = (value) => {
  return (value || '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
};

const loadParticularesFolderIndex = async () => {
  try {
    const raw = (await fs.promises.readFile(PARTICULARES_FOLDER_INDEX_FILE, 'utf8')).replace(/^\uFEFF/, '');
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch (parseError) {
      // Si el índice quedó dañado, se regenera para evitar errores de API.
      await saveParticularesFolderIndex({});
      return {};
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
};

const saveParticularesFolderIndex = async (index) => {
  await fs.promises.writeFile(PARTICULARES_FOLDER_INDEX_FILE, JSON.stringify(index, null, 2));
};

const resolveParticularFolderName = async (cliente) => {
  const documentoNormalizado = normalizeDocumento(cliente?.dniCuit);
  if (!documentoNormalizado) {
    return sanitizeForFolderName(cliente?.nombre);
  }

  const index = await loadParticularesFolderIndex();
  if (index[documentoNormalizado]) {
    return index[documentoNormalizado];
  }

  const existingFolders = await fs.promises.readdir(PARTICULARES_DIR, { withFileTypes: true });
  const existingByDoc = existingFolders.find(
    (entry) => entry.isDirectory() && entry.name.toUpperCase().includes(documentoNormalizado)
  );

  const folderName = existingByDoc
    ? existingByDoc.name
    : sanitizeForFolderName(`${cliente?.nombre || 'Cliente'} [${documentoNormalizado}]`);

  index[documentoNormalizado] = folderName;
  await saveParticularesFolderIndex(index);
  return folderName;
};

const resolveClienteFolderName = async (cliente, tipoTrabajo) => {
  const tipo = normalizeTipoTrabajo(tipoTrabajo || cliente?.tipoTrabajo);
  if (tipo === 'particular') {
    return resolveParticularFolderName(cliente);
  }
  return sanitizeForFolderName(cliente?.nombre);
};

const moveLegacyContents = async (sourceDir, destinationDir) => {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(destinationDir, entry.name);

    if (fs.existsSync(targetPath)) {
      continue;
    }

    await fs.promises.rename(sourcePath, targetPath);
  }

  const pending = await fs.promises.readdir(sourceDir);
  if (pending.length === 0) {
    await fs.promises.rmdir(sourceDir);
  }
};

const ensureTrabajosStructure = async () => {
  await fs.promises.mkdir(TRABAJOS_ROOT_DIR, { recursive: true });
  await fs.promises.mkdir(HONORARIOS_DIR, { recursive: true });
  await fs.promises.mkdir(PARTICULARES_DIR, { recursive: true });

  await moveLegacyContents(LEGACY_RECIBOS_ROOT_DIR, HONORARIOS_DIR);
  await moveLegacyContents(LEGACY_HONORARIOS_ROOT_DIR, HONORARIOS_DIR);

  if (!fs.existsSync(PARTICULARES_FOLDER_INDEX_FILE)) {
    await saveParticularesFolderIndex({});
  }
};

const normalizeReciboIndexItem = (item) => {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const relativePath = normalizeRelativePath(item.relativePath);
  if (!relativePath) {
    return null;
  }

  return {
    fileName: (item.fileName || '').toString(),
    numeroRecibo: Number.isInteger(item.numeroRecibo) ? item.numeroRecibo : null,
    tipoTrabajo: normalizeTipoTrabajo(item.tipoTrabajo),
    categoriaCarpeta: (item.categoriaCarpeta || '').toString(),
    clienteFolderName: (item.clienteFolderName || '').toString(),
    clienteId: (item.clienteId || '').toString() || null,
    relativePath,
    size: Number(item.size) || 0,
    createdAt: item.createdAt || new Date().toISOString(),
    downloadUrl: item.downloadUrl || `/api/recibos/descargar?path=${encodeURIComponent(relativePath)}`,
    anulado: Boolean(item.anulado),
    anuladoAt: item.anuladoAt || '',
    anuladoMotivo: (item.anuladoMotivo || '').toString(),
    pagoId: (item.pagoId || '').toString() || null,
    tipoPago: (item.tipoPago || '').toString() || null,
    numeroCheque: (item.numeroCheque || '').toString(),
    nombreBanco: (item.nombreBanco || '').toString()
  };
};

const saveRecibosIndex = async (items) => {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  recibosIndexCache = items.map(normalizeReciboIndexItem).filter(Boolean);
  await fs.promises.writeFile(
    RECIBOS_INDEX_FILE,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      items: recibosIndexCache
    }, null, 2)
  );
  return recibosIndexCache;
};

const buildRecibosIndexFromDisk = async () => {
  await ensureTrabajosStructure();

  const clientes = await excelManager.getClientes();
  const pagos = await excelManager.getAllPagos();
  const pagoByReciboPath = new Map();

  for (const p of pagos) {
    const key = normalizeRelativePath(p.reciboRelativePath);
    if (key) {
      pagoByReciboPath.set(key, p);
    }
  }

  const folderToClienteId = new Map();
  for (const c of clientes) {
    const folderName = await resolveClienteFolderName(c, c.tipoTrabajo);
    const tipo = normalizeTipoTrabajo(c.tipoTrabajo);
    folderToClienteId.set(`${tipo}::${folderName}`, c.id);
  }

  const items = [];
  const baseDirs = [
    { tipoTrabajo: 'honorarios', dir: HONORARIOS_DIR },
    { tipoTrabajo: 'particular', dir: PARTICULARES_DIR }
  ];

  for (const baseDir of baseDirs) {
    const folders = await fs.promises.readdir(baseDir.dir, { withFileTypes: true });

    for (const folder of folders) {
      if (!folder.isDirectory()) {
        continue;
      }

      const folderPath = path.join(baseDir.dir, folder.name);
      const files = await fs.promises.readdir(folderPath, { withFileTypes: true });

      for (const file of files) {
        if (!file.isFile() || path.extname(file.name).toLowerCase() !== '.pdf') {
          continue;
        }

        const filePath = path.join(folderPath, file.name);
        const stats = await fs.promises.stat(filePath);
        const fileClienteId = folderToClienteId.get(`${baseDir.tipoTrabajo}::${folder.name}`) || null;
        const relativePath = path.relative(TRABAJOS_ROOT_DIR, filePath);
        const pagoAsociado = pagoByReciboPath.get(normalizeRelativePath(relativePath));
        const numberMatch = file.name.match(/Recibo\s+(\d+)/i);
        const numeroRecibo = numberMatch ? parseInt(numberMatch[1], 10) : null;

        items.push(normalizeReciboIndexItem({
          fileName: file.name,
          numeroRecibo,
          tipoTrabajo: baseDir.tipoTrabajo,
          categoriaCarpeta: baseDir.tipoTrabajo === 'particular' ? PARTICULARES_DIR_NAME : HONORARIOS_DIR_NAME,
          clienteFolderName: folder.name,
          clienteId: fileClienteId,
          relativePath,
          size: stats.size,
          createdAt: stats.birthtime,
          downloadUrl: `/api/recibos/descargar?path=${encodeURIComponent(relativePath)}`,
          anulado: (pagoAsociado?.estado || '').toString().toLowerCase() === 'anulado',
          anuladoAt: pagoAsociado?.anuladoAt || '',
          anuladoMotivo: pagoAsociado?.anuladoMotivo || '',
          pagoId: pagoAsociado?.id || null,
          tipoPago: (pagoAsociado?.tipoPago || extractTipoPagoFromName(file.name) || '').toString().trim() || null,
          numeroCheque: (pagoAsociado?.numeroCheque || '').toString().trim(),
          nombreBanco: (pagoAsociado?.nombreBanco || '').toString().trim()
        }));
      }
    }
  }

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return items;
};

const loadRecibosIndex = async () => {
  if (recibosIndexCache) {
    return recibosIndexCache;
  }

  if (recibosIndexLoadPromise) {
    return recibosIndexLoadPromise;
  }

  recibosIndexLoadPromise = (async () => {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });

    try {
      const raw = await fs.promises.readFile(RECIBOS_INDEX_FILE, 'utf8');
      const parsed = JSON.parse((raw || '').replace(/^\uFEFF/, ''));
      const items = Array.isArray(parsed?.items) ? parsed.items : (Array.isArray(parsed) ? parsed : []);
      recibosIndexCache = items.map(normalizeReciboIndexItem).filter(Boolean);
      return recibosIndexCache;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('⚠️ No se pudo leer el índice de recibos, se reconstruirá desde disco:', error.message);
      }

      const rebuilt = await buildRecibosIndexFromDisk();
      await saveRecibosIndex(rebuilt);
      return recibosIndexCache;
    } finally {
      recibosIndexLoadPromise = null;
    }
  })();

  return recibosIndexLoadPromise;
};

const upsertReciboIndex = async (reciboData) => {
  const items = await loadRecibosIndex();
  const normalized = normalizeReciboIndexItem(reciboData);
  if (!normalized) {
    return items;
  }

  const nextItems = items.filter((item) => normalizeRelativePath(item.relativePath) !== normalized.relativePath);
  nextItems.unshift(normalized);
  return saveRecibosIndex(nextItems);
};

const updateReciboIndexByRelativePath = async (relativePath, updater) => {
  const items = await loadRecibosIndex();
  const targetPath = normalizeRelativePath(relativePath);
  const nextItems = items.map((item) => {
    if (normalizeRelativePath(item.relativePath) !== targetPath) {
      return item;
    }

    return normalizeReciboIndexItem(updater(item)) || item;
  });

  return saveRecibosIndex(nextItems);
};

const sanitizeForFileName = (value) => {
  const normalized = (value || 'cliente')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

  return normalized || 'cliente';
};

const sanitizeForFolderName = (value) => {
  const cleaned = (value || 'Cliente Sin Nombre')
    .toString()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80);

  return cleaned || 'Cliente Sin Nombre';
};

const sanitizeForFileSegment = (value, fallback = 'SinDato') => {
  const cleaned = (value || fallback)
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return cleaned || fallback;
};

const sanitizeFullFileName = (value) => {
  return value
    .toString()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
};

const getNextReciboNumber = async () => {
  await ensureTrabajosStructure();

  let lastNumber = 0;
  try {
    const raw = (await fs.promises.readFile(RECIBOS_COUNTER_FILE, 'utf8')).replace(/^\uFEFF/, '');
    try {
      const parsed = JSON.parse(raw);
      if (Number.isInteger(parsed?.lastNumber) && parsed.lastNumber >= 0) {
        lastNumber = parsed.lastNumber;
      }
    } catch (parseError) {
      lastNumber = 0;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const nextNumber = lastNumber + 1;
  await fs.promises.writeFile(
    RECIBOS_COUNTER_FILE,
    JSON.stringify({
      lastNumber: nextNumber,
      updatedAt: new Date().toISOString()
    }, null, 2)
  );

  return nextNumber;
};

const parseDateInput = (value, endOfDay = false) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (endOfDay) {
    parsed.setHours(23, 59, 59, 999);
  } else {
    parsed.setHours(0, 0, 0, 0);
  }

  return parsed;
};

const normalizeRelativePath = (value) => {
  const raw = (value || '').toString();
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch (_) {
    decoded = raw;
  }
  return decoded.replace(/\\/g, '/').trim();
};

const extractReciboNumeroFromName = (fileName) => {
  const match = (fileName || '').toString().match(/Recibo\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
};

const extractTipoPagoFromName = (fileName) => {
  const match = (fileName || '').toString().match(/Tipo\s+de\s+Pago\s*\(([^)]+)\)/i);
  return match ? match[1].trim() : null;
};

const inferTipoTrabajoFromRelativePath = (relativePath) => {
  const normalized = normalizeRelativePath(relativePath);
  const firstSegment = normalized.split('/')[0] || '';
  if (firstSegment.toLowerCase() === PARTICULARES_DIR_NAME.toLowerCase()) {
    return 'particular';
  }
  return 'honorarios';
};

const findLegacyPagoByRecibo = async (relativePath) => {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath) {
    return null;
  }

  const fileName = path.basename(normalizedPath);
  const numeroRecibo = extractReciboNumeroFromName(fileName);
  const tipoPagoFromFile = extractTipoPagoFromName(fileName);
  const tipoTrabajo = inferTipoTrabajoFromRelativePath(normalizedPath);
  const segments = normalizedPath.split('/');
  const clienteFolderName = segments.length > 1 ? segments[1] : '';

  const [pagos, clientes] = await Promise.all([
    excelManager.getAllPagos(),
    excelManager.getClientes()
  ]);

  let clienteId = null;
  if (clienteFolderName) {
    for (const cliente of clientes) {
      const folderName = await resolveClienteFolderName(cliente, cliente.tipoTrabajo);
      const clienteTipo = normalizeTipoTrabajo(cliente.tipoTrabajo);
      if (clienteTipo === tipoTrabajo && folderName.toLowerCase() === clienteFolderName.toLowerCase()) {
        clienteId = cliente.id;
        break;
      }
    }
  }

  let candidates = pagos.filter((p) => (p.estado || 'activo').toString().toLowerCase() !== 'anulado');

  if (clienteId) {
    candidates = candidates.filter((p) => p.clienteId === clienteId);
  }

  if (numeroRecibo !== null) {
    const byNumero = candidates.filter((p) => parseInt(p.reciboNumero, 10) === numeroRecibo);
    if (byNumero.length > 0) {
      candidates = byNumero;
    }
  }

  if (tipoPagoFromFile) {
    const byTipoPago = candidates.filter((p) => (p.tipoPago || '').toString().toLowerCase() === tipoPagoFromFile.toLowerCase());
    if (byTipoPago.length > 0) {
      candidates = byTipoPago;
    }
  }

  const withoutPath = candidates.filter((p) => !normalizeRelativePath(p.reciboRelativePath));
  if (withoutPath.length > 0) {
    candidates = withoutPath;
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  return candidates[0];
};

// Middleware
app.use(cors());
app.use(bodyParser.json());

const runStartupInitialization = async () => {
  await excelManager.initialize();
  await ensureTrabajosStructure();
  await loadRecibosIndex();
  await ensureDailyStartupBackup();
};

// Inicialización en orden: primero data/excel, luego estructura de trabajos y por último backup diario.
runStartupInitialization().catch((error) => {
  console.error('❌ Error en inicialización de arranque:', error.message);
});

// ==================== RUTAS DE CLIENTES ====================

// Obtener todos los clientes
app.get('/api/clientes', async (req, res) => {
  try {
    const clientes = await excelManager.getClientes();
    res.json(clientes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener un cliente específico
app.get('/api/clientes/:id', async (req, res) => {
  try {
    const cliente = await excelManager.getCliente(req.params.id);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear nuevo cliente
app.post('/api/clientes', async (req, res) => {
  try {
    const { nombre, telefono, honorario, tipoTrabajo, interesMensualActivo, interesMensualPorcentaje, dniCuit } = req.body;
    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }
    if (dniCuit === undefined || dniCuit === null || dniCuit.toString().trim() === '') {
      return res.status(400).json({ error: 'El DNI/CUIT es requerido' });
    }
    if (honorario === undefined || honorario === '') {
      return res.status(400).json({ error: 'El honorario es requerido' });
    }

    const honorarioFloat = parseFloat(honorario);
    if (!Number.isFinite(honorarioFloat) || honorarioFloat < 0) {
      return res.status(400).json({ error: 'Honorario debe ser un número mayor o igual a 0' });
    }
    const honorarioFinal = Math.round(honorarioFloat * 100) / 100;

    const tipoTrabajoFinal = normalizeTipoTrabajo(tipoTrabajo);
    const dniCuitFinal = (dniCuit || '').toString().trim().slice(0, 40);
    const interesActivoFinal = tipoTrabajoFinal === 'honorarios' ? (interesMensualActivo === true || interesMensualActivo === 'true' || interesMensualActivo === 1 || interesMensualActivo === '1') : false;
    let interesPorcentajeFinal = Number(interesMensualPorcentaje);
    if (!Number.isFinite(interesPorcentajeFinal) || interesPorcentajeFinal < 0) {
      interesPorcentajeFinal = 0;
    }
    if (!interesActivoFinal) {
      interesPorcentajeFinal = 0;
    }

    const cliente = await excelManager.addCliente({
      id: uuidv4(),
      nombre,
      telefono: telefono || '',
      honorario: honorarioFinal,
      tipoTrabajo: tipoTrabajoFinal,
      dniCuit: dniCuitFinal,
      interesMensualActivo: interesActivoFinal,
      interesMensualPorcentaje: interesPorcentajeFinal
    });
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar cliente
app.put('/api/clientes/:id', async (req, res) => {
  try {
    // Validar honorario si se está actualizando
    if (req.body.honorario !== undefined) {
      const honorarioFloat = parseFloat(req.body.honorario);
      if (!Number.isFinite(honorarioFloat) || honorarioFloat < 0) {
        return res.status(400).json({ error: 'Honorario debe ser un número mayor o igual a 0' });
      }
      req.body.honorario = Math.round(honorarioFloat * 100) / 100;
    }

    if (req.body.tipoTrabajo !== undefined) {
      req.body.tipoTrabajo = normalizeTipoTrabajo(req.body.tipoTrabajo);
    }

    if (req.body.interesMensualActivo !== undefined) {
      req.body.interesMensualActivo = (req.body.interesMensualActivo === true || req.body.interesMensualActivo === 'true' || req.body.interesMensualActivo === 1 || req.body.interesMensualActivo === '1');
    }

    if (req.body.interesMensualPorcentaje !== undefined) {
      const interesPorcentaje = Number(req.body.interesMensualPorcentaje);
      if (!Number.isFinite(interesPorcentaje) || interesPorcentaje < 0) {
        return res.status(400).json({ error: 'Interés mensual debe ser un número mayor o igual a 0' });
      }
      req.body.interesMensualPorcentaje = interesPorcentaje;
    }

    if (req.body.tipoTrabajo === 'particular') {
      req.body.interesMensualActivo = false;
      req.body.interesMensualPorcentaje = 0;
    }

    if (req.body.dniCuit !== undefined) {
      req.body.dniCuit = (req.body.dniCuit || '').toString().trim().slice(0, 40);
    }

    const cliente = await excelManager.updateCliente(req.params.id, req.body);
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar cliente
app.delete('/api/clientes/:id', async (req, res) => {
  try {
    const result = await excelManager.deleteCliente(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== RUTAS DE HONORARIOS ====================

// Obtener configuración de honorarios
app.get('/api/honorarios-config', async (req, res) => {
  try {
    const config = await excelManager.getHonorarioConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar honorarios de un cliente
app.put('/api/clientes/:id/honorario', async (req, res) => {
  try {
    const { honorario } = req.body;
    const honorarioFloat = parseFloat(honorario);
    if (!Number.isFinite(honorarioFloat) || honorarioFloat < 0) {
      return res.status(400).json({ error: 'Honorario debe ser un número mayor o igual a 0' });
    }
    const cliente = await excelManager.updateClienteHonorario(req.params.id, Math.round(honorarioFloat * 100) / 100);
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Programar honorario para un mes específico (MM-YYYY)
app.put('/api/clientes/:id/honorario-programado', async (req, res) => {
  try {
    const { honorario, periodoMes } = req.body;
    const honorarioFloat = parseFloat(honorario);
    if (!Number.isFinite(honorarioFloat) || honorarioFloat < 0) {
      return res.status(400).json({ error: 'Honorario debe ser un número mayor o igual a 0' });
    }

    const periodo = (periodoMes || '').toString().trim();
    if (!/^\d{2}-\d{4}$/.test(periodo)) {
      return res.status(400).json({ error: 'periodoMes debe tener formato MM-YYYY' });
    }

    const cliente = await excelManager.updateClienteHonorarioProgramado(req.params.id, periodo, Math.round(honorarioFloat * 100) / 100);
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Registrar deuda anterior para un período específico (MM-YYYY)
app.put('/api/clientes/:id/deuda-anterior', async (req, res) => {
  try {
    const { deuda, periodoMes } = req.body;
    const deudaFloat = parseFloat(deuda);
    if (!Number.isFinite(deudaFloat) || deudaFloat < 0) {
      return res.status(400).json({ error: 'Deuda debe ser un número mayor o igual a 0' });
    }

    const periodo = (periodoMes || '').toString().trim();
    if (!/^\d{2}-\d{4}$/.test(periodo)) {
      return res.status(400).json({ error: 'periodoMes debe tener formato MM-YYYY' });
    }

    const cliente = await excelManager.addClienteDeudaAnterior(req.params.id, periodo, deudaFloat);
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== RUTAS DE PAGOS ====================

// Registrar pago
app.post('/api/pagos', async (req, res) => {
  try {
    const { clienteId, monto, fecha, tipoPago, detalles, numeroCheque, nombreBanco } = req.body;
    
    if (!clienteId || !monto) {
      return res.status(400).json({ error: 'ClienteId y monto son requeridos' });
    }

    const montoNormalizado = normalizeMonto(monto);
    if (!Number.isFinite(montoNormalizado) || montoNormalizado <= 0) {
      return res.status(400).json({ error: 'Monto inválido' });
    }

    const tipoPagoFinal = (tipoPago || 'Efectivo').toString();
    const numeroChequeFinal = (numeroCheque || '').toString().trim();
    const nombreBancoFinal = (nombreBanco || '').toString().trim();

    const esPagoConCheque = tipoPagoFinal.toLowerCase().includes('cheque');
    if (esPagoConCheque) {
      const chequesArray = numeroChequeFinal
        .split(/[,;]+/)
        .map((c) => c.trim())
        .filter(Boolean);
      const bancosArray = nombreBancoFinal
        .split(/[,;]+/)
        .map((b) => b.trim())
        .filter(Boolean);

      if (
        chequesArray.length === 0 ||
        bancosArray.length === 0 ||
        chequesArray.length !== bancosArray.length
      ) {
        return res.status(400).json({
          error: 'Para pago con cheque debe informar la misma cantidad de números de cheque y bancos',
        });
      }
    }

    console.log(`💳 Registrando pago: Cliente=${clienteId}, Monto=$${monto}`);

    // El alta del pago y el recálculo van juntos: si el proceso muere entre
    // medio, no puede quedar un pago guardado con la deuda sin actualizar.
    const pago = await excelManager.registrarPagoYRecalcular({
      id: uuidv4(),
      clienteId,
      monto: montoNormalizado,
      tipoPago: tipoPagoFinal,
      detalles: (detalles || '').toString().slice(0, 1000),
      numeroCheque: numeroChequeFinal,
      nombreBanco: nombreBancoFinal,
      estado: 'activo',
      fecha: fecha || new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString()
    });

    console.log(`✅ Pago registrado y deuda del cliente ${clienteId} recalculada`);

    // Retornar el cliente actualizado con la deuda recalculada
    const clienteActualizado = await excelManager.getCliente(clienteId);
    res.json({
      pago,
      cliente: clienteActualizado
    });
  } catch (error) {
    console.error('❌ Error registrando pago:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Obtener pagos de un cliente
app.get('/api/pagos/cliente/:clienteId', async (req, res) => {
  try {
    const pagos = await excelManager.getPagosCliente(req.params.clienteId);
    res.json(pagos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener todos los pagos
app.get('/api/pagos', async (req, res) => {
  try {
    const pagos = await excelManager.getAllPagos();
    res.json(pagos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== RUTAS DE HISTORIAL ====================

// Obtener historial de un cliente
app.get('/api/historial/cliente/:clienteId', async (req, res) => {
  try {
    const historial = await excelManager.getHistorialCliente(req.params.clienteId);
    res.json(historial);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener historial completo
app.get('/api/historial', async (req, res) => {
  try {
    const historial = await excelManager.getAllHistorial();
    res.json(historial);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Agregar entrada al historial
app.post('/api/historial', async (req, res) => {
  try {
    const { clienteId, nombreCliente, comisión } = req.body;
    if (!clienteId || !nombreCliente || !comisión) {
      return res.status(400).json({ error: 'clienteId, nombreCliente y comisión son requeridos' });
    }
    const result = await excelManager.addHistorialEntry(clienteId, nombreCliente, comisión);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== RUTAS DE RESUMEN ====================

// Obtener resumen de pagos (pagos pendientes, pagados, etc.)
app.get('/api/resumen', async (req, res) => {
  try {
    const resumen = await excelManager.getResumen();
    res.json(resumen);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== RUTAS DE PDF ====================

// Generar recibo PDF
app.post('/api/generar-recibo', async (req, res) => {
  try {
    const { clienteId, pagoId, monto, pagosAnteriores, tipoPago, detalles, pago, numeroCheque, nombreBanco } = req.body;

    const montoFinal = normalizeMonto(monto);
    if (!Number.isFinite(montoFinal) || montoFinal <= 0) {
      return res.status(400).json({ error: 'Monto inválido' });
    }
    
    const cliente = await excelManager.getCliente(clienteId);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const pagoById = pagoId ? await excelManager.getPagoById(pagoId) : null;
    const pagosCliente = await excelManager.getPagosCliente(clienteId);
    const ultimoPago = pagosCliente.length > 0
      ? pagosCliente
          .slice()
          .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))[0]
      : null;

    const tipoPagoFinal = pagoById?.tipoPago || pago?.tipoPago || tipoPago || ultimoPago?.tipoPago || 'Efectivo';
    const detallesFinal = (pagoById?.detalles ?? pago?.detalles ?? detalles ?? ultimoPago?.detalles ?? '').toString().slice(0, 1000);
    const numeroChequeFinal = (pagoById?.numeroCheque ?? pago?.numeroCheque ?? numeroCheque ?? ultimoPago?.numeroCheque ?? '').toString().trim().slice(0, 80);
    const nombreBancoFinal = (pagoById?.nombreBanco ?? pago?.nombreBanco ?? nombreBanco ?? ultimoPago?.nombreBanco ?? '').toString().trim().slice(0, 120);
    const fechaRecibo = new Date();

    const numeroRecibo = await getNextReciboNumber();

    const pdfBuffer = await pdfGenerator.generarRecibo({
      cliente,
      monto: montoFinal,
      pagosAnteriores: pagosAnteriores || [],
      tipoPago: tipoPagoFinal,
      detalles: detallesFinal,
      numeroCheque: numeroChequeFinal,
      nombreBanco: nombreBancoFinal,
      fecha: fechaRecibo,
      numeroRecibo
    });

    await ensureTrabajosStructure();

    const tipoTrabajoCliente = normalizeTipoTrabajo(cliente.tipoTrabajo);
    const trabajoBaseFolder = getTrabajoFolderByTipo(tipoTrabajoCliente);
    const clienteFolderName = await resolveClienteFolderName(cliente, tipoTrabajoCliente);
    const clienteFolderPath = path.join(trabajoBaseFolder, clienteFolderName);
    const clienteNombreFile = sanitizeForFileSegment(cliente.nombre, 'Cliente');
    const tipoPagoFile = sanitizeForFileSegment(tipoPagoFinal, 'Efectivo');
    const rawFileName = `Recibo ${numeroRecibo} ${clienteNombreFile} ‖‖ Tipo de Pago (${tipoPagoFile}).pdf`;
    const fileName = sanitizeFullFileName(rawFileName);
    const filePath = path.join(clienteFolderPath, fileName);
    const relativePath = path.relative(TRABAJOS_ROOT_DIR, filePath);

    await fs.promises.mkdir(clienteFolderPath, { recursive: true });
    await fs.promises.writeFile(filePath, pdfBuffer);

    const reciboData = {
      numeroRecibo,
      fileName,
      tipoTrabajo: tipoTrabajoCliente,
      clienteFolderName,
      relativePath,
      downloadUrl: `/api/recibos/descargar?path=${encodeURIComponent(relativePath)}`,
      serverPath: filePath,
      generatedAt: fechaRecibo.toISOString(),
      size: pdfBuffer.length,
      clienteId,
      pagoId: pagoById?.id || pagoId || null,
      tipoPago: tipoPagoFinal,
      numeroCheque: numeroChequeFinal,
      nombreBanco: nombreBancoFinal,
      anulado: false,
      anuladoAt: '',
      anuladoMotivo: ''
    };

    if (pagoById?.id || pagoId) {
      await excelManager.updatePagoReciboMeta(pagoById?.id || pagoId, reciboData);
    }

    await upsertReciboIndex(reciboData);

    res.json({
      ok: true,
      recibo: reciboData
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Listar y buscar recibos guardados
app.get('/api/recibos', async (req, res) => {
  try {
    const { clienteId, cliente, desde, hasta, limit, tipoTrabajo, tipoPago, numeroCheque, nombreBanco } = req.query;
    const tipoPagoFiltro = (tipoPago || '').toString().trim().toLowerCase();
    const numeroChequeFiltro = (numeroCheque || '').toString().trim().toLowerCase();
    const nombreBancoFiltro = (nombreBanco || '').toString().trim().toLowerCase();

    const fromDate = parseDateInput(desde);
    const toDate = parseDateInput(hasta, true);
    if ((desde && !fromDate) || (hasta && !toDate)) {
      return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD.' });
    }

    const targetTipoTrabajo = tipoTrabajo ? normalizeTipoTrabajo(tipoTrabajo) : null;
    let recibos = await loadRecibosIndex();

    if (clienteId) {
      recibos = recibos.filter((item) => (item.clienteId || '').toString() === clienteId.toString());
    }

    if (targetTipoTrabajo) {
      recibos = recibos.filter((item) => normalizeTipoTrabajo(item.tipoTrabajo) === targetTipoTrabajo);
    }

    if (cliente) {
      const clienteFiltro = cliente.toString().toLowerCase();
      recibos = recibos.filter((item) => (item.clienteFolderName || '').toString().toLowerCase().includes(clienteFiltro));
    }

    if (fromDate) {
      recibos = recibos.filter((item) => new Date(item.createdAt) >= fromDate);
    }

    if (toDate) {
      recibos = recibos.filter((item) => new Date(item.createdAt) <= toDate);
    }

    if (tipoPagoFiltro) {
      recibos = recibos.filter((item) => {
        const tipoPagoRecibo = (item.tipoPago || '').toString().trim().toLowerCase();
        if (tipoPagoFiltro === 'cheque') {
          return tipoPagoRecibo.includes('cheque');
        }
        return tipoPagoRecibo === tipoPagoFiltro;
      });
    }

    if (numeroChequeFiltro) {
      recibos = recibos.filter((item) => {
        const cheques = (item.numeroCheque || '').toLowerCase().split(/[, ]+/).map((c) => c.trim());
        return cheques.some((c) => c.includes(numeroChequeFiltro));
      });
    }

    if (nombreBancoFiltro) {
      recibos = recibos.filter((item) => (item.nombreBanco || '').toString().toLowerCase().includes(nombreBancoFiltro));
    }

    recibos = recibos.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const maxItems = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    res.json({
      total: recibos.length,
      items: recibos.slice(0, maxItems)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Descargar recibo PDF ya guardado en servidor
app.get('/api/recibos/descargar', async (req, res) => {
  try {
    const relativePath = normalizeRelativePath(req.query.path);
    if (!relativePath) {
      return res.status(400).json({ error: 'path es requerido' });
    }

    await ensureTrabajosStructure();
    const resolvedPath = path.resolve(TRABAJOS_ROOT_DIR, relativePath);

    if (!resolvedPath.startsWith(path.resolve(TRABAJOS_ROOT_DIR))) {
      return res.status(400).json({ error: 'Ruta inválida' });
    }

    const safeFileName = path.basename(resolvedPath);

    if (path.extname(safeFileName).toLowerCase() !== '.pdf') {
      return res.status(400).json({ error: 'Archivo inválido' });
    }

    await fs.promises.access(resolvedPath, fs.constants.F_OK);
    res.download(resolvedPath, safeFileName);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Recibo no encontrado' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Anular recibo y el pago asociado
app.post('/api/recibos/anular', async (req, res) => {
  try {
    const relativePath = normalizeRelativePath(req.body?.relativePath);
    const pagoIdBody = (req.body?.pagoId || '').toString().trim();
    const motivo = (req.body?.motivo || 'Anulado por error de carga').toString().trim().slice(0, 250);

    if (!relativePath && !pagoIdBody) {
      return res.status(400).json({ error: 'relativePath o pagoId es requerido' });
    }

    await ensureTrabajosStructure();
    const resolvedPath = relativePath ? path.resolve(TRABAJOS_ROOT_DIR, relativePath) : null;
    if (resolvedPath && !resolvedPath.startsWith(path.resolve(TRABAJOS_ROOT_DIR))) {
      return res.status(400).json({ error: 'Ruta inválida' });
    }

    let pagoAnulado = null;
    if (pagoIdBody) {
      pagoAnulado = await excelManager.anularPago(pagoIdBody, motivo);
    } else {
      try {
        pagoAnulado = await excelManager.anularPagoPorReciboPath(relativePath, motivo);
      } catch (linkError) {
        if (!linkError.message || !linkError.message.includes('No se encontró un pago vinculado a ese recibo')) {
          throw linkError;
        }

        const pagoCandidato = await findLegacyPagoByRecibo(relativePath);
        if (!pagoCandidato?.id) {
          throw linkError;
        }

        await excelManager.updatePagoReciboMeta(pagoCandidato.id, {
          relativePath,
          fileName: path.basename(relativePath),
          numeroRecibo: extractReciboNumeroFromName(path.basename(relativePath))
        });

        pagoAnulado = await excelManager.anularPago(pagoCandidato.id, motivo);
      }
    }

    let newRelativePath = relativePath;
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      const dirName = path.dirname(resolvedPath);
      const baseName = path.basename(resolvedPath);
      const prefixedName = baseName.startsWith('[ANULADO] ') ? baseName : `[ANULADO] ${baseName}`;
      const targetPath = path.join(dirName, sanitizeFullFileName(prefixedName));

      if (resolvedPath !== targetPath && !fs.existsSync(targetPath)) {
        await fs.promises.rename(resolvedPath, targetPath);
        newRelativePath = path.relative(TRABAJOS_ROOT_DIR, targetPath);
      }
    }

    if (newRelativePath !== relativePath && pagoAnulado?.id) {
      await excelManager.updatePagoReciboMeta(pagoAnulado.id, {
        relativePath: newRelativePath,
        fileName: path.basename(newRelativePath),
        numeroRecibo: pagoAnulado.reciboNumero || null
      });
    }

    await updateReciboIndexByRelativePath(relativePath, (item) => ({
      ...item,
      relativePath: newRelativePath,
      fileName: path.basename(newRelativePath),
      downloadUrl: `/api/recibos/descargar?path=${encodeURIComponent(newRelativePath)}`,
      anulado: true,
      anuladoAt: pagoAnulado?.anuladoAt || new Date().toISOString(),
      anuladoMotivo: motivo,
      pagoId: pagoAnulado?.id || item.pagoId || null
    }));

    res.json({
      ok: true,
      pagoId: pagoAnulado?.id || null,
      relativePath: newRelativePath,
      motivo
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Abrir carpeta de cliente en el servidor
app.post('/api/recibos/abrir-carpeta', async (req, res) => {
  try {
    const { clienteFolderName, tipoTrabajo } = req.body;
    if (!clienteFolderName) {
      return res.status(400).json({ error: 'clienteFolderName es requerido' });
    }

    await ensureTrabajosStructure();
    const folderName = sanitizeForFolderName(clienteFolderName);
    const trabajoDir = getTrabajoFolderByTipo(tipoTrabajo);
    const folderPath = path.resolve(trabajoDir, folderName);

    if (!folderPath.startsWith(path.resolve(TRABAJOS_ROOT_DIR))) {
      return res.status(400).json({ error: 'Ruta de carpeta inválida' });
    }

    await fs.promises.access(folderPath, fs.constants.F_OK);

    if (process.platform !== 'win32') {
      return res.status(400).json({ error: 'Abrir carpeta solo está disponible en Windows' });
    }

    exec(`explorer.exe "${folderPath}"`);

    res.json({
      ok: true,
      message: 'Carpeta abierta en la PC servidor',
      folderPath
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Carpeta de cliente no encontrada' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ==================== SINCRONIZACIÓN EN TIEMPO REAL ====================

// Endpoint para polling (verificar cambios)
app.get('/api/sync/:lastSync', async (req, res) => {
  try {
    const lastSync = new Date(req.params.lastSync);
    const data = await excelManager.getChangesAfter(lastSync);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ADMIN ====================

// Reiniciar todos los datos
app.post('/api/admin/reiniciar', async (req, res) => {
  try {
    const result = await excelManager.reiniciarTodosDatos();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear backup ZIP de la carpeta data
app.post('/api/admin/backup-zip', async (req, res) => {
  try {
    const backup = await createDataZipBackup();
    res.json({
      success: true,
      message: 'Backup ZIP creado correctamente',
      backup
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Recalcular deuda de un cliente (para testing)
app.post('/api/admin/recalcular/:clienteId', async (req, res) => {
  try {
    await excelManager.recalculateClienteDeuda(req.params.clienteId);
    const cliente = await excelManager.getCliente(req.params.clienteId);
    res.json({
      success: true,
      cliente: cliente,
      message: 'Deuda recalculada'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ver deuda completa de un cliente
app.get('/api/admin/debug/:clienteId', async (req, res) => {
  try {
    const cliente = await excelManager.getCliente(req.params.clienteId);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    
    const finanzas = await excelManager._calcularFinanzasCliente(cliente);
    const pagos = await excelManager.getPagosCliente(req.params.clienteId);
    
    res.json({
      cliente: cliente,
      finanzas: finanzas,
      pagos: pagos,
      totalPagado: pagos.reduce((sum, p) => sum + (p.monto || 0), 0)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Simular antigüedad del cliente (para testing)
app.post('/api/admin/test/envejecer/:clienteId/:diasAtras', async (req, res) => {
  try {
    const diasAtras = parseInt(req.params.diasAtras);
    await excelManager.envejecerCliente(req.params.clienteId, diasAtras);
    const cliente = await excelManager.getCliente(req.params.clienteId);
    
    res.json({
      success: true,
      cliente: cliente,
      message: `Cliente envejecido ${diasAtras} días`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// ==================== HEALTHCHECK ====================

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let ipLocal = 'localhost';
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ipLocal = iface.address;
        break;
      }
    }
  }
  
  console.log(`Servidor ejecutándose en http://${ipLocal}:${PORT}`);
  console.log(`Desde este dispositivo: http://localhost:${PORT}`);
});

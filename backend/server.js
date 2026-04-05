const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');
const ILovePDFApi = require('ilovepdf-nodejs');
const ILovePDFFile = require('ilovepdf-nodejs/ILovePDFFile');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const uploadDir = '/tmp';

fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors({ origin: '*' }));
app.options('*', cors({ origin: '*' }));
app.use(express.json());

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

function ensureApiKeys() {
  const publicKey = process.env.PUBLIC_KEY;
  const secretKey = process.env.SECRET_KEY;

  if (!publicKey || !secretKey) {
    throw new Error('PUBLIC_KEY and SECRET_KEY are required');
  }

  return new ILovePDFApi(publicKey, secretKey);
}

function getSafeBaseName(inputName) {
  const extension = path.extname(inputName).toLowerCase();
  return path
    .basename(inputName, extension)
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'converted';
}

function resolveOutputExtension(targetFormat, usedTask) {
  if (usedTask === 'officepdf') {
    return 'pdf';
  }

  if (targetFormat === 'zip') {
    return 'zip';
  }

  return targetFormat || 'docx';
}

function createOfficeTask(api) {
  const preferredTask = (process.env.ILOVEPDF_TASK || 'pdfoffice').trim();

  try {
    return { task: api.newTask(preferredTask), taskName: preferredTask };
  } catch (error) {
    console.warn(`ILovePDF task \"${preferredTask}\" is not available, falling back to \"officepdf\".`);
    return { task: api.newTask('officepdf'), taskName: 'officepdf' };
  }
}

app.get('/', (req, res) => {
  res.send('Backend running 🚀');
});

app.get('/api/tools', (req, res) => {
  res.json({
    status: 'success',
    tools: [
      {
        id: 'convert',
        name: 'Office to PDF',
        description: 'Convert Office documents into PDF files',
        icon: '📄',
        available: true
      }
    ]
  });
});

async function handleConvertRequest(req, res) {
  const uploadedPath = req.file?.path || null;
  let outputPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(req.file);

    const extension = path.extname(req.file.originalname).toLowerCase();
    const targetFormat = String(req.body?.target_format || 'docx').toLowerCase();
    const allowedInputExtensions = ['.pdf', '.doc', '.docx', '.odt', '.ppt', '.pptx', '.odp', '.xls', '.xlsx', '.ods'];

    if (!allowedInputExtensions.includes(extension)) {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    const api = ensureApiKeys();
    const { task, taskName } = createOfficeTask(api);

    await task.start();

    await task.addFile(new ILovePDFFile(req.file.path));
    await task.process();

    const convertedData = await task.download();
    const outputExtension = resolveOutputExtension(targetFormat, taskName);
    const outputName = `${getSafeBaseName(req.file.originalname)}.${outputExtension}`;
    outputPath = path.join(uploadDir, `${Date.now()}-${outputName}`);

    await fsPromises.writeFile(outputPath, Buffer.from(convertedData));

    return res.download(outputPath, outputName, async (downloadError) => {
      if (downloadError) {
        console.error('Download failed:', downloadError);
      }

      await Promise.all([
        uploadedPath ? fsPromises.unlink(uploadedPath).catch(() => {}) : Promise.resolve(),
        outputPath ? fsPromises.unlink(outputPath).catch(() => {}) : Promise.resolve()
      ]);
    });
  } catch (error) {
    console.error('Conversion failed:', error);
    await Promise.all([
      uploadedPath ? fsPromises.unlink(uploadedPath).catch(() => {}) : Promise.resolve(),
      outputPath ? fsPromises.unlink(outputPath).catch(() => {}) : Promise.resolve()
    ]);
    return res.status(500).json({
      error: 'Conversion failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

app.post('/convert', upload.single('file'), handleConvertRequest);
app.post('/api/convert', upload.single('file'), handleConvertRequest);

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large' });
  }

  console.error('Unhandled error:', error);
  return res.status(500).json({ error: 'Unexpected server error' });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
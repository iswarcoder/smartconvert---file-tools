const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');
const ILovePDFApi = require('@ilovepdf/ilovepdf-nodejs');
const ILovePDFFile = require('@ilovepdf/ilovepdf-nodejs/ILovePDFFile');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 10000);
const uploadDir = path.join(__dirname, 'uploads');

fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, uploadDir);
  },
  filename: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const basename = path
      .basename(file.originalname, extension)
      .replace(/[^a-z0-9_-]+/gi, '_')
      .replace(/^_+|_+$/g, '') || 'upload';

    callback(null, `${Date.now()}-${basename}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

function ensureApiKeys() {
  const publicKey = process.env.ILOVEPDF_PUBLIC_KEY;
  const secretKey = process.env.ILOVEPDF_SECRET_KEY;

  if (!publicKey || !secretKey) {
    throw new Error('ILOVEPDF_PUBLIC_KEY and ILOVEPDF_SECRET_KEY are required');
  }

  return new ILovePDFApi(publicKey, secretKey);
}

function getOutputName(inputName) {
  const extension = path.extname(inputName).toLowerCase();
  const basename = path.basename(inputName, extension);
  return `${basename || 'converted'}.pdf`;
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

app.post('/api/convert', upload.single('file'), async (req, res) => {
  let uploadedPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const extension = path.extname(req.file.originalname).toLowerCase();
    if (!['.doc', '.docx', '.odt', '.ppt', '.pptx', '.odp', '.xls', '.xlsx', '.ods'].includes(extension)) {
      return res.status(400).json({ error: 'Only Office documents are supported' });
    }

    uploadedPath = req.file.path;

    const api = ensureApiKeys();
    const task = api.newTask('officepdf');

    await task.start();

    const officeFile = new ILovePDFFile(uploadedPath);
    await task.addFile(officeFile);
    await task.process();

    const convertedData = await task.download();
    const outputName = getOutputName(req.file.originalname);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    return res.send(Buffer.from(convertedData));
  } catch (error) {
    console.error('Conversion failed:', error);
    return res.status(500).json({
      error: 'Conversion failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    if (uploadedPath) {
      await fsPromises.unlink(uploadedPath).catch(() => {});
    }
  }
});

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
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;
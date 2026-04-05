const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TEMP_DIR = '/tmp';
const API_ROOT = 'https://api.ilovepdf.com/v1';
const upload = multer({
  dest: TEMP_DIR,
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

fs.mkdirSync(TEMP_DIR, { recursive: true });

app.use(cors());
app.use(express.json());

let cachedToken = '';
let cachedTokenExpiresAt = 0;

function requireApiKeys() {
  const publicKey = process.env.PUBLIC_KEY;
  const secretKey = process.env.SECRET_KEY;

  if (!publicKey || !secretKey) {
    throw new Error('Missing PUBLIC_KEY or SECRET_KEY. Add both in Render environment variables or backend/.env for local testing.');
  }

  return { publicKey, secretKey };
}

function sanitizeFileName(inputName) {
  return String(inputName || 'converted')
    .replace(/[^a-z0-9._-]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'converted';
}

function baseName(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return sanitizeFileName(path.basename(fileName, extension));
}

function outputExtensionFromProcess(processResponse, fallbackExtension) {
  const outputExtensions = processResponse?.output_extensions;

  if (Array.isArray(outputExtensions) && outputExtensions.length > 0) {
    return String(outputExtensions[0]).replace(/^\./, '') || fallbackExtension;
  }

  if (typeof outputExtensions === 'string' && outputExtensions.length > 0) {
    try {
      const parsed = JSON.parse(outputExtensions);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return String(parsed[0]).replace(/^\./, '') || fallbackExtension;
      }
    } catch (error) {
      return outputExtensions.replace(/^\./, '') || fallbackExtension;
    }
  }

  const downloadName = processResponse?.download_filename || '';
  const downloadExt = path.extname(downloadName).replace(/^\./, '');
  return downloadExt || fallbackExtension;
}

async function cleanupFiles(filePaths) {
  await Promise.all(
    filePaths
      .filter(Boolean)
      .map((filePath) => fsPromises.unlink(filePath).catch(() => {}))
  );
}

async function getAuthToken() {
  requireApiKeys();

  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const response = await fetch(`${API_ROOT}/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ public_key: process.env.PUBLIC_KEY })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || 'Failed to authenticate with iLovePDF');
  }

  if (!data.token) {
    throw new Error('iLovePDF auth token missing');
  }

  cachedToken = data.token;
  cachedTokenExpiresAt = Date.now() + (1000 * 60 * 110);
  return cachedToken;
}

async function apiFetch(url, options = {}) {
  const token = await getAuthToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  return fetch(url, {
    ...options,
    headers
  });
}

async function startTask(tool) {
  const response = await apiFetch(`${API_ROOT}/start/${tool}`, {
    method: 'GET'
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || `Failed to start ${tool}`);
  }

  if (!data.server || !data.task) {
    throw new Error('Invalid iLovePDF start response');
  }

  return data;
}

async function uploadFile(server, task, file) {
  const formData = new FormData();
  formData.append('task', task);

  const buffer = await fsPromises.readFile(file.path);
  const fileBlob = new Blob([buffer]);
  formData.append('file', fileBlob, file.originalname);

  const response = await apiFetch(`https://${server}/v1/upload`, {
    method: 'POST',
    body: formData
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || 'File upload failed');
  }

  if (!data.server_filename) {
    throw new Error('Upload response missing server_filename');
  }

  return {
    server_filename: data.server_filename,
    filename: data.filename || file.originalname
  };
}

async function processTask(server, task, tool, files, extraParams = {}) {
  const response = await apiFetch(`https://${server}/v1/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      task,
      tool,
      files,
      ...extraParams
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detailMessage = Array.isArray(data?.files)
      ? JSON.stringify(data.files)
      : '';
    throw new Error(data.message || data.error || detailMessage || 'Processing failed');
  }

  return data;
}

async function downloadTask(server, task) {
  const response = await apiFetch(`https://${server}/v1/download/${task}`, {
    method: 'GET'
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || 'Download failed');
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function executeToolWorkflow({ tool, files, extraParams = {} }) {
  const { server, task } = await startTask(tool);
  const uploadedFiles = [];

  for (const file of files) {
    uploadedFiles.push(await uploadFile(server, task, file));
  }

  const processResponse = await processTask(server, task, tool, uploadedFiles, extraParams);
  const buffer = await downloadTask(server, task);

  return {
    buffer,
    processResponse
  };
}

async function writeAndDownloadResponse(res, buffer, downloadName, cleanupPaths) {
  const safeDownloadName = sanitizeFileName(downloadName);
  const tempPath = path.join(TEMP_DIR, `${Date.now()}-${safeDownloadName}`);

  await fsPromises.writeFile(tempPath, buffer);

  return res.download(tempPath, safeDownloadName, async (downloadError) => {
    if (downloadError) {
      console.error('Download failed:', downloadError);
    }

    await cleanupFiles([tempPath, ...cleanupPaths]);
  });
}

function handleSingleFileRoute({ tool, allowedExtensions, extraParams }) {
  return async (req, res) => {
    const uploadedPath = req.file?.path || null;

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const extension = path.extname(req.file.originalname).toLowerCase();
      if (allowedExtensions && !allowedExtensions.includes(extension)) {
        return res.status(400).json({ error: 'Unsupported file type' });
      }

      const targetFormat = String(req.body?.target_format || '').toLowerCase();

      if (extension === '.pdf') {
        return res.status(400).json({
          error: 'Unsupported file type',
          message: 'PDF input is not supported. Upload DOCX, ODT, PPTX, or XLSX to convert to PDF.'
        });
      }

      if (targetFormat && targetFormat !== 'pdf') {
        return res.status(400).json({
          error: 'Unsupported file type',
          message: 'Office files can only be converted to PDF'
        });
      }

      const { buffer, processResponse } = await executeToolWorkflow({
        tool,
        files: [req.file],
        extraParams: typeof extraParams === 'function' ? extraParams(req) : (extraParams || {})
      });

      const fallbackExtension = tool === 'imagepdf' ? 'pdf' : extension.replace(/^\./, '') || 'pdf';
      const downloadName = processResponse?.download_filename
        ? sanitizeFileName(processResponse.download_filename)
        : `${baseName(req.file.originalname)}.${outputExtensionFromProcess(processResponse, fallbackExtension)}`;

      return writeAndDownloadResponse(res, buffer, downloadName, [uploadedPath]);
    } catch (error) {
      console.error(`${tool} failed:`, error);
      await cleanupFiles([uploadedPath]);
      return res.status(500).json({
        error: `${tool} failed`,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

function handleMergeRoute() {
  return async (req, res) => {
    const uploadedPaths = Array.isArray(req.files) ? req.files.map((file) => file.path) : [];

    try {
      if (!Array.isArray(req.files) || req.files.length < 2) {
        return res.status(400).json({ error: 'At least two files are required' });
      }

      console.log(req.files);

      const invalidFile = req.files.find((file) => path.extname(file.originalname).toLowerCase() !== '.pdf');
      if (invalidFile) {
        return res.status(400).json({ error: 'Only PDF files are supported' });
      }

      const { buffer, processResponse } = await executeToolWorkflow({
        tool: 'merge',
        files: req.files
      });

      const downloadName = processResponse?.download_filename
        ? sanitizeFileName(processResponse.download_filename)
        : `merged.${outputExtensionFromProcess(processResponse, 'pdf')}`;

      return writeAndDownloadResponse(res, buffer, downloadName, uploadedPaths);
    } catch (error) {
      console.error('merge failed:', error);
      await cleanupFiles(uploadedPaths);
      return res.status(500).json({
        error: 'merge failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

function handleEditRoute() {
  return async (req, res) => {
    const uploadedPath = req.file?.path || null;

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      console.log(req.file);

      await cleanupFiles([uploadedPath]);
      return res.json({
        status: 'success',
        message: 'Edit PDF is a placeholder route for now',
        filename: req.file.originalname
      });
    } catch (error) {
      console.error('edit failed:', error);
      await cleanupFiles([uploadedPath]);
      return res.status(500).json({
        error: 'edit failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

app.get('/', (req, res) => {
  res.send('Backend running 🚀');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    configured: Boolean(process.env.PUBLIC_KEY && process.env.SECRET_KEY)
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    configured: Boolean(process.env.PUBLIC_KEY && process.env.SECRET_KEY)
  });
});

app.get('/api/tools', (req, res) => {
  res.json({
    status: 'success',
    tools: [
      {
        id: 'convert',
        name: 'Convert File',
        description: 'Convert office documents to PDF',
        icon: '📄',
        available: true,
        endpoint: '/convert'
      },
      {
        id: 'merge-pdf',
        name: 'Merge PDF',
        description: 'Combine multiple PDF files into one document',
        icon: '📎',
        available: true,
        endpoint: '/merge'
      },
      {
        id: 'split-pdf',
        name: 'Split PDF',
        description: 'Split a PDF into selected pages or ranges',
        icon: '✂️',
        available: true,
        endpoint: '/split'
      },
      {
        id: 'compress-pdf',
        name: 'Compress PDF',
        description: 'Reduce PDF file size',
        icon: '📦',
        available: true,
        endpoint: '/compress'
      },
      {
        id: 'image-convert',
        name: 'Image to PDF',
        description: 'Convert images into PDF documents',
        icon: '🖼️',
        available: true,
        endpoint: '/image-to-pdf'
      },
      {
        id: 'edit-pdf',
        name: 'Edit PDF',
        description: 'Basic placeholder for future PDF editing',
        icon: '✏️',
        available: true,
        endpoint: '/edit'
      }
    ]
  });
});

const convertHandler = handleSingleFileRoute({
  tool: 'officepdf',
  allowedExtensions: ['.docx', '.odt', '.pptx', '.xlsx']
});

const splitHandler = handleSingleFileRoute({
  tool: 'split',
  allowedExtensions: ['.pdf'],
  extraParams: (req) => ({
    split_mode: 'ranges',
    ranges: req.body?.pages || req.body?.ranges || '1'
  })
});

const compressHandler = handleSingleFileRoute({
  tool: 'compress',
  allowedExtensions: ['.pdf'],
  extraParams: () => ({
    compression_level: 'recommended'
  })
});

const imageToPdfHandler = handleSingleFileRoute({
  tool: 'imagepdf',
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'],
  extraParams: () => ({
    merge_after: true
  })
});

app.post('/convert', upload.single('file'), convertHandler);
app.post('/api/convert', upload.single('file'), convertHandler);

app.post('/merge', upload.array('file', 20), handleMergeRoute());
app.post('/api/merge', upload.array('file', 20), handleMergeRoute());

app.post('/split', upload.single('file'), splitHandler);
app.post('/api/split', upload.single('file'), splitHandler);

app.post('/compress', upload.single('file'), compressHandler);
app.post('/api/compress', upload.single('file'), compressHandler);

app.post('/image-to-pdf', upload.single('file'), imageToPdfHandler);
app.post('/api/image-to-pdf', upload.single('file'), imageToPdfHandler);

app.post('/edit', upload.single('file'), handleEditRoute());
app.post('/api/edit', upload.single('file'), handleEditRoute());

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
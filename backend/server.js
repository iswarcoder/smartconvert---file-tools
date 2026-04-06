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
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const API_ROOT = 'https://api.ilovepdf.com/v1';
const CLOUDCONVERT_API_ROOT = 'https://api.cloudconvert.com/v2';
const CLOUDCONVERT_SYNC_API_ROOT = 'https://sync.api.cloudconvert.com/v2';
const upload = multer({
  dest: TEMP_DIR,
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(cors({
  exposedHeaders: ['Content-Disposition', 'X-Download-Filename']
}));
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

function requireCloudConvertToken() {
  const cloudConvertToken = process.env.CLOUDCONVERT_KEY || process.env.CLOUDCONVERT_TOKEN;

  if (!cloudConvertToken) {
    throw new Error('Missing CLOUDCONVERT_KEY. Add it in Render environment variables or backend/.env for local testing.');
  }

  return cloudConvertToken;
}

async function cloudConvertFetch(url, options = {}) {
  const token = requireCloudConvertToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  return fetch(url, {
    ...options,
    headers
  });
}

function cloudConvertErrorMessage(data, fallbackMessage) {
  const detailMessages = Array.isArray(data?.errors)
    ? data.errors.map((item) => item?.message).filter(Boolean)
    : [];

  const taskMessages = Array.isArray(data?.tasks)
    ? data.tasks.map((task) => task?.message).filter(Boolean)
    : [];

  const rawMessage = data?.message || data?.error || detailMessages.join('; ') || taskMessages.join('; ') || fallbackMessage;

  if (/invalid scope/i.test(rawMessage)) {
    return 'CloudConvert API key scope is invalid. Create a CloudConvert API key with task.read and task.write scopes, then update CLOUDCONVERT_KEY in Render.';
  }

  return rawMessage;
}

async function uploadCloudConvertFile(uploadForm, file) {
  if (!uploadForm?.url) {
    throw new Error('CloudConvert upload form is missing');
  }

  const buffer = await fsPromises.readFile(file.path);
  const formData = new FormData();

  Object.entries(uploadForm.parameters || {}).forEach(([key, value]) => {
    formData.append(key, value);
  });

  formData.append('file', new Blob([buffer]), file.originalname);

  const response = await fetch(uploadForm.url, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || 'CloudConvert upload failed');
  }
}

async function executePdfToOfficeWorkflow(file, outputFormat) {
  const createResponse = await cloudConvertFetch(`${CLOUDCONVERT_API_ROOT}/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tasks: {
        'import-my-file': {
          operation: 'import/upload'
        },
        'convert-my-file': {
          operation: 'convert',
          input: 'import-my-file',
          input_format: 'pdf',
          output_format: outputFormat
        },
        'export-my-file': {
          operation: 'export/url',
          input: 'convert-my-file'
        }
      }
    })
  });

  const createData = await createResponse.json().catch(() => ({}));

  if (!createResponse.ok) {
    throw new Error(cloudConvertErrorMessage(createData, 'Failed to create CloudConvert job'));
  }

  const job = createData.data || createData;
  const jobId = job?.id;

  if (!jobId) {
    throw new Error('CloudConvert job id missing');
  }

  const importTask = Array.isArray(job.tasks)
    ? job.tasks.find((task) => task.operation === 'import/upload' || task.name === 'import-my-file')
    : null;
  const uploadForm = importTask?.result?.form || importTask?.payload?.form || null;

  await uploadCloudConvertFile(uploadForm, file);

  const waitResponse = await cloudConvertFetch(`${CLOUDCONVERT_SYNC_API_ROOT}/jobs/${jobId}?include=tasks`, {
    method: 'GET'
  });

  const waitData = await waitResponse.json().catch(() => ({}));

  if (!waitResponse.ok) {
    throw new Error(cloudConvertErrorMessage(waitData, 'CloudConvert conversion failed'));
  }

  const finishedJob = waitData.data || waitData;

  if (finishedJob.status === 'error') {
    throw new Error(cloudConvertErrorMessage(finishedJob, 'CloudConvert conversion failed'));
  }

  const exportTask = Array.isArray(finishedJob.tasks)
    ? finishedJob.tasks.find((task) => task.operation === 'export/url' || task.name === 'export-my-file')
    : null;
  const exportFile = exportTask?.result?.files?.[0] || null;

  if (!exportFile?.url) {
    throw new Error(cloudConvertErrorMessage(finishedJob, 'CloudConvert output file missing'));
  }

  const downloadResponse = await fetch(exportFile.url);

  if (!downloadResponse.ok) {
    const text = await downloadResponse.text().catch(() => '');
    throw new Error(text || 'CloudConvert download failed');
  }

  const arrayBuffer = await downloadResponse.arrayBuffer();

  return {
    buffer: Buffer.from(arrayBuffer),
    processResponse: {
      download_filename: exportFile.filename || `converted.${outputFormat}`,
      output_extensions: [outputFormat],
      job_id: jobId
    }
  };
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
  const persistedPath = path.join(OUTPUT_DIR, safeDownloadName);

  await fsPromises.writeFile(tempPath, buffer);
  await fsPromises.writeFile(persistedPath, buffer);

  res.setHeader('X-Download-Filename', safeDownloadName);

  return res.download(tempPath, safeDownloadName, async (downloadError) => {
    if (downloadError) {
      console.error('Download failed:', downloadError);
    }

    await cleanupFiles([tempPath, ...cleanupPaths]);
  });
}

function handleSingleFileRoute({ tool, allowedExtensions, extraParams, allowPdfInput = false }) {
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

      if (extension === '.pdf' && !allowPdfInput) {
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
    const pdfFile = Array.isArray(req.files?.file) ? req.files.file[0] : null;
    const imageFile = Array.isArray(req.files?.image) ? req.files.image[0] : null;
    const cleanupPaths = [pdfFile?.path, imageFile?.path].filter(Boolean);

    try {
      if (!pdfFile) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const downloadName = `${baseName(pdfFile.originalname)}-edited.pdf`;
      const outputPath = path.join(OUTPUT_DIR, sanitizeFileName(downloadName));

      await fsPromises.copyFile(pdfFile.path, outputPath);
      await cleanupFiles(cleanupPaths);
      return res.json({
        status: 'success',
        message: imageFile || req.body?.find_text || req.body?.replace_text
          ? 'Edit PDF request received successfully'
          : 'Edit PDF placeholder completed',
        filename: pdfFile.originalname,
        download_filename: sanitizeFileName(downloadName)
      });
    } catch (error) {
      console.error('edit failed:', error);
      await cleanupFiles(cleanupPaths);
      return res.status(500).json({
        error: 'edit failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

function handlePdfToOfficeRoute() {
  return async (req, res) => {
    const uploadedPath = req.file?.path || null;

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      if (path.extname(req.file.originalname).toLowerCase() !== '.pdf') {
        return res.status(400).json({ error: 'Unsupported file type', message: 'Upload a PDF file to convert to Word or PowerPoint.' });
      }

      const targetFormat = String(req.body?.target_format || '').toLowerCase();
      if (!['docx', 'pptx'].includes(targetFormat)) {
        return res.status(400).json({ error: 'Unsupported file type', message: 'Select DOCX or PPTX as the output format.' });
      }

      const { buffer, processResponse } = await executePdfToOfficeWorkflow(req.file, targetFormat);
      const downloadName = processResponse?.download_filename
        ? sanitizeFileName(processResponse.download_filename)
        : `${baseName(req.file.originalname)}.${outputExtensionFromProcess(processResponse, targetFormat)}`;

      return writeAndDownloadResponse(res, buffer, downloadName, [uploadedPath]);
    } catch (error) {
      console.error('pdf-to-office failed:', error);
      await cleanupFiles([uploadedPath]);
      return res.status(500).json({
        error: 'pdf-to-office failed',
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
    configured: Boolean(process.env.PUBLIC_KEY && process.env.SECRET_KEY),
    cloudconvertConfigured: Boolean(process.env.CLOUDCONVERT_KEY || process.env.CLOUDCONVERT_TOKEN)
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    configured: Boolean(process.env.PUBLIC_KEY && process.env.SECRET_KEY),
    cloudconvertConfigured: Boolean(process.env.CLOUDCONVERT_KEY || process.env.CLOUDCONVERT_TOKEN)
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
  allowPdfInput: true,
  extraParams: (req) => ({
    split_mode: 'ranges',
    ranges: req.body?.pages || req.body?.ranges || '1'
  })
});

const compressHandler = handleSingleFileRoute({
  tool: 'compress',
  allowedExtensions: ['.pdf'],
  allowPdfInput: true,
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

app.post('/edit', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]), handleEditRoute());
app.post('/api/edit', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]), handleEditRoute());

app.post('/pdf-to-office', upload.single('file'), handlePdfToOfficeRoute());
app.post('/api/pdf-to-office', upload.single('file'), handlePdfToOfficeRoute());

app.get('/api/download/:filename', async (req, res) => {
  try {
    const safeFilename = sanitizeFileName(req.params.filename);
    const filePath = path.join(OUTPUT_DIR, safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Not Found');
    }

    return res.download(filePath, safeFilename);
  } catch (error) {
    console.error('download failed:', error);
    return res.status(500).json({ error: 'download failed', message: 'Unable to download file' });
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
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
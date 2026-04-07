const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TEMP_DIR = '/tmp';
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const API_ROOT = 'https://api.ilovepdf.com/v1';
const CLOUDCONVERT_API_ROOT = 'https://api.cloudconvert.com/v2';
const CLOUDCONVERT_SYNC_API_ROOT = 'https://sync.api.cloudconvert.com/v2';
const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || '').trim();
const GEMINI_MODEL_FALLBACKS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash-latest', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
const GEMINI_CHUNK_SIZE = 2000;
const GEMINI_TIMEOUT_MS = 30000;
const SUMMARY_WORD_LIMIT = 2000;
const LANGUAGE_NAME_MAP = {
  hi: 'Hindi',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  ar: 'Arabic',
  bn: 'Bengali',
  zh: 'Chinese',
  en: 'English'
};
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

function isPngFile(file) {
  const extension = path.extname(file?.originalname || '').toLowerCase();
  const mimeType = String(file?.mimetype || '').toLowerCase();
  return extension === '.png' || mimeType === 'image/png';
}

function isJpegFile(file) {
  const extension = path.extname(file?.originalname || '').toLowerCase();
  const mimeType = String(file?.mimetype || '').toLowerCase();
  return extension === '.jpg' || extension === '.jpeg' || mimeType === 'image/jpeg';
}

async function getPdfPageCount(filePath) {
  const pdfBytes = await fsPromises.readFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  return pdfDoc.getPageCount();
}

function normalizeSplitRanges(rawInput, pageCount) {
  const normalizedInput = String(rawInput || '')
    .toLowerCase()
    .replace(/\bthen\b/g, ',')
    .replace(/\band\b/g, ',')
    .replace(/\bto\b/g, '-')
    .replace(/[;|\n\r]+/g, ',');

  const ranges = [];

  normalizedInput.split(',').forEach((part) => {
    const numbers = (part.match(/\d+/g) || []).map((value) => Number.parseInt(value, 10)).filter(Number.isFinite);

    if (numbers.length === 0) {
      return;
    }

    let start = numbers[0];
    let end = numbers.length > 1 ? numbers[1] : numbers[0];

    if (start > end) {
      [start, end] = [end, start];
    }

    start = Math.max(1, start);
    end = Math.min(pageCount, end);

    if (start > pageCount || end < 1 || start > end) {
      return;
    }

    ranges.push([start, end]);
  });

  ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  const mergedRanges = [];

  ranges.forEach(([start, end]) => {
    const previousRange = mergedRanges[mergedRanges.length - 1];

    if (previousRange && start <= previousRange[1] + 1) {
      previousRange[1] = Math.max(previousRange[1], end);
      return;
    }

    mergedRanges.push([start, end]);
  });

  return mergedRanges.map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`)).join(',');
}

async function addTextOverlay(pdfDoc, findText, replaceText) {
  if (!findText || !replaceText) {
    return;
  }

  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  if (!firstPage) {
    return;
  }

  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = firstPage.getWidth();
  const pageHeight = firstPage.getHeight();
  const title = 'Edited text';
  const note = `${findText} -> ${replaceText}`;
  const boxHeight = 52;

  firstPage.drawRectangle({
    x: 28,
    y: pageHeight - 92,
    width: pageWidth - 56,
    height: boxHeight,
    color: rgb(1, 1, 1),
    opacity: 0.96,
    borderColor: rgb(0.85, 0.88, 0.97),
    borderWidth: 1
  });

  firstPage.drawText(title, {
    x: 40,
    y: pageHeight - 56,
    size: 12,
    font,
    color: rgb(0.17, 0.2, 0.35)
  });

  firstPage.drawText(note, {
    x: 40,
    y: pageHeight - 72,
    size: 10,
    font,
    color: rgb(0.35, 0.38, 0.48)
  });
}

async function addImageOverlay(pdfDoc, imageFile, imagePage, imageX, imageY, imageWidth) {
  if (!imageFile) {
    return;
  }

  if (!isPngFile(imageFile) && !isJpegFile(imageFile)) {
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];

    if (firstPage) {
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pageWidth = firstPage.getWidth();
      const pageHeight = firstPage.getHeight();
      firstPage.drawRectangle({
        x: 28,
        y: 28,
        width: pageWidth - 56,
        height: 42,
        color: rgb(1, 1, 1),
        opacity: 0.95,
        borderColor: rgb(0.85, 0.88, 0.97),
        borderWidth: 1
      });
      firstPage.drawText(`Image uploaded: ${imageFile.originalname} (PNG/JPG preview supported)`, {
        x: 40,
        y: 52,
        size: 10,
        font,
        color: rgb(0.35, 0.38, 0.48)
      });
    }

    return;
  }

  const fileBytes = await fsPromises.readFile(imageFile.path);
  const image = isPngFile(imageFile)
    ? await pdfDoc.embedPng(fileBytes)
    : await pdfDoc.embedJpg(fileBytes);

  const pages = pdfDoc.getPages();
  const pageIndexes = imagePage === 'all'
    ? pages.map((_, index) => index)
    : [Math.max(0, Number.parseInt(String(imagePage), 10) - 1 || 0)];

  pageIndexes.forEach((pageIndex) => {
    const page = pages[pageIndex];
    if (!page) {
      return;
    }

    const scale = imageWidth / image.width;
    const drawWidth = imageWidth;
    const drawHeight = image.height * scale;
    const drawX = Math.max(0, Number(imageX) || 0);
    const drawY = Math.max(0, page.getHeight() - (Number(imageY) || 0) - drawHeight);

    page.drawImage(image, {
      x: drawX,
      y: drawY,
      width: drawWidth,
      height: drawHeight
    });
  });
}

async function buildEditedPdf(pdfFile, req) {
  const pdfBytes = await fsPromises.readFile(pdfFile.path);
  const pdfDoc = await PDFDocument.load(pdfBytes);

  const findText = String(req.body?.find_text || '').trim();
  const replaceText = String(req.body?.replace_text || '').trim();
  const imageFile = Array.isArray(req.files?.image) ? req.files.image[0] : null;
  const imagePage = String(req.body?.image_page || 'all').trim() || 'all';
  const imageX = String(req.body?.image_x || '40').trim();
  const imageY = String(req.body?.image_y || '40').trim();
  const imageWidth = Number.parseFloat(String(req.body?.image_width || '160')) || 160;

  await addTextOverlay(pdfDoc, findText, replaceText);

  if (imageFile) {
    await addImageOverlay(pdfDoc, imageFile, imagePage, imageX, imageY, imageWidth);
  }

  return Buffer.from(await pdfDoc.save());
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

function requireGeminiApiKey() {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Add it in Render environment variables or backend/.env for local testing.');
  }

  return apiKey;
}

function splitTextIntoChunks(text, maxLength = GEMINI_CHUNK_SIZE) {
  const normalizedText = String(text || '').trim();

  if (!normalizedText) {
    return [];
  }

  const chunks = [];
  let cursor = 0;

  while (cursor < normalizedText.length) {
    let end = Math.min(cursor + maxLength, normalizedText.length);

    if (end < normalizedText.length) {
      const breakpoint = normalizedText.lastIndexOf(' ', end);
      if (breakpoint > cursor + Math.floor(maxLength * 0.6)) {
        end = breakpoint;
      }
    }

    const chunk = normalizedText.slice(cursor, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    cursor = end;
  }

  return chunks;
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function limitWords(text, limit = SUMMARY_WORD_LIMIT) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) {
    return String(text || '').trim();
  }

  return `${words.slice(0, limit).join(' ')}...`;
}

function isValidLanguageCode(code) {
  const normalized = String(code || '').trim();
  return /^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(normalized);
}

function getTargetLanguageName(targetLang) {
  const normalized = String(targetLang || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (LANGUAGE_NAME_MAP[normalized]) {
    return LANGUAGE_NAME_MAP[normalized];
  }

  const baseCode = normalized.split('-')[0];
  if (LANGUAGE_NAME_MAP[baseCode]) {
    return LANGUAGE_NAME_MAP[baseCode];
  }

  return normalized;
}

async function translateTextWithGemini(text, targetLang) {
  const targetLanguageName = getTargetLanguageName(targetLang);
  const prompt = [
    `Translate the following text into ${targetLanguageName}:`,
    'Return only the translated text without notes or extra explanation.',
    '',
    text
  ].join('\n');

  return callGeminiGenerateContent(prompt);
}

function normalizeGeminiModelName(modelName) {
  return String(modelName || '').trim().replace(/^models\//, '');
}

async function listGeminiGenerateModels(apiKey, signal) {
  const response = await fetch(`${GEMINI_API_ROOT}/models?key=${encodeURIComponent(apiKey)}`, {
    method: 'GET',
    signal
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json().catch(() => ({}));
  const models = Array.isArray(data?.models) ? data.models : [];

  return models
    .filter((model) => Array.isArray(model?.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent'))
    .map((model) => normalizeGeminiModelName(model?.name))
    .filter(Boolean);
}

async function callGeminiGenerateContent(promptText) {
  const apiKey = requireGeminiApiKey();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  const discoveredModels = await listGeminiGenerateModels(apiKey, controller.signal).catch(() => []);
  const modelsToTry = [normalizeGeminiModelName(GEMINI_MODEL), ...GEMINI_MODEL_FALLBACKS.map(normalizeGeminiModelName), ...discoveredModels].filter(Boolean);
  const seenModels = new Set();
  const uniqueModelsToTry = modelsToTry.filter((model) => {
    if (seenModels.has(model)) {
      return false;
    }
    seenModels.add(model);
    return true;
  });

  let lastError = null;

  try {
    for (const model of uniqueModelsToTry) {
      const response = await fetch(`${GEMINI_API_ROOT}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: promptText
                }
              ]
            }
          ]
        }),
        signal: controller.signal
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const upstreamMessage = data?.error?.message || data?.message || 'Gemini API request failed';
        const modelMissing = /is not found|not supported/i.test(upstreamMessage);

        lastError = new Error(upstreamMessage);
        if (modelMissing) {
          continue;
        }
        throw lastError;
      }

      const parts = data?.candidates?.[0]?.content?.parts;
      const outputText = Array.isArray(parts)
        ? parts.map((part) => part?.text).filter(Boolean).join('\n').trim()
        : '';

      if (!outputText) {
        throw new Error('Gemini API returned an empty summary');
      }

      return outputText;
    }

    throw lastError || new Error('No supported Gemini model is currently available for generateContent');
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Gemini API request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function summarizeTextWithGemini(text) {
  const chunks = splitTextIntoChunks(text, GEMINI_CHUNK_SIZE);

  if (chunks.length === 0) {
    throw new Error('Text is required for summarization');
  }

  const chunkSummaries = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunkPrompt = [
      `Summarize the following PDF text in bullet points. Keep the full response under ${SUMMARY_WORD_LIMIT} words.`,
      'Prioritize key ideas, names, and conclusions. Avoid repetition.',
      '',
      chunks[index]
    ].join('\n');

    chunkSummaries.push(await callGeminiGenerateContent(chunkPrompt));
  }

  if (chunkSummaries.length === 1) {
    return chunkSummaries[0];
  }

  const mergePrompt = [
    `Summarize the following PDF text in bullet points. Keep the full response under ${SUMMARY_WORD_LIMIT} words.`,
    '',
    'Combine and deduplicate these chunk summaries into one coherent bullet list:',
    '',
    chunkSummaries.map((summary, index) => `Chunk ${index + 1}:\n${summary}`).join('\n\n')
  ].join('\n');

  return limitWords(await callGeminiGenerateContent(mergePrompt), SUMMARY_WORD_LIMIT);
}

function summarizeTextFallback(text, maxBullets = 6) {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return '- No content available to summarize.';
  }

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => sentence.length > 20);

  const selected = (sentences.length > 0 ? sentences : [cleaned]).slice(0, maxBullets);
  const bullets = selected.map((sentence) => `- ${sentence}`);

  bullets.unshift('- Fallback summary generated because Gemini quota is currently exceeded.');
  return limitWords(bullets.join('\n'), SUMMARY_WORD_LIMIT);
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

      const resolvedExtraParams = typeof extraParams === 'function' ? await extraParams(req) : (extraParams || {});

      const { buffer, processResponse } = await executeToolWorkflow({
        tool,
        files: [req.file],
        extraParams: resolvedExtraParams
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
      const editedPdfBuffer = await buildEditedPdf(pdfFile, req);

      return writeAndDownloadResponse(res, editedPdfBuffer, downloadName, cleanupPaths);
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
    cloudconvertConfigured: Boolean(process.env.CLOUDCONVERT_KEY || process.env.CLOUDCONVERT_TOKEN),
    release: process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || 'local',
    geminiModel: GEMINI_MODEL || null
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    configured: Boolean(process.env.PUBLIC_KEY && process.env.SECRET_KEY),
    cloudconvertConfigured: Boolean(process.env.CLOUDCONVERT_KEY || process.env.CLOUDCONVERT_TOKEN),
    release: process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || 'local',
    geminiModel: GEMINI_MODEL || null
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
  extraParams: async (req) => {
    const uploadedPath = req.file?.path;

    if (!uploadedPath) {
      return {
        split_mode: 'ranges',
        ranges: '1'
      };
    }

    const pageCount = await getPdfPageCount(uploadedPath);
    const normalizedRanges = normalizeSplitRanges(req.body?.pages || req.body?.ranges || '1', pageCount);

    if (!normalizedRanges) {
      throw new Error(`No valid pages to split. Your PDF has ${pageCount} pages.`);
    }

    return {
      split_mode: 'ranges',
      ranges: normalizedRanges
    };
  }
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

app.post('/api/summarize', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

    if (!text) {
      return res.status(400).json({ error: 'Invalid input', message: 'Request body must include a non-empty text string.' });
    }

    if (countWords(text) > SUMMARY_WORD_LIMIT) {
      return res.status(400).json({
        error: 'Invalid input',
        message: `Input text must be ${SUMMARY_WORD_LIMIT} words or fewer.`
      });
    }

    const result = limitWords(await summarizeTextWithGemini(text), SUMMARY_WORD_LIMIT);
    return res.json({ result });
  } catch (error) {
    console.error('summarize failed:', error);

    const message = error instanceof Error ? error.message : 'Unknown error';
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (/quota exceeded|rate limit|billing/i.test(message) && text) {
      const fallbackResult = summarizeTextFallback(text);
      return res.json({
        result: fallbackResult,
        fallback: true,
        message: 'Gemini quota exceeded. Returned fallback summary.'
      });
    }

    const statusCode = /Missing GEMINI_API_KEY|Text is required|Invalid input/i.test(message)
      ? 400
      : /timed out/i.test(message)
        ? 504
        : 500;

    return res.status(statusCode).json({
      error: 'summarize failed',
      message
    });
  }
});

app.post('/api/translate', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const targetLang = typeof req.body?.targetLang === 'string' ? req.body.targetLang.trim().toLowerCase() : '';

    if (!text) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Request body must include a non-empty text string.'
      });
    }

    if (!targetLang || !isValidLanguageCode(targetLang)) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Request body must include a valid targetLang (example: hi, fr, es, pt-br).'
      });
    }

    const result = await translateTextWithGemini(text, targetLang);
    return res.json({ result });
  } catch (error) {
    console.error('translate failed:', error);

    return res.status(500).json({ error: 'Translation failed' });
  }
});

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
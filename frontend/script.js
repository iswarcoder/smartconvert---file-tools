/**
 * SmartConvert - Multi-Tool Platform JavaScript
 * Handles file conversion, PDF tools, image tools, and more
 */

// ============================================
// GLOBAL STATE
// ============================================

const DEFAULT_API_URL = 'https://smartconvert-file-tools-1.onrender.com';
const INIT_FETCH_TIMEOUT_MS = 3500;
const AI_SUMMARY_WORD_LIMIT = 2000;
const API_URL = resolveApiUrl();

const platformState = {
  currentTool: 'dashboard',
  availableTools: [],
  conversions: JSON.parse(localStorage.getItem('conversions') || '[]'),
  selectedFiles: {
    convert: null,
    pdfOffice: null,
    merge: [],
    split: null,
    compress: null,
    editPdf: null,
    editPdfImage: null,
    imageConvert: null,
    imagePdf: null,
  }
};

let selectedFile = null;
let selectedPdfOfficeFormat = null;
let convertDownloadBlobUrl = null;
let pdfOfficeDownloadBlobUrl = null;
let mergeDownloadBlobUrl = null;
let splitDownloadBlobUrl = null;
let compressDownloadBlobUrl = null;
let imageConvertDownloadBlobUrl = null;
let imagePdfDownloadBlobUrl = null;
let loadingRequests = 0;
let cloudConvertConfigured = false;
let aiSummarizeRunning = false;
let aiTranslateRunning = false;

// ============================================
// FORMAT MAPPING FOR CONVERSIONS
// ============================================

const formatMap = {
  docx: ['pdf'],
  odt: ['pdf'],
  pptx: ['pdf'],
  xlsx: ['pdf'],
};

const formatLabels = {
  pdf: '📄 PDF',
  txt: '📃 Text',
  docx: '📝 Word Document',
  doc: '📝 Word Document (Legacy)',
  odt: '📝 OpenDocument Text',
  pptx: '📽️ PowerPoint Presentation',
  ppt: '📽️ PowerPoint Presentation (Legacy)',
  odp: '📽️ OpenDocument Presentation',
  xlsx: '📊 Excel Spreadsheet',
  xls: '📊 Excel Spreadsheet (Legacy)',
  ods: '📊 OpenDocument Spreadsheet',
  csv: '📊 CSV',
};

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  loadHistory();

  // Render immediately so users can interact without waiting on network checks.
  platformState.availableTools = FALLBACK_TOOLS;
  renderToolsGrid();
  applyCloudConvertAvailability();

  requestAnimationFrame(() => {
    document.body.classList.add('app-ready');
  });

  Promise.allSettled([fetchAvailableTools(), fetchCloudConvertStatus()])
    .finally(() => {
      applyCloudConvertAvailability();
    });
});

function resolveApiUrl() {
  const configuredApi = typeof window.__SMARTCONVERT_API_URL === 'string'
    ? window.__SMARTCONVERT_API_URL.trim()
    : '';

  if (configuredApi) {
    return configuredApi.replace(/\/+$/, '');
  }

  return DEFAULT_API_URL;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================
// GET AVAILABLE TOOLS
// ============================================

// Fallback tools if API is unavailable
const FALLBACK_TOOLS = [
  {
    'id': 'convert',
    'name': 'Convert File',
    'description': 'Convert documents between formats (DOCX, PDF, TXT, etc.)',
    'icon': '🔄',
    'available': true
  },
  {
    'id': 'merge-pdf',
    'name': 'Merge PDF',
    'description': 'Combine multiple PDF files into one document',
    'icon': '📎',
    'available': true
  },
  {
    'id': 'split-pdf',
    'name': 'Split PDF',
    'description': 'Extract specific pages or split PDF into separate files',
    'icon': '✂️',
    'available': true
  },
  {
    'id': 'compress-pdf',
    'name': 'Compress PDF',
    'description': 'Reduce PDF file size while maintaining quality',
    'icon': '📦',
    'available': true
  },
  {
    'id': 'edit-pdf',
    'name': 'Edit PDF',
    'description': 'Replace text and add image/logo in a PDF',
    'icon': '✏️',
    'available': true
  },
  {
    'id': 'image-convert',
    'name': 'Image to PDF',
    'description': 'Convert images (JPG, PNG, GIF) to PDF documents',
    'icon': '🖼️',
    'available': true
  }
];

async function fetchAvailableTools() {
  try {
    const response = await fetchWithTimeout(`${API_URL}/api/tools`, {}, INIT_FETCH_TIMEOUT_MS);
    const data = await parseJsonResponse(response);
    
    if (data.status === 'success' && data.tools && data.tools.length > 0) {
      platformState.availableTools = data.tools;
      renderToolsGrid();
      return;
    }
  } catch (error) {
    console.warn('Error fetching tools from API, using fallback:', error);
  }
  
  // Use fallback tools if API fails
  console.log('Using fallback tools');
  platformState.availableTools = FALLBACK_TOOLS;
  renderToolsGrid();
}

async function fetchCloudConvertStatus() {
  try {
    const response = await fetchWithTimeout(`${API_URL}/api/health`, {}, INIT_FETCH_TIMEOUT_MS);
    const data = await parseJsonResponse(response);
    cloudConvertConfigured = Boolean(data?.cloudconvertConfigured);
  } catch (error) {
    cloudConvertConfigured = false;
  }
}

function applyCloudConvertAvailability() {
  const notice = document.getElementById('pdfOfficeCloudConvertNotice');
  const buttons = document.querySelectorAll('.pdf-office-option');

  buttons.forEach((button) => {
    button.disabled = !cloudConvertConfigured;
    button.setAttribute('aria-disabled', String(!cloudConvertConfigured));
  });

  if (notice) {
    if (cloudConvertConfigured) {
      notice.style.display = 'none';
      notice.textContent = '';
    } else {
      notice.style.display = 'block';
      notice.textContent = 'CloudConvert is not configured on the server yet. Add CLOUDCONVERT_KEY in Render to enable PDF to Word and PDF to PowerPoint.';
    }
  }
}

function renderToolsGrid() {
  const toolsGrid = document.getElementById('toolsGrid');
  
  toolsGrid.innerHTML = platformState.availableTools.map(tool => `
    <div class="tool-card" onclick="openTool('${tool.id}')">
      <div class="tool-card-icon">${tool.icon}</div>
      <h3 class="tool-card-title">${tool.name}</h3>
      <p class="tool-card-description">${tool.description}</p>
      <button class="tool-card-btn">Open Tool →</button>
    </div>
  `).join('');
}

function openAiPdfFeature(feature) {
  if (feature === 'summarize') {
    showAiSummarizeView();
    return;
  }

  if (feature === 'translate') {
    showAiTranslateView();
    return;
  }
}

// ============================================
// NAVIGATION
// ============================================

function showDashboard() {
  platformState.currentTool = 'dashboard';
  document.getElementById('dashboardView').style.display = 'block';
  document.getElementById('aiSummarizeView').style.display = 'none';
  document.getElementById('aiTranslateView').style.display = 'none';
  document.getElementById('convertView').style.display = 'none';
  document.getElementById('mergePdfView').style.display = 'none';
  document.getElementById('splitPdfView').style.display = 'none';
  document.getElementById('compressPdfView').style.display = 'none';
  document.getElementById('editPdfView').style.display = 'none';
  document.getElementById('imageToolsView').style.display = 'none';
  document.getElementById('historyView').style.display = 'none';
  window.scrollTo(0, 0);
}

function showHistory() {
  platformState.currentTool = 'history';
  document.getElementById('dashboardView').style.display = 'none';
  document.getElementById('aiSummarizeView').style.display = 'none';
  document.getElementById('aiTranslateView').style.display = 'none';
  document.getElementById('convertView').style.display = 'none';
  document.getElementById('mergePdfView').style.display = 'none';
  document.getElementById('splitPdfView').style.display = 'none';
  document.getElementById('compressPdfView').style.display = 'none';
  document.getElementById('editPdfView').style.display = 'none';
  document.getElementById('imageToolsView').style.display = 'none';
  document.getElementById('historyView').style.display = 'block';
  window.scrollTo(0, 0);
}

function openTool(toolId) {
  showDashboard();
  
  document.getElementById('dashboardView').style.display = 'none';
  
  switch(toolId) {
    case 'convert':
      resetConvertForm();
      document.getElementById('convertView').style.display = 'block';
      break;
    case 'merge-pdf':
      document.getElementById('mergePdfView').style.display = 'block';
      setupMergePdf();
      break;
    case 'split-pdf':
      document.getElementById('splitPdfView').style.display = 'block';
      break;
    case 'compress-pdf':
      document.getElementById('compressPdfView').style.display = 'block';
      break;
    case 'edit-pdf':
      document.getElementById('editPdfView').style.display = 'block';
      resetEditPdfForm();
      break;
    case 'image-convert':
      document.getElementById('imageToolsView').style.display = 'block';
      break;
  }
  
  platformState.currentTool = toolId;
  window.scrollTo(0, 0);
}

function showAiSummarizeView() {
  showDashboard();
  document.getElementById('dashboardView').style.display = 'none';
  document.getElementById('aiSummarizeView').style.display = 'block';
  platformState.currentTool = 'ai-summarize';
  window.scrollTo(0, 0);
}

function showAiTranslateView() {
  showDashboard();
  document.getElementById('dashboardView').style.display = 'none';
  document.getElementById('aiTranslateView').style.display = 'block';
  platformState.currentTool = 'ai-translate';
  window.scrollTo(0, 0);
}

// ============================================
// EVENT LISTENERS SETUP
// ============================================

function setupEventListeners() {
  // File Conversion
  const convertUploadZone = document.getElementById('convertUploadZone');
  const convertFileInput = document.getElementById('convertFileInput');
  if (convertUploadZone) {
    convertUploadZone.addEventListener('click', () => convertFileInput.click());
    convertUploadZone.addEventListener('dragover', (e) => handleDragOver(e));
    convertUploadZone.addEventListener('drop', (e) => handleConvertDrop(e));
  }
  
  convertFileInput?.addEventListener('change', (e) => handleConvertFileSelect(e));
  document.getElementById('convertFormatSelect')?.addEventListener('change', () => {
    document.getElementById('convertBtn').disabled = !isConvertReady();
  });
  document.getElementById('convertBtn')?.addEventListener('click', () => performConversion());

  const pdfOfficeUploadZone = document.getElementById('pdfOfficeUploadZone');
  const pdfOfficeFileInput = document.getElementById('pdfOfficeFileInput');
  if (pdfOfficeUploadZone) {
    pdfOfficeUploadZone.addEventListener('click', () => pdfOfficeFileInput.click());
    pdfOfficeUploadZone.addEventListener('dragover', (e) => handleDragOver(e));
    pdfOfficeUploadZone.addEventListener('drop', (e) => handlePdfOfficeDrop(e));
  }

  pdfOfficeFileInput?.addEventListener('change', (e) => handlePdfOfficeFileSelect(e));
  document.getElementById('pdfOfficeBtn')?.addEventListener('click', () => performPdfOfficeConversion());
  
  // Merge PDF
  const mergeUploadZone = document.getElementById('mergeUploadZone');
  const mergeFileInput = document.getElementById('mergeFileInput');
  if (mergeUploadZone) {
    mergeUploadZone.addEventListener('click', () => mergeFileInput.click());
    mergeUploadZone.addEventListener('dragover', (e) => handleDragOver(e));
    mergeUploadZone.addEventListener('drop', (e) => handleMergeDrop(e));
  }

  document.getElementById('mergeAddBtn')?.addEventListener('click', () => {
    document.getElementById('mergeFileInput').click();
  });
  
  mergeFileInput?.addEventListener('change', (e) => handleMergeFileSelect(e));
  document.getElementById('mergeBtn')?.addEventListener('click', () => performMergePdf());
  
  // Split PDF
  const splitUploadZone = document.getElementById('splitUploadZone');
  const splitFileInput = document.getElementById('splitFileInput');
  if (splitUploadZone) {
    splitUploadZone.addEventListener('click', () => splitFileInput.click());
    splitUploadZone.addEventListener('dragover', (e) => handleDragOver(e));
    splitUploadZone.addEventListener('drop', (e) => handleSplitDrop(e));
  }
  
  splitFileInput?.addEventListener('change', (e) => handleSplitFileSelect(e));
  document.getElementById('splitPagesInput')?.addEventListener('input', () => {
    document.getElementById('splitBtn').disabled = !isSplitReady();
  });
  document.getElementById('splitBtn')?.addEventListener('click', () => performSplitPdf());
  
  // Compress PDF
  const compressUploadZone = document.getElementById('compressUploadZone');
  const compressFileInput = document.getElementById('compressFileInput');
  if (compressUploadZone) {
    compressUploadZone.addEventListener('click', () => compressFileInput.click());
    compressUploadZone.addEventListener('dragover', (e) => handleDragOver(e));
    compressUploadZone.addEventListener('drop', (e) => handleCompressDrop(e));
  }
  
  compressFileInput?.addEventListener('change', (e) => handleCompressFileSelect(e));
    document.getElementById('compressTargetSize')?.addEventListener('input', () => {
      document.getElementById('compressBtn').disabled = !isCompressReady();
    });
  document.getElementById('compressBtn')?.addEventListener('click', () => performCompressPdf());

  // Edit PDF
  const editPdfUploadZone = document.getElementById('editPdfUploadZone');
  const editPdfFileInput = document.getElementById('editPdfFileInput');
  if (editPdfUploadZone) {
    editPdfUploadZone.addEventListener('click', () => editPdfFileInput.click());
    editPdfUploadZone.addEventListener('dragover', (e) => handleDragOver(e));
    editPdfUploadZone.addEventListener('drop', (e) => handleEditPdfDrop(e));
  }

  editPdfFileInput?.addEventListener('change', (e) => handleEditPdfFileSelect(e));
  document.getElementById('editPdfImageInput')?.addEventListener('change', (e) => handleEditPdfImageSelect(e));
  document.getElementById('editPdfFindText')?.addEventListener('input', () => {
    document.getElementById('editPdfBtn').disabled = !isEditPdfReady();
  });
  document.getElementById('editPdfReplaceText')?.addEventListener('input', () => {
    document.getElementById('editPdfBtn').disabled = !isEditPdfReady();
  });
  document.getElementById('editPdfBtn')?.addEventListener('click', () => performEditPdf());
  
  // Image Tools
  const imageConvertUploadZone = document.getElementById('imageConvertUploadZone');
  const imageConvertFileInput = document.getElementById('imageConvertFileInput');
  if (imageConvertUploadZone) {
    imageConvertUploadZone.addEventListener('click', () => imageConvertFileInput.click());
    imageConvertUploadZone.addEventListener('dragover', (e) => handleDragOver(e));
    imageConvertUploadZone.addEventListener('drop', (e) => handleImageConvertDrop(e));
  }
  
  imageConvertFileInput?.addEventListener('change', (e) => handleImageConvertFileSelect(e));
  document.getElementById('imageFormatSelect')?.addEventListener('change', () => {
    document.getElementById('imageConvertBtn').disabled = !isImageConvertReady();
  });
  document.getElementById('imageConvertBtn')?.addEventListener('click', () => performImageConvert());
  
  const imagePdfUploadZone = document.getElementById('imagePdfUploadZone');
  const imagePdfFileInput = document.getElementById('imagePdfFileInput');
  if (imagePdfUploadZone) {
    imagePdfUploadZone.addEventListener('click', () => imagePdfFileInput.click());
    imagePdfUploadZone.addEventListener('dragover', (e) => handleDragOver(e));
    imagePdfUploadZone.addEventListener('drop', (e) => handleImagePdfDrop(e));
  }
  
  imagePdfFileInput?.addEventListener('change', (e) => handleImagePdfFileSelect(e));
  document.getElementById('imagePdfBtn')?.addEventListener('click', () => performImageToPdf());
  
  // History
  document.getElementById('clearHistoryBtn')?.addEventListener('click', () => clearHistory());

  // AI summarize
  document.getElementById('aiSummarizeBtn')?.addEventListener('click', () => performAiSummarize());
  document.getElementById('aiSummarizeClearBtn')?.addEventListener('click', () => resetAiSummarize());

  // AI translate
  document.getElementById('aiTranslateBtn')?.addEventListener('click', () => performAiTranslate());
  document.getElementById('aiTranslateClearBtn')?.addEventListener('click', () => resetAiTranslate());
}

function resetAiSummarize() {
  const input = document.getElementById('aiSummarizeInput');
  const resultWrap = document.getElementById('aiSummarizeResultWrap');
  const result = document.getElementById('aiSummarizeResult');

  if (input) {
    input.value = '';
  }

  if (result) {
    result.textContent = '';
  }

  if (resultWrap) {
    resultWrap.style.display = 'none';
  }

  hideProgress('aiSummarize');
}

async function performAiSummarize() {
  if (aiSummarizeRunning) {
    return;
  }

  const input = document.getElementById('aiSummarizeInput');
  const resultWrap = document.getElementById('aiSummarizeResultWrap');
  const resultNode = document.getElementById('aiSummarizeResult');
  const button = document.getElementById('aiSummarizeBtn');
  const text = (input?.value || '').trim();
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;

  if (!text) {
    showToast('❌ Please paste PDF text first', 'error');
    return;
  }

  if (wordCount > AI_SUMMARY_WORD_LIMIT) {
    showToast(`❌ Please keep text within ${AI_SUMMARY_WORD_LIMIT} words.`, 'error');
    return;
  }

  aiSummarizeRunning = true;
  if (button) {
    button.disabled = true;
  }

  showProgress('aiSummarize', 35, 'Sending text to Gemini...');

  try {
    const response = await fetchWithTimeout(`${API_URL}/api/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    }, 60000);

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const data = await parseJsonResponse(response);
    const summary = String(data?.result || '').trim();

    if (!summary) {
      throw new Error('Server returned an empty summary. Check GEMINI_API_KEY and backend logs.');
    }

    showProgress('aiSummarize', 100, 'Summary ready');

    if (resultNode) {
      resultNode.textContent = summary;
    }
    if (resultWrap) {
      resultWrap.style.display = 'block';
    }

    addConversionToHistory('pasted-text', 'AI Summarize', 'summary.txt', '', '', `Input length: ${text.length} chars`);
    showToast('✅ Summary generated successfully', 'success');
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Failed to summarize';
    const message = formatAiSummarizeError(rawMessage);
    showProgress('aiSummarize', 0, '❌ Summarization failed');
    showToast(`❌ ${message}`, 'error');
  } finally {
    aiSummarizeRunning = false;
    if (button) {
      button.disabled = false;
    }

    setTimeout(() => {
      hideProgress('aiSummarize');
    }, 600);
  }
}

function formatAiSummarizeError(message) {
  const text = String(message || '').trim();

  if (/quota exceeded|rate limit|billing/i.test(text)) {
    return 'Gemini quota reached. Please wait a bit or upgrade Gemini billing. Temporary fallback can be enabled on backend.';
  }

  if (/Missing GEMINI_API_KEY/i.test(text)) {
    return 'Server is missing GEMINI_API_KEY. Add it in Render environment variables.';
  }

  if (/timed out/i.test(text)) {
    return 'AI request timed out. Please try again with shorter text.';
  }

  return text || 'Failed to summarize';
}

function resetAiTranslate() {
  const input = document.getElementById('aiTranslateInput');
  const lang = document.getElementById('aiTranslateTargetLang');
  const resultWrap = document.getElementById('aiTranslateResultWrap');
  const result = document.getElementById('aiTranslateResult');

  if (input) {
    input.value = '';
  }
  if (lang) {
    lang.value = 'hi';
  }
  if (result) {
    result.textContent = '';
  }
  if (resultWrap) {
    resultWrap.style.display = 'none';
  }

  hideProgress('aiTranslate');
}

async function performAiTranslate() {
  if (aiTranslateRunning) {
    return;
  }

  const input = document.getElementById('aiTranslateInput');
  const langInput = document.getElementById('aiTranslateTargetLang');
  const resultWrap = document.getElementById('aiTranslateResultWrap');
  const resultNode = document.getElementById('aiTranslateResult');
  const button = document.getElementById('aiTranslateBtn');

  const text = (input?.value || '').trim();
  const targetLang = (langInput?.value || '').trim().toLowerCase();

  if (!text) {
    showToast('❌ Please paste text to translate.', 'error');
    return;
  }

  if (!/^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(targetLang)) {
    showToast('❌ Enter a valid target language code like hi, fr, es, pt-br.', 'error');
    return;
  }

  aiTranslateRunning = true;
  if (button) {
    button.disabled = true;
  }

  showProgress('aiTranslate', 35, 'Translating text...');

  try {
    const response = await fetchWithTimeout(`${API_URL}/api/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text, targetLang })
    }, 60000);

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const data = await parseJsonResponse(response);
    const translated = String(data?.result || '').trim();

    if (!translated) {
      throw new Error('Translation failed');
    }

    showProgress('aiTranslate', 100, 'Translation ready');
    if (resultNode) {
      resultNode.textContent = translated;
    }
    if (resultWrap) {
      resultWrap.style.display = 'block';
    }

    addConversionToHistory('pasted-text', 'AI Translate', 'translation.txt', '', '', `Target language: ${targetLang}`);
    showToast('✅ Translation generated successfully', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Translation failed';
    showProgress('aiTranslate', 0, '❌ Translation failed');
    showToast(`❌ ${message || 'Translation failed'}`, 'error');
  } finally {
    aiTranslateRunning = false;
    if (button) {
      button.disabled = false;
    }
    setTimeout(() => hideProgress('aiTranslate'), 600);
  }
}

// ============================================
// DRAG & DROP
// ============================================

function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add('dragover');
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('dragover');
}

function handleConvertDrop(e) {
  handleDragLeave(e);
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleConvertFileSelect({ target: { files: files } });
  }
}

function handlePdfOfficeDrop(e) {
  handleDragLeave(e);
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handlePdfOfficeFileSelect({ target: { files: files } });
  }
}

function handleMergeDrop(e) {
  handleDragLeave(e);
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleMergeFileSelect({ target: { files: files } });
  }
}

function handleSplitDrop(e) {
  handleDragLeave(e);
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleSplitFileSelect({ target: { files: files } });
  }
}

function handleCompressDrop(e) {
  handleDragLeave(e);
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleCompressFileSelect({ target: { files: files } });
  }
}

function handleImageConvertDrop(e) {
  handleDragLeave(e);
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleImageConvertFileSelect({ target: { files: files } });
  }
}

function handleImagePdfDrop(e) {
  handleDragLeave(e);
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleImagePdfFileSelect({ target: { files: files } });
  }
}

function handleEditPdfDrop(e) {
  handleDragLeave(e);
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleEditPdfFileSelect({ target: { files: files } });
  }
}

// ============================================
// FILE TYPE SELECTION
// ============================================

let selectedFileType = null;

function selectFileType(type) {
  selectedFileType = type;
  
  // Remove selected class from all options
  document.querySelectorAll('.file-type-option').forEach(option => {
    option.classList.remove('selected');
  });
  
  // Add selected class to clicked option
  document.querySelector(`[data-type="${type}"]`).classList.add('selected');
  
  // Update file input accept attribute based on selected type
  const fileInput = document.getElementById('convertFileInput');
  let acceptTypes = '';
  
  switch(type) {
    case 'word':
      acceptTypes = '.docx,.odt';
      break;
    case 'excel':
      acceptTypes = '.xlsx';
      break;
    case 'powerpoint':
      acceptTypes = '.pptx';
      break;
  }
  
  fileInput.accept = acceptTypes;
  
  // Show upload zone
  document.getElementById('convertUploadZone').style.display = 'block';
  
  // Scroll to upload zone
  document.getElementById('convertUploadZone').scrollIntoView({ behavior: 'smooth' });
}

function selectPdfOfficeFormat(format) {
  if (!cloudConvertConfigured) {
    showToast('❌ CloudConvert is not configured. Add CLOUDCONVERT_KEY in Render to enable PDF to Office conversion.', 'error');
    return;
  }

  selectedPdfOfficeFormat = format;
  platformState.selectedFiles.pdfOffice = null;

  if (pdfOfficeDownloadBlobUrl) {
    URL.revokeObjectURL(pdfOfficeDownloadBlobUrl);
    pdfOfficeDownloadBlobUrl = null;
  }

  document.getElementById('pdfOfficeDownloadBtn').style.display = 'none';

  document.querySelectorAll('.pdf-office-option').forEach(option => {
    option.classList.toggle('selected', option.dataset.output === format);
  });

  const selectedFormatLabel = document.getElementById('pdfOfficeSelectedFormat');
  if (selectedFormatLabel) {
    selectedFormatLabel.textContent = format === 'docx' ? 'Word Document (.docx)' : 'PowerPoint Presentation (.pptx)';
  }

  document.getElementById('pdfOfficeUploadZone').style.display = 'block';
  document.getElementById('pdfOfficeUploadZone').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('pdfOfficeBtn').disabled = !isPdfOfficeReady();
}

function resetConvertForm() {
  selectedFileType = null;
  platformState.selectedFiles.convert = null;
  resetPdfOfficeForm();
  
  // Reset file type selection
  document.querySelectorAll('.file-type-option').forEach(option => {
    option.classList.remove('selected');
  });
  
  // Hide upload zone and file info
  document.getElementById('convertUploadZone').style.display = 'none';
  document.getElementById('convertFileInfo').style.display = 'none';
  
  // Reset format selector
  const formatSelect = document.getElementById('convertFormatSelect');
  formatSelect.innerHTML = '<option value="">-- Select format --</option>';
  formatSelect.disabled = true;
  
  // Reset file input
  document.getElementById('convertFileInput').value = '';
  
  // Reset buttons
  document.getElementById('convertBtn').disabled = true;
  document.getElementById('convertDownloadBtn').style.display = 'none';
  
  // Hide progress
  hideProgress('convert');
}

function resetPdfOfficeForm(keepDownloadButton = false) {
  selectedPdfOfficeFormat = null;
  platformState.selectedFiles.pdfOffice = null;

  document.querySelectorAll('.pdf-office-option').forEach(option => {
    option.classList.remove('selected');
  });

  const selectedFormatLabel = document.getElementById('pdfOfficeSelectedFormat');
  if (selectedFormatLabel) {
    selectedFormatLabel.textContent = '-- Select PDF output --';
  }

  if (pdfOfficeDownloadBlobUrl) {
    URL.revokeObjectURL(pdfOfficeDownloadBlobUrl);
    pdfOfficeDownloadBlobUrl = null;
  }

  document.getElementById('pdfOfficeFileInput').value = '';
  document.getElementById('pdfOfficeFileInfo').style.display = 'none';
  document.getElementById('pdfOfficeUploadZone').style.display = 'none';
  document.getElementById('pdfOfficeBtn').disabled = true;
  if (!keepDownloadButton) {
    document.getElementById('pdfOfficeDownloadBtn').style.display = 'none';
  }
  hideProgress('pdfOffice');
}

// ============================================
// FILE CONVERSION TOOL
// ============================================

function handleConvertFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    const file = files[0];
    const ext = file.name.split('.').pop().toLowerCase();
    const fileTypeByExtension = {
      docx: 'word',
      odt: 'word',
      xlsx: 'excel',
      pptx: 'powerpoint',
    };

    selectedFileType = fileTypeByExtension[ext] || null;
    
    if (!formatMap[ext]) {
      showToast('❌ Convert supports DOCX, ODT, PPTX, and XLSX files', 'error');
      e.target.value = '';
      return;
    }
    
    selectedFile = file;
    platformState.selectedFiles.convert = file;
    
    document.getElementById('convertFileName').textContent = file.name;
    document.getElementById('convertFileSize').textContent = formatBytes(file.size);
    document.getElementById('convertFileInfo').style.display = 'block';
    
    updateConvertFormatSelector(formatMap[ext]);
  }
}

function handlePdfOfficeFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    const file = files[0];
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('❌ Please select a PDF file', 'error');
      return;
    }

    platformState.selectedFiles.pdfOffice = file;

    document.getElementById('pdfOfficeFileName').textContent = file.name;
    document.getElementById('pdfOfficeFileSize').textContent = formatBytes(file.size);
    document.getElementById('pdfOfficeFileInfo').style.display = 'block';
    document.getElementById('pdfOfficeBtn').disabled = !isPdfOfficeReady();
  }
}

function updateConvertFormatSelector(formats) {
  const select = document.getElementById('convertFormatSelect');
  select.innerHTML = '<option value="">-- Select format --</option>';
  
  // Filter formats based on selected file type
  let availableFormats = [];
  
  if (selectedFileType === 'word') {
    availableFormats = ['pdf'];
  } else if (selectedFileType === 'excel') {
    availableFormats = ['pdf'];
  } else if (selectedFileType === 'powerpoint') {
    availableFormats = ['pdf'];
  } else {
    // Fallback to all formats
    availableFormats = formats;
  }
  
  availableFormats.forEach(fmt => {
    if (formats.includes(fmt)) {
      const option = document.createElement('option');
      option.value = fmt;
      option.textContent = formatLabels[fmt] || fmt.toUpperCase();
      select.appendChild(option);
    }
  });
  
  select.disabled = false;
}

function isConvertReady() {
  return platformState.selectedFiles.convert && document.getElementById('convertFormatSelect').value;
}

function isPdfOfficeReady() {
  return platformState.selectedFiles.pdfOffice && selectedPdfOfficeFormat;
}

function showLoading(message = 'Processing...') {
  loadingRequests += 1;
  const overlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingOverlayText');

  if (overlay) {
    overlay.style.display = 'flex';
  }

  if (loadingText) {
    loadingText.textContent = message;
  }
}

function hideLoading() {
  loadingRequests = Math.max(0, loadingRequests - 1);

  if (loadingRequests > 0) {
    return;
  }

  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

function getFilenameFromDisposition(contentDisposition) {
  if (!contentDisposition) {
    return '';
  }

  const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch && utfMatch[1]) {
    return decodeURIComponent(utfMatch[1]);
  }

  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return plainMatch && plainMatch[1] ? plainMatch[1] : '';
}

function triggerDownload(blobUrl, filename) {
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function readErrorMessage(response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await parseJsonResponse(response);
    return data.message || data.error || 'Request failed';
  }

  const text = await response.text().catch(() => '');
  return text || 'Request failed';
}

async function parseJsonResponse(response) {
  const raw = await response.text().catch(() => '');

  if (!raw || !raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

async function submitFileRequest(endpoint, formData, options = {}) {
  showLoading(options.loadingMessage || 'Processing...');

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      body: formData
    });

    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    if (contentType.includes('application/json')) {
      return await parseJsonResponse(response);
    }

    const blob = await response.blob();
    const filename = response.headers.get('x-download-filename')
      || getFilenameFromDisposition(response.headers.get('content-disposition'))
      || options.defaultFilename
      || 'converted.pdf';
    const blobUrl = URL.createObjectURL(blob);

    triggerDownload(blobUrl, filename);

    return { blobUrl, filename };
  } finally {
    hideLoading();
  }
}

async function performConversion() {
  const file = selectedFile || platformState.selectedFiles.convert;
  const format = document.getElementById('convertFormatSelect').value;
  
  if (!file || !format) {
    showToast('❌ Please select file and format', 'error');
    return;
  }
  
  document.getElementById('convertBtn').disabled = true;
  showProgress('convert', 20, 'Uploading...');
  
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('target_format', format);

    showProgress('convert', 45, 'Converting...');

    const outputExtension = format;
    const result = await submitFileRequest('/convert', formData, {
      loadingMessage: 'Converting to PDF...',
      defaultFilename: `converted.${outputExtension}`
    });

    const blobUrl = result?.blobUrl || convertDownloadBlobUrl;

    if (result?.blobUrl) {
      if (convertDownloadBlobUrl) {
        URL.revokeObjectURL(convertDownloadBlobUrl);
      }
      convertDownloadBlobUrl = result.blobUrl;
    }

    showProgress('convert', 100, 'Done');

    setTimeout(() => {
      hideProgress('convert');
      showToast('✅ File converted successfully!', 'success');

      document.getElementById('convertDownloadBtn').style.display = 'block';
      document.getElementById('convertDownloadBtn').onclick = () => {
        const repeatLink = document.createElement('a');
        repeatLink.href = convertDownloadBlobUrl || blobUrl;
        repeatLink.download = `converted.${outputExtension}`;
        document.body.appendChild(repeatLink);
        repeatLink.click();
        document.body.removeChild(repeatLink);
      };

      addConversionToHistory(file.name, 'Convert', file.name, result.filename || `converted.${outputExtension}`, convertDownloadBlobUrl || result.blobUrl || '');
      clearConvertSelection();
    }, 500);
    
  } catch (error) {
    console.error(error);
    showProgress('convert', 0, '❌ Conversion failed');
    alert(error.message);
    showToast('❌ Error: ' + error.message, 'error');
  } finally {
    document.getElementById('convertBtn').disabled = false;
  }
}

async function performPdfOfficeConversion() {
  if (!cloudConvertConfigured) {
    showToast('❌ CloudConvert is not configured. Add CLOUDCONVERT_KEY in Render to enable this conversion.', 'error');
    return;
  }

  const file = platformState.selectedFiles.pdfOffice;
  const format = selectedPdfOfficeFormat;

  if (!file || !format) {
    showToast('❌ Please select a PDF and output format', 'error');
    return;
  }

  document.getElementById('pdfOfficeBtn').disabled = true;
  showProgress('pdfOffice', 20, 'Uploading PDF...');

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('target_format', format);

    showProgress('pdfOffice', 50, 'Converting PDF...');

    const result = await submitFileRequest('/pdf-to-office', formData, {
      loadingMessage: format === 'docx' ? 'Converting PDF to Word...' : 'Converting PDF to PowerPoint...',
      defaultFilename: format === 'docx' ? 'converted.docx' : 'converted.pptx'
    });

    const blobUrl = result?.blobUrl || pdfOfficeDownloadBlobUrl;

    if (result?.blobUrl) {
      if (pdfOfficeDownloadBlobUrl) {
        URL.revokeObjectURL(pdfOfficeDownloadBlobUrl);
      }
      pdfOfficeDownloadBlobUrl = result.blobUrl;
    }

    showProgress('pdfOffice', 100, '✅ PDF conversion complete!');

    setTimeout(() => {
      hideProgress('pdfOffice');
      showToast(format === 'docx' ? '✅ PDF converted to Word successfully!' : '✅ PDF converted to PowerPoint successfully!', 'success');

      const outputFilename = result?.filename || (format === 'docx' ? 'converted.docx' : 'converted.pptx');
      document.getElementById('pdfOfficeDownloadBtn').style.display = 'block';
      document.getElementById('pdfOfficeDownloadBtn').onclick = () => downloadFile(pdfOfficeDownloadBlobUrl || blobUrl, outputFilename);

      addConversionToHistory(
        file.name,
        format === 'docx' ? 'PDF to Word file' : 'PDF to PowerPoint',
        outputFilename,
        outputFilename,
        pdfOfficeDownloadBlobUrl || blobUrl || '',
        'Input: PDF'
      );

      resetPdfOfficeForm(true);
    }, 500);
  } catch (error) {
    const message = String(error?.message || 'Unknown error');
    showProgress('pdfOffice', 0, '❌ ' + message);
    showToast('❌ Error: ' + message, 'error');
  } finally {
    document.getElementById('pdfOfficeBtn').disabled = false;
  }
}

function clearConvertSelection() {
  selectedFile = null;
  platformState.selectedFiles.convert = null;
  document.getElementById('convertFileInput').value = '';
  document.getElementById('convertFormatSelect').value = '';
  document.getElementById('convertBtn').disabled = true;
  setTimeout(() => {
    document.getElementById('convertFileInfo').style.display = 'none';
  }, 2000);
}

// ============================================
// MERGE PDF TOOL
// ============================================

function setupMergePdf() {
  platformState.selectedFiles.merge = [];
}

function handleMergeFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    const newFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));

    if (newFiles.length === 0) {
      showToast('❌ Please select PDF files', 'error');
      return;
    }

    const existingFiles = platformState.selectedFiles.merge || [];
    const mergedFiles = [...existingFiles];

    newFiles.forEach(file => {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      const alreadyAdded = mergedFiles.some(existing => `${existing.name}-${existing.size}-${existing.lastModified}` === key);
      if (!alreadyAdded) {
        mergedFiles.push(file);
      }
    });

    platformState.selectedFiles.merge = mergedFiles;
    
    displayMergeFiles();
    document.getElementById('mergeBtn').disabled = platformState.selectedFiles.merge.length < 2;
    e.target.value = '';
  }
}

function displayMergeFiles() {
  const filesList = document.getElementById('mergeFilesList');
  const content = document.getElementById('mergeFilesListContent');
  
  filesList.style.display = 'block';
  content.innerHTML = platformState.selectedFiles.merge.map((f, i) => `
    <div class="file-item">
      <span>${i + 1}. ${f.name}</span>
      <button class="remove-btn" onclick="removeMergeFile(${i})">✕</button>
    </div>
  `).join('');
}

function removeMergeFile(index) {
  platformState.selectedFiles.merge.splice(index, 1);
  displayMergeFiles();
  document.getElementById('mergeBtn').disabled = platformState.selectedFiles.merge.length < 2;
}

async function performMergePdf() {
  if (platformState.selectedFiles.merge.length < 2) {
    showToast('❌ Please select at least 2 PDFs', 'error');
    return;
  }
  
  document.getElementById('mergeBtn').disabled = true;
  showProgress('merge', 50, '📎 Merging PDFs...');
  
  try {
    const formData = new FormData();
    platformState.selectedFiles.merge.forEach(file => {
      formData.append('file', file);
    });
    
    const result = await submitFileRequest('/merge', formData, {
      loadingMessage: 'Merging PDFs...',
      defaultFilename: 'merged.pdf'
    });

    if (result?.blobUrl) {
      if (mergeDownloadBlobUrl) {
        URL.revokeObjectURL(mergeDownloadBlobUrl);
      }
      mergeDownloadBlobUrl = result.blobUrl;
    }
    
    showProgress('merge', 100, '✅ Merge complete!');
    
    setTimeout(() => {
      hideProgress('merge');
      showToast('✅ PDFs merged successfully!', 'success');
      
      document.getElementById('mergeDownloadBtn').style.display = 'block';
      document.getElementById('mergeDownloadBtn').onclick = () => downloadFile(mergeDownloadBlobUrl || result.blobUrl, 'merged.pdf');

      addConversionToHistory('merged_pdfs', 'Merge PDF', 'merged.pdf', result.filename || 'merged.pdf', mergeDownloadBlobUrl || result.blobUrl || '');
      resetMergeForm();
    }, 500);
    
  } catch (error) {
    showProgress('merge', 0, '❌ ' + error.message);
    showToast('❌ Error: ' + error.message, 'error');
  } finally {
    document.getElementById('mergeBtn').disabled = false;
  }
}

function resetMergeForm() {
  if (mergeDownloadBlobUrl) {
    URL.revokeObjectURL(mergeDownloadBlobUrl);
    mergeDownloadBlobUrl = null;
  }

  platformState.selectedFiles.merge = [];
  document.getElementById('mergeFileInput').value = '';
  document.getElementById('mergeAddBtn').style.display = 'inline-flex';
  document.getElementById('mergeFilesList').style.display = 'none';
  document.getElementById('mergeBtn').disabled = true;
  document.getElementById('mergeDownloadBtn').style.display = 'none';
}

// ============================================
// SPLIT PDF TOOL
// ============================================

function handleSplitFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    const file = files[0];
    if (!file.name.endsWith('.pdf')) {
      showToast('❌ Please select a PDF file', 'error');
      return;
    }
    
    platformState.selectedFiles.split = file;
    
    document.getElementById('splitFileName').textContent = file.name;
    document.getElementById('splitFileSize').textContent = formatBytes(file.size);
    document.getElementById('splitPageCount').textContent = 'Use ranges like 2-6,7-8. Pages outside the PDF will be ignored.';
    document.getElementById('splitFileInfo').style.display = 'block';
    document.getElementById('splitBtn').disabled = !isSplitReady();
  }
}

function isSplitReady() {
  return platformState.selectedFiles.split && document.getElementById('splitPagesInput').value.trim();
}

async function performSplitPdf() {
  const file = platformState.selectedFiles.split;
  const pages = document.getElementById('splitPagesInput').value;
  
  if (!file || !pages.trim()) {
    showToast('❌ Please select file and pages', 'error');
    return;
  }
  
  document.getElementById('splitBtn').disabled = true;
  showProgress('split', 50, '✂️ Splitting PDF...');
  
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('pages', pages);
    
    const result = await submitFileRequest('/split', formData, {
      loadingMessage: 'Splitting PDF...',
      defaultFilename: 'split.pdf'
    });

    if (result?.blobUrl) {
      if (splitDownloadBlobUrl) {
        URL.revokeObjectURL(splitDownloadBlobUrl);
      }
      splitDownloadBlobUrl = result.blobUrl;
    }
    
    showProgress('split', 100, '✅ Split complete!');
    
    setTimeout(() => {
      hideProgress('split');
      showToast('✅ PDF split successfully!', 'success');
      
      document.getElementById('splitDownloadBtn').style.display = 'block';
      document.getElementById('splitDownloadBtn').onclick = () => downloadFile(splitDownloadBlobUrl || result.blobUrl, 'split.pdf');

      addConversionToHistory(file.name, 'Split PDF', 'split.pdf', result.filename || 'split.pdf', splitDownloadBlobUrl || result.blobUrl || '', `Pages: ${pages}`);
      resetSplitForm();
    }, 500);
    
  } catch (error) {
    showProgress('split', 0, '❌ ' + error.message);
    showToast('❌ Error: ' + error.message, 'error');
  } finally {
    document.getElementById('splitBtn').disabled = false;
  }
}

function resetSplitForm() {
  if (splitDownloadBlobUrl) {
    URL.revokeObjectURL(splitDownloadBlobUrl);
    splitDownloadBlobUrl = null;
  }

  platformState.selectedFiles.split = null;
  document.getElementById('splitFileInput').value = '';
  document.getElementById('splitPagesInput').value = '';
  document.getElementById('splitFileInfo').style.display = 'none';
  document.getElementById('splitPageCount').textContent = '';
  document.getElementById('splitBtn').disabled = true;
  document.getElementById('splitDownloadBtn').style.display = 'none';
}

// ============================================
// COMPRESS PDF TOOL
// ============================================

function handleCompressFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    const file = files[0];
    if (!file.name.endsWith('.pdf')) {
      showToast('❌ Please select a PDF file', 'error');
      return;
    }
    
    platformState.selectedFiles.compress = file;
    
    document.getElementById('compressFileName').textContent = file.name;
    document.getElementById('compressFileSize').textContent = formatBytes(file.size);
    document.getElementById('compressFileInfo').style.display = 'block';
        document.getElementById('compressBtn').disabled = !isCompressReady();
  }
}

    function isCompressReady() {
      const file = platformState.selectedFiles.compress;
      const targetSize = parseInt(document.getElementById('compressTargetSize').value, 10);
      return !!file && Number.isInteger(targetSize) && targetSize >= 50 && targetSize <= 1024;
    }

async function performCompressPdf() {
  const file = platformState.selectedFiles.compress;
      const targetSize = parseInt(document.getElementById('compressTargetSize').value, 10);
  
      if (!file || !Number.isInteger(targetSize) || targetSize < 50 || targetSize > 1024) {
        showToast('❌ Please select a PDF file and target size between 50 KB and 1 MB', 'error');
    return;
  }
  
  document.getElementById('compressBtn').disabled = true;
  showProgress('compress', 50, '📦 Compressing PDF...');
  
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('target_size_kb', targetSize);

    const result = await submitFileRequest('/compress', formData, {
      loadingMessage: 'Compressing PDF...',
      defaultFilename: 'compressed.pdf'
    });

    if (result?.blobUrl) {
      if (compressDownloadBlobUrl) {
        URL.revokeObjectURL(compressDownloadBlobUrl);
      }
      compressDownloadBlobUrl = result.blobUrl;
    }
    
    showProgress('compress', 100, '✅ Compression complete!');
    
    setTimeout(() => {
      hideProgress('compress');
        showToast('✅ PDF compressed successfully!', 'success');
      
      document.getElementById('compressionResult').style.display = 'none';
      
      document.getElementById('compressDownloadBtn').style.display = 'block';
      document.getElementById('compressDownloadBtn').onclick = () => downloadFile(compressDownloadBlobUrl || result.blobUrl, 'compressed.pdf');

      addConversionToHistory(file.name, 'Compress PDF', 'compressed.pdf', result.filename || 'compressed.pdf', compressDownloadBlobUrl || result.blobUrl || '', `Target size: ${targetSize} KB`);
      resetCompressForm();
    }, 500);
    
  } catch (error) {
    showProgress('compress', 0, '❌ ' + error.message);
    showToast('❌ Error: ' + error.message, 'error');
  } finally {
    document.getElementById('compressBtn').disabled = false;
  }
}

function resetCompressForm() {
  if (compressDownloadBlobUrl) {
    URL.revokeObjectURL(compressDownloadBlobUrl);
    compressDownloadBlobUrl = null;
  }

  platformState.selectedFiles.compress = null;
  document.getElementById('compressFileInput').value = '';
  document.getElementById('compressTargetSize').value = '250';
  document.getElementById('compressFileInfo').style.display = 'none';
  document.getElementById('compressionResult').style.display = 'none';
  document.getElementById('compressBtn').disabled = true;
  document.getElementById('compressDownloadBtn').style.display = 'none';
}

// ============================================
// EDIT PDF TOOL
// ============================================

function handleEditPdfFileSelect(e) {
  const files = e.target.files;
  if (!files || files.length === 0) {
    return;
  }

  const file = files[0];
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    showToast('❌ Please select a PDF file', 'error');
    return;
  }

  platformState.selectedFiles.editPdf = file;
  document.getElementById('editPdfFileName').textContent = file.name;
  document.getElementById('editPdfFileSize').textContent = formatBytes(file.size);
  document.getElementById('editPdfFileInfo').style.display = 'block';
  document.getElementById('editPdfBtn').disabled = !isEditPdfReady();
}

function handleEditPdfImageSelect(e) {
  const files = e.target.files;
  if (!files || files.length === 0) {
    platformState.selectedFiles.editPdfImage = null;
    document.getElementById('editPdfImageInfo').style.display = 'none';
    document.getElementById('editPdfBtn').disabled = !isEditPdfReady();
    return;
  }

  const file = files[0];
  const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];
  if (!validTypes.includes(file.type)) {
    showToast('❌ Please select a valid image (PNG/JPG/GIF/WEBP/BMP)', 'error');
    return;
  }

  platformState.selectedFiles.editPdfImage = file;
  document.getElementById('editPdfImageName').textContent = file.name;
  document.getElementById('editPdfImageSize').textContent = formatBytes(file.size);
  document.getElementById('editPdfImageInfo').style.display = 'block';
  document.getElementById('editPdfBtn').disabled = !isEditPdfReady();
}

function isEditPdfReady() {
  const pdfFile = platformState.selectedFiles.editPdf;
  if (!pdfFile) {
    return false;
  }

  const findText = document.getElementById('editPdfFindText').value.trim();
  const replaceText = document.getElementById('editPdfReplaceText').value.trim();
  const hasTextEdit = findText.length > 0 || replaceText.length > 0;
  const validTextEdit = !hasTextEdit || (findText.length > 0 && replaceText.length > 0);
  const hasImage = !!platformState.selectedFiles.editPdfImage;

  return validTextEdit && (hasImage || (findText.length > 0 && replaceText.length > 0));
}

async function performEditPdf() {
  if (!isEditPdfReady()) {
    showToast('❌ Upload PDF and provide text edit and/or image', 'error');
    return;
  }

  const file = platformState.selectedFiles.editPdf;
  const imageFile = platformState.selectedFiles.editPdfImage;
  const findText = document.getElementById('editPdfFindText').value.trim();
  const replaceText = document.getElementById('editPdfReplaceText').value.trim();
  const imagePage = document.getElementById('editPdfImagePage').value.trim() || 'all';
  const imageX = document.getElementById('editPdfImageX').value.trim() || '40';
  const imageY = document.getElementById('editPdfImageY').value.trim() || '40';
  const imageWidth = document.getElementById('editPdfImageWidth').value.trim() || '160';

  document.getElementById('editPdfBtn').disabled = true;
  showProgress('editPdf', 45, '✏️ Editing PDF...');

  try {
    const formData = new FormData();
    formData.append('file', file);

    if (findText && replaceText) {
      formData.append('find_text', findText);
      formData.append('replace_text', replaceText);
    }

    if (imageFile) {
      formData.append('image', imageFile);
      formData.append('image_page', imagePage);
      formData.append('image_x', imageX);
      formData.append('image_y', imageY);
      formData.append('image_width', imageWidth);
    }

    const data = await submitFileRequest('/edit', formData, {
      loadingMessage: 'Preparing edit placeholder...'
    });

    showProgress('editPdf', 100, '✅ PDF edit complete!');

    setTimeout(() => {
      hideProgress('editPdf');
      showToast(data.message || '✅ Edit PDF placeholder completed', 'success');

      const downloadFilename = data.download_filename || `${file.name.replace(/\.pdf$/i, '')}-edited.pdf`;
      document.getElementById('editPdfDownloadBtn').style.display = 'block';
      document.getElementById('editPdfDownloadBtn').onclick = () => {
        downloadFile(`/api/download/${encodeURIComponent(downloadFilename)}`, downloadFilename);
      };

      addConversionToHistory(file.name, 'Edit PDF', downloadFilename, downloadFilename, '', 'Download ready');
      resetEditPdfForm(true);
    }, 500);

  } catch (error) {
    showProgress('editPdf', 0, '❌ ' + error.message);
    showToast('❌ Error: ' + error.message, 'error');
  } finally {
    document.getElementById('editPdfBtn').disabled = false;
  }
}

function resetEditPdfForm(keepDownloadButton = false) {
  platformState.selectedFiles.editPdf = null;
  platformState.selectedFiles.editPdfImage = null;

  document.getElementById('editPdfFileInput').value = '';
  document.getElementById('editPdfImageInput').value = '';
  document.getElementById('editPdfFindText').value = '';
  document.getElementById('editPdfReplaceText').value = '';
  document.getElementById('editPdfImagePage').value = 'all';
  document.getElementById('editPdfImageX').value = '40';
  document.getElementById('editPdfImageY').value = '40';
  document.getElementById('editPdfImageWidth').value = '160';

  document.getElementById('editPdfFileInfo').style.display = 'none';
  document.getElementById('editPdfImageInfo').style.display = 'none';
  document.getElementById('editPdfBtn').disabled = true;
  if (!keepDownloadButton) {
    document.getElementById('editPdfDownloadBtn').style.display = 'none';
  }
  hideProgress('editPdf');
}

// ============================================
// IMAGE TOOLS
// ============================================

function switchImageTab(tab, triggerButton) {
  document.getElementById('imageConvertTab').style.display = tab === 'convert' ? 'block' : 'none';
  document.getElementById('imagePdfTab').style.display = tab === 'pdf' ? 'block' : 'none';
  
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (triggerButton) {
    triggerButton.classList.add('active');
  }
}

function handleImageConvertFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    const file = files[0];
    platformState.selectedFiles.imageConvert = file;
    
    document.getElementById('imageConvertFileName').textContent = file.name;
    document.getElementById('imageConvertFileSize').textContent = formatBytes(file.size);
    document.getElementById('imageConvertFileInfo').style.display = 'block';
    document.getElementById('imageFormatSelect').disabled = false;
  }
}

function isImageConvertReady() {
  return platformState.selectedFiles.imageConvert && document.getElementById('imageFormatSelect').value;
}

async function performImageConvert() {
  const file = platformState.selectedFiles.imageConvert;
  const format = document.getElementById('imageFormatSelect').value;
  
  if (!file || !format) {
    showToast('❌ Please select file and format', 'error');
    return;
  }

  if (!['jpg', 'png'].includes(format)) {
    showToast('❌ Image output is currently supported only for JPG and PNG', 'error');
    return;
  }

  if (imageConvertDownloadBlobUrl) {
    URL.revokeObjectURL(imageConvertDownloadBlobUrl);
    imageConvertDownloadBlobUrl = null;
  }
  
  document.getElementById('imageConvertBtn').disabled = true;
  showProgress('imageConvert', 50, '🖼️ Converting image...');
  
  try {
    const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const imageUrl = URL.createObjectURL(file);
    const image = await loadImage(imageUrl);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      URL.revokeObjectURL(imageUrl);
      throw new Error('Canvas conversion is not supported in this browser');
    }

    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    context.drawImage(image, 0, 0);

    showProgress('imageConvert', 80, '🖼️ Rendering output...');

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result) {
          reject(new Error('Image conversion failed'));
          return;
        }

        resolve(result);
      }, mimeType, format === 'jpg' ? 0.92 : undefined);
    });

    URL.revokeObjectURL(imageUrl);

    const blobUrl = URL.createObjectURL(blob);
    const safeName = `${file.name.replace(/\.[^.]+$/, '')}.${format}`;
    
    showProgress('imageConvert', 100, '✅ Conversion complete!');
    
    setTimeout(() => {
      hideProgress('imageConvert');
      showToast('✅ Image converted successfully!', 'success');
      
      document.getElementById('imageConvertDownloadBtn').style.display = 'block';
      document.getElementById('imageConvertDownloadBtn').onclick = () => downloadFile(imageConvertDownloadBlobUrl || blobUrl, safeName);

      if (imageConvertDownloadBlobUrl) {
        URL.revokeObjectURL(imageConvertDownloadBlobUrl);
      }

      imageConvertDownloadBlobUrl = blobUrl;
      
      addConversionToHistory(file.name, 'Image Convert', safeName, '', imageConvertDownloadBlobUrl || blobUrl || '');
      resetImageConvertForm();
    }, 500);
    
  } catch (error) {
    showProgress('imageConvert', 0, '❌ ' + error.message);
    showToast('❌ Error: ' + error.message, 'error');
  } finally {
    document.getElementById('imageConvertBtn').disabled = false;
  }
}

function resetImageConvertForm() {
  platformState.selectedFiles.imageConvert = null;
  document.getElementById('imageConvertFileInput').value = '';
  document.getElementById('imageFormatSelect').value = '';
  document.getElementById('imageConvertFileInfo').style.display = 'none';
  document.getElementById('imageConvertBtn').disabled = true;
  document.getElementById('imageConvertDownloadBtn').style.display = 'none';
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to read the selected image'));
    image.src = src;
  });
}

function handleImagePdfFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    const file = files[0];
    platformState.selectedFiles.imagePdf = file;
    
    document.getElementById('imagePdfFileName').textContent = file.name;
    document.getElementById('imagePdfFileSize').textContent = formatBytes(file.size);
    document.getElementById('imagePdfFileInfo').style.display = 'block';
    document.getElementById('imagePdfBtn').disabled = false;
  }
}

async function performImageToPdf() {
  const file = platformState.selectedFiles.imagePdf;
  
  if (!file) {
    showToast('❌ Please select an image', 'error');
    return;
  }
  
  document.getElementById('imagePdfBtn').disabled = true;
  showProgress('imagePdf', 50, '📄 Converting to PDF...');
  
  try {
    const formData = new FormData();
    formData.append('file', file);
    
    const result = await submitFileRequest('/image-to-pdf', formData, {
      loadingMessage: 'Converting image to PDF...',
      defaultFilename: 'image-to-pdf.pdf'
    });

    if (result?.blobUrl) {
      if (imagePdfDownloadBlobUrl) {
        URL.revokeObjectURL(imagePdfDownloadBlobUrl);
      }
      imagePdfDownloadBlobUrl = result.blobUrl;
    }
    
    showProgress('imagePdf', 100, '✅ Conversion complete!');
    
    setTimeout(() => {
      hideProgress('imagePdf');
      showToast('✅ Image converted to PDF!', 'success');
      
      document.getElementById('imagePdfDownloadBtn').style.display = 'block';
      document.getElementById('imagePdfDownloadBtn').onclick = () => downloadFile(imagePdfDownloadBlobUrl || result.blobUrl, 'image-to-pdf.pdf');

      addConversionToHistory(file.name, 'Image to PDF', 'image-to-pdf.pdf', result.filename || 'image-to-pdf.pdf', imagePdfDownloadBlobUrl || result.blobUrl || '');
      resetImagePdfForm();
    }, 500);
    
  } catch (error) {
    showProgress('imagePdf', 0, '❌ ' + error.message);
    showToast('❌ Error: ' + error.message, 'error');
  } finally {
    document.getElementById('imagePdfBtn').disabled = false;
  }
}

function resetImagePdfForm() {
  if (imagePdfDownloadBlobUrl) {
    URL.revokeObjectURL(imagePdfDownloadBlobUrl);
    imagePdfDownloadBlobUrl = null;
  }

  platformState.selectedFiles.imagePdf = null;
  document.getElementById('imagePdfFileInput').value = '';
  document.getElementById('imagePdfFileInfo').style.display = 'none';
  document.getElementById('imagePdfBtn').disabled = true;
  document.getElementById('imagePdfDownloadBtn').style.display = 'none';
}

// ============================================
// HISTORY MANAGEMENT
// ============================================

function addConversionToHistory(filename, tool, outputFilename, downloadFilename = '', downloadUrl = '', details = '') {
  const conversion = {
    id: Date.now(),
    filename: filename,
    tool: tool,
    timestamp: new Date().toLocaleString(),
    outputFilename: outputFilename,
    downloadFilename: downloadFilename,
    downloadUrl: downloadUrl,
    details: details,
  };
  
  platformState.conversions.unshift(conversion);
  
  if (platformState.conversions.length > 50) {
    platformState.conversions.pop();
  }
  
  localStorage.setItem('conversions', JSON.stringify(platformState.conversions));
  updateHistory();
}

function loadHistory() {
  updateHistory();
}

function updateHistory() {
  const historyBody = document.getElementById('historyBody');
  
  if (platformState.conversions.length === 0) {
    historyBody.innerHTML = '<p class="empty-state">No conversion history yet</p>';
    return;
  }
  
  historyBody.innerHTML = platformState.conversions.map(conv => {
    const canDownload = Boolean(conv.downloadFilename || conv.downloadUrl || (conv.outputFilename && conv.tool !== 'Edit PDF'));
    const detailText = conv.details || conv.outputFilename || '';

    return `
    <div class="history-row">
      <span class="history-col" data-label="File">
        <span style="display:block; font-weight:600;">${conv.displayFilename || conv.filename}</span>
        ${detailText ? `<span style="display:block; font-size:12px; color:#6b7280; margin-top:4px;">${detailText}</span>` : ''}
      </span>
      <span class="history-col" data-label="Tool">${conv.tool}</span>
      <span class="history-col" data-label="Date">${conv.timestamp}</span>
      <div class="history-actions" data-label="Action">
        <button class="history-edit" onclick="editHistoryFilename(${conv.id})" title="Rename ${conv.displayFilename || conv.filename}">
          ✏️ Edit Name
        </button>
        ${canDownload ? `
        <button class="history-action" onclick="downloadHistoryFile(${conv.id})" title="Download ${conv.displayFilename || conv.filename}">
          <span class="download-icon">⬇️</span> Download
        </button>
        ` : ''}
      </div>
    </div>
  `;
  }).join('');
}

function downloadHistoryFile(conversionId) {
  const conversion = platformState.conversions.find(item => item.id === conversionId);
  if (!conversion) {
    showToast('❌ History item not found', 'error');
    return;
  }

  const safeName = buildSafeDownloadName(conversion.displayFilename || conversion.filename, conversion.outputFilename);

  const downloadTarget = conversion.downloadFilename || conversion.outputFilename;

  if (downloadTarget) {
    downloadFile(`/api/download/${encodeURIComponent(downloadTarget)}`, safeName);
    return;
  }

  if (conversion.downloadUrl) {
    downloadFile(conversion.downloadUrl, safeName);
    return;
  }

  showToast('❌ Download is not available for this history item. Convert the file again to create a downloadable copy.', 'error');
}

function buildSafeDownloadName(requestedName, fallbackFilename) {
  const fallback = (fallbackFilename || 'download.file').trim();
  const fallbackParts = fallback.split('.');
  const fallbackExt = fallbackParts.length > 1 ? fallbackParts.pop() : '';
  const desired = (requestedName || '').trim();

  let safeBase = desired
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!safeBase) {
    return fallback;
  }

  const hasAnyExtension = safeBase.includes('.') && safeBase.split('.').pop().length > 0;
  if (!hasAnyExtension && fallbackExt) {
    safeBase = `${safeBase}.${fallbackExt}`;
  }

  return safeBase;
}

function editHistoryFilename(conversionId) {
  const conversion = platformState.conversions.find(item => item.id === conversionId);
  if (!conversion) {
    showToast('❌ History item not found', 'error');
    return;
  }

  const currentName = conversion.displayFilename || conversion.filename;
  const newNameRaw = prompt('Enter new file name:', currentName);

  if (newNameRaw === null) {
    return;
  }

  const newName = newNameRaw.trim();
  if (!newName) {
    showToast('❌ File name cannot be empty', 'error');
    return;
  }

  const invalidChars = /[\\/:*?"<>|]/;
  if (invalidChars.test(newName)) {
    showToast('❌ File name has invalid characters', 'error');
    return;
  }

  if (newName.length > 120) {
    showToast('❌ File name is too long', 'error');
    return;
  }

  conversion.displayFilename = newName;
  localStorage.setItem('conversions', JSON.stringify(platformState.conversions));
  updateHistory();
  showToast('✅ File name updated', 'success');
}

function clearHistory() {
  if (confirm('Are you sure? This will delete all conversion history.')) {
    platformState.conversions = [];
    localStorage.setItem('conversions', JSON.stringify(platformState.conversions));
    updateHistory();
    showToast('🗑️ History cleared', 'success');
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function showProgress(tool, percent, status) {
  const progressSection = document.getElementById(`${tool}Progress`);
  const progressFill = document.getElementById(`${tool}ProgressFill`);
  const progressText = document.getElementById(`${tool}ProgressText`);
  const progressStatus = document.getElementById(`${tool}ProgressStatus`);
  
  if (progressSection) {
    progressSection.style.display = 'block';
    progressFill.style.width = percent + '%';
    progressText.textContent = percent + '%';
    progressStatus.textContent = status;
  }
}

function hideProgress(tool) {
  const progressSection = document.getElementById(`${tool}Progress`);
  if (progressSection) {
    progressSection.style.display = 'none';
  }
}

function downloadFile(url, customFilename = '') {
  const link = document.createElement('a');
  link.href = url;

  if (customFilename) {
    link.download = customFilename;
  } else {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('⬇️ Download started', 'success');
}

function openDownloadInNewTab(url) {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.style.display = 'block';
  
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

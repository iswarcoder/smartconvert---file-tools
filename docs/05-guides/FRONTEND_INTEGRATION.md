# 🎨 Frontend Integration Guide

**For:** JavaScript developers integrating with SmartConvert API

---

## 📡 API Response Format

### **Success Response**
```json
{
  "status": "success",
  "message": "Successfully converted DOCX to PDF",
  "download_url": "/api/download/document.pdf",
  "output_filename": "document.pdf",
  "file_size": 512345
}
```

### **Error Response**
```json
{
  "status": "error",
  "message": "Clear description of error"
}
```

---

## 🎯 Complete Conversion Flow

```javascript
async function convertFile() {
  try {
    // Step 1: Validate inputs
    if (!fileInput.files[0]) {
      showError('Please select a file');
      return;
    }
    
    // Step 2: Upload file
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    
    const uploadResponse = await fetch('/api/convert/upload', {
      method: 'POST',
      body: formData
    });
    
    const uploadData = await uploadResponse.json();
    
    if (uploadData.status !== 'success') {
      showError(uploadData.message);
      return;
    }
    
    const uploadedFilename = uploadData.filename;
    console.log('File uploaded:', uploadedFilename);
    
    // Step 3: Request conversion
    const convertResponse = await fetch('/api/convert/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: uploadedFilename,
        output_format: formatSelect.value
      })
    });
    
    const convertData = await convertResponse.json();
    
    if (convertData.status !== 'success') {
      showError(convertData.message);
      return;
    }
    
    console.log('Conversion complete:', convertData.download_url);
    
    // Step 4: Show download
    downloadBtn.style.display = 'block';
    downloadBtn.onclick = () => downloadFile(convertData.download_url);
    
    showSuccess('✅ File converted successfully!');
    
  } catch (error) {
    showError('Network error: ' + error.message);
  }
}
```

---

## 🔄 Handling Different Error Types

```javascript
async function convertFile() {
  const response = await fetch('/api/convert/convert', {
    // ... request details ...
  });
  
  const data = await response.json();
  
  // Check status field
  if (data.status === 'success') {
    // ✅ Conversion successful
    downloadFile(data.download_url);
  } else if (data.status === 'error') {
    // ❌ Error occurred
    
    // Parse which type of error
    if (data.message.includes('Cannot convert')) {
      // Invalid conversion pair
      showError(`This conversion is not supported.\n${data.message}`);
    } else if (data.message.includes('not supported')) {
      // Unsupported input format
      showError(`File format not supported.\n${data.message}`);
    } else if (data.message.includes('LibreOffice')) {
      // LibreOffice not installed
      showError('Conversion service unavailable. Please try again later.');
    } else {
      // Generic error
      showError(data.message);
    }
  }
}
```

---

## 📊 UI State Management

### **Disabled Until File Selected**
```javascript
// Disable format dropdown and convert button initially
formatSelect.disabled = true;
convertBtn.disabled = true;

// Enable when user selects file
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) {
    formatSelect.disabled = false;
    convertBtn.disabled = false;
  }
});
```

### **Show Progress During Conversion**
```javascript
convertBtn.disabled = true;
progressBar.style.display = 'block';
progressBar.style.width = '30%';
progressText.textContent = '30% - Uploading...';

// ... upload ...

progressBar.style.width = '60%';
progressText.textContent = '60% - Converting...';

// ... convert ...

progressBar.style.width = '100%';
progressText.textContent = '100% - Complete!';

convertBtn.disabled = false;
```

### **Hide Download Until Success**
```javascript
// Initially hidden
downloadBtn.style.display = 'none';

// Show only after successful conversion
if (convertData.status === 'success') {
  downloadBtn.style.display = 'block';
}
```

---

## 💾 Persistent History

```javascript
// Store conversion in localStorage
function saveConversion(filename, inputFormat, outputFormat) {
  const conversions = JSON.parse(localStorage.getItem('conversions') || '[]');
  
  conversions.push({
    filename: filename,
    inputFormat: inputFormat,
    outputFormat: outputFormat,
    timestamp: new Date().toISOString(),
    status: 'success'
  });
  
  localStorage.setItem('conversions', JSON.stringify(conversions));
}

// Retrieve history
function loadConversionHistory() {
  const conversions = JSON.parse(localStorage.getItem('conversions') || '[]');
  return conversions;
}

// Display history in UI
function displayHistory() {
  const conversions = loadConversionHistory();
  
  conversions.forEach(conv => {
    const historyItem = document.createElement('div');
    historyItem.textContent = 
      `${conv.filename} (${conv.inputFormat} → ${conv.outputFormat})`;
    historyContainer.appendChild(historyItem);
  });
}
```

---

## 🧪 Test Cases

### **Test 1: File Upload** (Valid)
```javascript
// Upload document.docx
// Expected: upload returns filename
// Status: 'success'
```

### **Test 2: Format Validation** (Invalid)
```javascript
// Try to upload video.mp4
// Expected: error message "File format .mp4 is not supported"
// Status: 'error'
```

### **Test 3: Conversion Validation** (Valid)
```javascript
// Upload: docx, Convert to: pdf
// Expected: conversion starts
// Status: 'success'
```

### **Test 4: Conversion Validation** (Invalid)
```javascript
// Upload: pptx, Convert to: jpg
// Expected: error "Cannot convert PPTX to JPG. Supported: pdf, odp"
// Status: 'error'
```

### **Test 5: Error Messages** (Readable)
```javascript
// Check all error responses
// Expected: messages are clear and actionable
// No confusing error codes
```

---

## 🎨 UI Example

```html
<!-- File selection -->
<input type="file" id="fileInput">

<!-- Format selection -->
<select id="formatSelect">
  <option value="">-- Select format --</option>
  <option value="pdf">📄 PDF</option>
  <option value="txt">📃 TXT</option>
  <option value="csv">📊 CSV</option>
  <option value="odp">🎪 ODP</option>
</select>

<!-- Progress bar -->
<div id="progressBar" style="display: none;">
  <div id="progressFill"></div>
  <span id="progressText">0%</span>
</div>

<!-- Status message -->
<div id="statusMessage"></div>

<!-- Download button -->
<button id="downloadBtn" style="display: none;">
  ⬇️ Download
</button>

<!-- Error/Success messages -->
<div id="errorMessage" style="color: red;"></div>
<div id="successMessage" style="color: green;"></div>

<!-- History -->
<div id="historyContainer"></div>
```

---

## 🛠️ Helper Functions

```javascript
// Show error message
function showError(message) {
  document.getElementById('errorMessage').textContent = message;
  document.getElementById('errorMessage').style.display = 'block';
  setTimeout(() => {
    document.getElementById('errorMessage').style.display = 'none';
  }, 5000);
}

// Show success message
function showSuccess(message) {
  document.getElementById('successMessage').textContent = message;
  document.getElementById('successMessage').style.display = 'block';
  setTimeout(() => {
    document.getElementById('successMessage').style.display = 'none';
  }, 5000);
}

// Trigger download
function downloadFile(url) {
  const link = document.createElement('a');
  link.href = url;
  link.download = url.split('/').pop();
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Format file size
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
```

---

**Frontend integration is straightforward and well-documented!** 🚀

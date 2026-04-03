# 📡 SmartConvert API Reference

**Base URL:** http://127.0.0.1:5000

---

## 📋 API Endpoints

### **1. Upload File**

Upload a file for conversion.

**Endpoint:** `POST /api/convert/upload`

**Request:**
```
Method: POST
Content-Type: multipart/form-data

Body:
- file: (binary file data)
```

**Success Response (200):**
```json
{
  "status": "success",
  "message": "File uploaded successfully",
  "filename": "document.docx",
  "file_size": 1024576,
  "format": "docx"
}
```

**Error Response (400):**
```json
{
  "status": "error",
  "message": "File format .mp4 is not supported. Supported: .docx, .odt, .pptx, .xlsx"
}
```

**JavaScript Example:**
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const response = await fetch('http://127.0.0.1:5000/api/convert/upload', {
  method: 'POST',
  body: formData
});

const data = await response.json();
console.log(data.filename); // "document.docx"
```

---

### **2. Convert File**

Request conversion of an uploaded file.

**Endpoint:** `POST /api/convert/convert`

**Request JSON:**
```json
{
  "filename": "document.docx",
  "output_format": "pdf"
}
```

**Success Response (200):**
```json
{
  "status": "success",
  "message": "Successfully converted DOCX to PDF",
  "download_url": "/api/download/document.pdf",
  "output_filename": "document.pdf",
  "file_size": 512345
}
```

**Error Response (400):**
```json
{
  "status": "error",
  "message": "Cannot convert PPTX to JPG. Supported formats: pdf, odp"
}
```

**JavaScript Example:**
```javascript
const response = await fetch('http://127.0.0.1:5000/api/convert/convert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filename: 'document.docx',
    output_format: 'pdf'
  })
});

const data = await response.json();
if (data.status === 'success') {
  console.log('Download URL:', data.download_url);
}
```

---

### **3. Download File**

Download a converted file.

**Endpoint:** `GET /api/download/<filename>`

**Parameters:**
- `filename` - Name of converted file (e.g., `document.pdf`)

**Response:**
- Binary file data (browser auto-downloads)

**JavaScript Example:**
```javascript
const downloadUrl = '/api/download/document.pdf';
const link = document.createElement('a');
link.href = `http://127.0.0.1:5000${downloadUrl}`;
link.download = 'document.pdf';
link.click();
```

**Direct Browser Access:**
```
http://127.0.0.1:5000/api/download/document.pdf
```

---

## ✅ Supported Formats

### **Input Formats (What You Can Upload)**
- ✅ `.docx` - Microsoft Word 2007+
- ✅ `.odt` - OpenDocument Text
- ✅ `.pptx` - Microsoft PowerPoint 2007+
- ✅ `.xlsx` - Microsoft Excel 2007+

### **Output Formats (What You Can Convert To)**

| Input Format | Supported Outputs | Example |
|--------------|------------------|---------|
| **DOCX** | PDF, TXT | `docx → pdf` ✅ |
| **PPTX** | PDF, ODP | `pptx → pdf` ✅ |
| **XLSX** | PDF, CSV | `xlsx → csv` ✅ |
| **ODT** | DOCX | `odt → docx` ✅ |

---

## 🔍 Response Format

### **Success Response**
```json
{
  "status": "success",
  "message": "Clear description of what happened",
  "download_url": "/api/download/file.pdf",
  "output_filename": "file.pdf",
  "file_size": 512345
}
```

### **Error Response**
```json
{
  "status": "error",
  "message": "Clear description of what went wrong"
}
```

---

## 🧪 Test the API

### **Test Upload**
```bash
curl -X POST http://127.0.0.1:5000/api/convert/upload \
  -F "file=@document.docx"
```

### **Test Conversion**
```bash
curl -X POST http://127.0.0.1:5000/api/convert/convert \
  -H "Content-Type: application/json" \
  -d '{"filename":"document.docx","output_format":"pdf"}'
```

### **Test Download**
```bash
curl -O http://127.0.0.1:5000/api/download/document.pdf
```

---

## 📊 HTTP Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| **200** | Success | File uploaded, conversion done |
| **400** | Bad Request | Invalid format, missing data |
| **404** | Not Found | File doesn't exist |
| **500** | Server Error | Unexpected error |

---

## 🔐 Security Features

- ✅ Input format validation
- ✅ Conversion rule validation
- ✅ Filename sanitization
- ✅ CORS enabled for frontend
- ✅ Error messages don't expose paths
- ✅ File size limits enforced

---

## 🛠️ Error Handling

### **Upload Error: Unsupported Format**
```json
{
  "status": "error",
  "message": "File format .mp4 is not supported. Supported: .docx, .odt, .pptx, .xlsx"
}
```
→ **Fix:** Use one of the supported formats

### **Conversion Error: Invalid Pair**
```json
{
  "status": "error",
  "message": "Cannot convert PPTX to JPG. Supported formats: pdf, odp"
}
```
→ **Fix:** Use one of the supported output formats

### **Conversion Error: LibreOffice Not Found**
```json
{
  "status": "error",
  "message": "LibreOffice not found. Please install LibreOffice."
}
```
→ **Fix:** Install LibreOffice from https://www.libreoffice.org/download/

---

**API is fully documented and ready to use!** 🚀

# 🎯 Conversion Rules & Validation

**How SmartConvert validates and prevents invalid conversions**

---

## 📋 Allowed Conversion Rules

SmartConvert only allows these 8 specific conversion pairs:

```python
CONVERSION_RULES = {
    # Document conversions
    ('docx', 'pdf'):  'Convert Word to PDF',
    ('docx', 'txt'):  'Extract text from Word',
    ('odt', 'docx'):  'Convert OpenDoc to Word',
    
    # Presentation conversions
    ('pptx', 'pdf'):  'Convert PowerPoint to PDF',
    ('pptx', 'odp'):  'Convert PowerPoint to OpenDoc',
    
    # Spreadsheet conversions
    ('xlsx', 'pdf'):  'Convert Excel to PDF',
    ('xlsx', 'csv'):  'Export Excel as CSV',
}
```

---

## ✅ Valid Conversions (Will Work)

### **From DOCX**
```
✅ DOCX → PDF       (Create PDF from Word document)
✅ DOCX → TXT       (Extract text from Word document)
```

### **From PPTX**
```
✅ PPTX → PDF       (Create PDF from PowerPoint)
✅ PPTX → ODP       (Convert to OpenDocument format)
```

### **From XLSX**
```
✅ XLSX → PDF       (Create PDF from Excel)
✅ XLSX → CSV       (Export as comma-separated values)
```

### **From ODT**
```
✅ ODT → DOCX       (Convert OpenDoc to Word format)
```

---

## ❌ Blocked Conversions (Will Be Rejected)

### **Invalid DOCX Conversions**
```
❌ DOCX → XLSX     "Cannot convert DOCX to XLSX. Supported: pdf, txt"
❌ DOCX → PPTX     "Cannot convert DOCX to PPTX. Supported: pdf, txt"
❌ DOCX → JPG      "Cannot convert DOCX to JPG. Supported: pdf, txt"
```

### **Invalid PPTX Conversions**
```
❌ PPTX → JPG      "Cannot convert PPTX to JPG. Supported: pdf, odp"
❌ PPTX → DOCX     "Cannot convert PPTX to DOCX. Supported: pdf, odp"
❌ PPTX → CSV      "Cannot convert PPTX to CSV. Supported: pdf, odp"
```

### **Invalid XLSX Conversions**
```
❌ XLSX → DOCX     "Cannot convert XLSX to DOCX. Supported: pdf, csv"
❌ XLSX → PPTX     "Cannot convert XLSX to PPTX. Supported: pdf, csv"
❌ XLSX → JPG      "Cannot convert XLSX to JPG. Supported: pdf, csv"
```

### **Unsupported Input Formats**
```
❌ MP4 upload      ✗ Videos not supported
❌ MP3 upload      ✗ Audio not supported
❌ JPG upload      ✗ Images not supported
❌ PDF upload      ✗ PDFs not accepted
❌ ZIP upload      ✗ Archives not supported
```

---

## 🔍 How Validation Works

### **Step 1: Upload File**
User selects file for upload
↓
Backend checks file extension
↓
**Is format supported** (docx/pptx/xlsx/odt)?
- ✅ YES → Save file, proceed
- ❌ NO → Return error: "Format not supported"

### **Step 2: Conversion Request**
User selects output format and clicks Convert
↓
Backend receives conversion request
↓
**Is conversion pair allowed?**
- ✅ YES → Start conversion with LibreOffice
- ❌ NO → Return error: "Cannot convert X to Y. Supported: ..."

### **Step 3: Error Messages**

**Format Not Supported (on upload):**
```json
{
  "status": "error",
  "message": "File format .mp4 is not supported. Supported: .docx, .odt, .pptx, .xlsx"
}
```

**Conversion Not Allowed (on convert request):**
```json
{
  "status": "error",
  "message": "Cannot convert PPTX to JPG. Supported formats: pdf, odp"
}
```

---

## 🛡️ Why These Rules Exist

### **Quality Assurance**
Only pairs that produce correct output are allowed. No corrupted files.

### **Performance**
Prevents wasteful processing of incompatible format combinations.

### **User Experience**
Clear error messages tell users exactly what conversions are supported.

### **Reliability**
Tested pairs only = stable, predictable system.

---

## 🧪 Testing Validation

### **Test 1: Block Invalid Upload**
```
File: document.mp4
Result: ❌ Error "Format not supported"
Expected: Correct! ✅
```

### **Test 2: Block Invalid Conversion**
```
Upload: presentation.pptx
Convert to: JPG
Result: ❌ Error "Cannot convert PPTX to JPG. Supported: pdf, odp"
Expected: Correct! ✅
```

### **Test 3: Allow Valid Conversion**
```
Upload: document.docx
Convert to: PDF
Result: ✅ Starts conversion (if LibreOffice installed)
Expected: Correct! ✅
```

---

## 📊 Supported Input Formats

| Format | Type | Allowed | Example |
|--------|------|---------|---------|
| `.docx` | Word Document | ✅ | document.docx |
| `.pptx` | PowerPoint | ✅ | presentation.pptx |
| `.xlsx` | Excel | ✅ | spreadsheet.xlsx |
| `.odt` | OpenDocument | ✅ | file.odt |
| `.pdf` | PDF | ❌ | document.pdf |
| `.jpg` | Image | ❌ | photo.jpg |
| `.mp4` | Video | ❌ | video.mp4 |
| `.zip` | Archive | ❌ | files.zip |

---

## 🎯 Adding New Conversions (Developers)

To add a new supported conversion:

### **1. Update CONVERSION_RULES** in `backend/app.py`
```python
CONVERSION_RULES = {
    # ... existing rules ...
    ('ppt', 'pdf'): 'pdf:impress_pdf_Export',  # New!
}
```

### **2. Add input format if needed**
```python
SUPPORTED_INPUT_FORMATS = {'docx', 'odt', 'pptx', 'xlsx', 'ppt'}  # New!
```

### **3. Test thoroughly**
- Upload file with new format
- Try valid conversion (should work)
- Try invalid conversion (should block)
- Verify error messages

### **4. Update documentation**
- Add to this guide
- Update API docs
- Update user guides

---

## ✨ Summary

**Validation ensures:**
- ✅ Only quality conversions attempted
- ✅ No unsupported formats accepted
- ✅ Clear error messages for users
- ✅ System reliability
- ✅ Predictable behavior

**Current State:**
- ✅ 4 allowed input formats
- ✅ 8 allowed conversion pairs
- ✅ All others systematically blocked
- ✅ Production ready

---

**The validation system protects users and ensures quality!** ✨

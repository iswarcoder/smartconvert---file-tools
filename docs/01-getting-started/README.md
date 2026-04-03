# 🚀 SmartConvert - Getting Started

**Welcome to SmartConvert!** A premium file conversion application built with Flask and LibreOffice.

---

## ⚡ Quick Start (2 Minutes)

### **1. Access the Application**
```
http://127.0.0.1:5000
```

### **2. Upload a File**
- Click the upload zone
- Select: `.docx`, `.pptx`, `.xlsx`, or `.odt`

### **3. Convert**
- Choose output format (PDF, CSV, TXT, etc.)
- Click "Convert Now"
- Watch the progress bar

### **4. Download**
- Click "Download"
- File appears in your Downloads folder

---

## ✅ What's Supported

### **Input Formats**
- ✅ `.docx` - Word documents
- ✅ `.pptx` - PowerPoint presentations
- ✅ `.xlsx` - Excel spreadsheets
- ✅ `.odt` - OpenDocument files

### **Output Formats**
```
DOCX → PDF, TXT
PPTX → PDF, ODP
XLSX → PDF, CSV
ODT → DOCX
```

---

## 📁 Project Structure

```
project do/
├── frontend/              ← User interface
│   ├── index.html
│   ├── style.css
│   └── script.js
│
├── backend/               ← Server & APIs
│   ├── app.py
│   ├── uploads/          ← Your files go here
│   └── outputs/          ← Converted files saved here
│
└── docs/                  ← This documentation
    ├── 01-getting-started/
    ├── 02-setup/
    ├── 03-api-reference/
    ├── 04-deployment/
    └── 05-guides/
```

---

## 🔍 Backend Status

Check if backend is running:
```bash
# Should show: ✅ Backend is responding!
curl http://127.0.0.1:5000
```

---

## 🆘 Need Help?

**Backend not running?**
```bash
cd backend
python app.py
```

**LibreOffice not installed?**
See: `docs/02-setup/INSTALL_LIBREOFFICE.md`

**Need API details?**
See: `docs/03-api-reference/`

**Ready to deploy?**
See: `docs/04-deployment/`

---

## 📚 Documentation Folders

| Folder | Purpose |
|--------|---------|
| **01-getting-started/** | Start here! Quick setup |
| **02-setup/** | Installation & configuration |
| **03-api-reference/** | API endpoints & examples |
| **04-deployment/** | Production deployment |
| **05-guides/** | How-to guides |

---

## ✨ Key Features

✅ **Smart Validation** - Only safe conversions allowed  
✅ **Real Conversions** - Uses LibreOffice CLI  
✅ **Progress Tracking** - See conversion status  
✅ **Error Handling** - Clear error messages  
✅ **Responsive Design** - Works on all devices  
✅ **Drag & Drop** - Easy file upload  
✅ **History Tracking** - See past conversions  

---

**Ready to start converting files?** Open http://127.0.0.1:5000 now! 🎯

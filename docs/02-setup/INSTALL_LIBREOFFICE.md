# 📥 LibreOffice Installation Guide

**Status:** LibreOffice NOT YET INSTALLED  
**Impact:** File conversions will not work until LibreOffice is installed  
**Time Required:** 10-15 minutes total

---

## 🎯 What You Need to Do

### **Step 1: Download LibreOffice**

**Option A: Web Browser (EASIEST)**
1. Visit: https://www.libreoffice.org/download/
2. Click the large green button "LibreOffice Still" 
3. Choose "Windows" if not auto-selected
4. Click "Download" (File will be ~300MB)
5. Wait for download to complete

**Option B: Direct Link**
- Windows 64-bit: https://www.libreoffice.org/get-help/download-and-install/
- Windows 32-bit: Same link, choose 32-bit option

---

### **Step 2: Install LibreOffice**

1. Open the downloaded `.exe` file
2. Click "NEXT >" on the setup wizard
3. Keep all default options selected
4. Click "INSTALL"
5. Wait for installation to complete (2-3 minutes)
6. Click "FINISH"

**Important:** Do NOT uncheck any components during installation

---

### **Step 3: Verify Installation**

Open PowerShell and run:

```powershell
soffice --version
```

**Expected output:**
```
LibreOffice 7.6.4.1
```

If you see a version number, LibreOffice is installed correctly! ✅

---

## ⚡ Quick Alternative: Chocolatey

If you have Chocolatey installed, run (as Administrator):

```powershell
choco install libreoffice-still
```

Then verify:
```powershell
soffice --version
```

---

## 🚀 Next Steps After Installation

### **Step 1: Restart Backend**
```powershell
cd "C:\Users\graje\OneDrive\Desktop\project do\backend"
python app.py
```

### **Step 2: Run Validation Tests**
```powershell
python c:\temp\test_validation.py
```

**Expected:** All tests should now show **success**

### **Step 3: Test Real Conversions**
Upload a DOCX file and convert to PDF - it should work now!

---

## ❓ Troubleshooting

### **"soffice: The term 'soffice' is not recognized"**
- **Cause:** LibreOffice not in system PATH
- **Solution:** 
  - Restart PowerShell completely (close and reopen)
  - Or add manually: `C:\Program Files\LibreOffice\program`

### **Download is slow**
- Use portable version: https://www.libreoffice.org/download/

### **Installation fails**
- Check admin rights
- Disable antivirus temporarily
- Download fresh copy

---

## 📁 Installation Locations

- **Default:** `C:\Program Files\LibreOffice`
- **Executable:** `C:\Program Files\LibreOffice\program\soffice.exe`

---

## 📝 Checklist

- [ ] Downloaded LibreOffice installer
- [ ] Ran installer with Admin rights
- [ ] Installation completed successfully
- [ ] Verified with `soffice --version`
- [ ] Restarted PowerShell
- [ ] Backend restarted
- [ ] Validation tests passed

---

**Download and install now, then verify with `soffice --version`!** 🚀

# 🔧 Troubleshooting Guide

**Common issues and solutions**

---

## 🔴 Backend Issues

### **Issue: "Cannot connect to server"**
**Error:** Browser shows connection refused or timeout

**Causes:**
- Backend not running
- Port 5000 already in use
- Firewall blocking port

**Solutions:**
```powershell
# Check if running
netstat -ano | findstr :5000

# Start backend
cd backend
python app.py

# If port in use, find and kill process
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

---

### **Issue: "ModuleNotFoundError: No module named 'flask'"**
**Error:** Backend won't start

**Cause:** Flask not installed

**Solution:**
```powershell
pip install flask flask-cors
python app.py
```

---

### **Issue: "PermissionError: [WinError 5] Access is denied"**
**Error:** Backend throws permission error

**Cause:** Debug reloader permission issue

**Solution:** Already fixed in app.py with `use_reloader=False`

---

## 🟡 Upload Issues

### **Issue: "File format .mp4 is not supported"**
**Error:** Cannot upload video/audio files

**Expected Behavior:** ✅ This is correct! System only accepts docx, pptx, xlsx, odt

**Solution:** Use one of the supported formats:
- `.docx` - Word documents
- `.pptx` - PowerPoint
- `.xlsx` - Excel
- `.odt` - OpenDocument

---

### **Issue: "File format .pdf is not supported"**
**Error:** Cannot upload PDF files

**Expected Behavior:** ✅ This is correct! PDF is not an input format

**Solution:** 
- System accepts PDF as OUTPUT format only
- Cannot convert FROM PDF
- Instead, upload a supported format then convert TO PDF

---

### **Issue: File upload hangs or times out**
**Error:** Upload never completes

**Causes:**
- File too large
- Network connectivity issue
- Server not responding

**Solutions:**
```powershell
# Check file size (should be < 100MB usually)
(Get-Item "C:\path\to\file.docx").Length / 1MB

# Try smaller file
# Check network connection
ping 127.0.0.1

# Verify backend running
curl http://127.0.0.1:5000/
```

---

## 🟠 Conversion Issues

### **Issue: "Cannot convert PPTX to JPG"**
**Error:** Conversion blocked with message "Supported formats: pdf, odp"

**Expected Behavior:** ✅ This is correct! JPG is not a supported output for PPTX

**Reason:** System only allows specific, validated conversion pairs

**Solution:** Use a supported output format:
- For PPTX: convert to PDF or ODP
- For DOCX: convert to PDF or TXT
- For XLSX: convert to PDF or CSV

---

### **Issue: "LibreOffice not found"**
**Error:** Conversion request goes through but returns "LibreOffice not found"

**Cause:** LibreOffice not installed on system

**Impact:** Format validation works, but actual file conversion can't execute

**Solution:**
1. Download from: https://www.libreoffice.org/download/
2. Run installer
3. Restart backend
4. Try conversion again

```powershell
# Verify LibreOffice installed
soffice --version
# Should show: LibreOffice 7.x.x.x
```

---

### **Issue: Conversion times out**
**Error:** Conversion starts but never completes

**Causes:**
- File too large
- LibreOffice hanging
- Server overloaded

**Solutions:**
```powershell
# Check LibreOffice processes
Get-Process soffice -ErrorAction SilentlyContinue

# Kill hanging process
taskkill /IM soffice.exe /F

# Try smaller file
# Or restart backend
cd backend
python app.py
```

---

### **Issue: "Output file is empty"**
**Error:** Conversion completes but file size is 0

**Cause:** Conversion started but produced no output

**Solutions:**
- Check file permissions
- Check disk space
- Try different file
- Restart backend

---

## 🟢 Download Issues

### **Issue: File won't download**
**Error:** Download button appears but clicking doesn't work

**Causes:**
- Browser blocking 127.0.0.1
- File no longer exists
- Network issue

**Solutions:**
```powershell
# Check if file exists
ls backend/outputs/

# Clear browser cache
# Check browser downloads folder
# Try different browser
```

---

### **Issue: Downloaded file is corrupted**
**Error:** File downloaded but won't open

**Causes:**
- Conversion incomplete
- Wrong output format
- Network interruption

**Solutions:**
- Verify conversion succeeded (check logs)
- Try again
- Check file format matches
- Check file isn't empty: `(Get-Item "file.pdf").Length`

---

## 🔵 General Troubleshooting

### **Step 1: Check Backend Status**
```powershell
curl http://127.0.0.1:5000/
# Should return: 200 OK
```

### **Step 2: Check Logs**
Look at terminal where Flask is running for error messages:
```
[UPLOAD] File upload request received
[UPLOAD SUCCESS] File: document.docx
[CONVERSION START] Attempting to convert...
```

### **Step 3: Open Browser DevTools**
Press F12 and check:
- **Network tab:** See actual API requests
- **Console tab:** Check for JavaScript errors
- **Application tab:** View localStorage and cookies

### **Step 4: Enable Verbose Logging**
Add to beginning of `backend/app.py`:
```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

---

## 📋 Diagnostic Checklist

- [ ] Backend running: `python app.py`
- [ ] Backend responding: `curl http://127.0.0.1:5000/`
- [ ] Flask installed: `pip list | grep flask`
- [ ] CORS installed: `pip list | grep flask-cors`
- [ ] LibreOffice installed: `soffice --version`
- [ ] Upload folder exists: `ls backend/uploads/`
- [ ] Outputs folder exists: `ls backend/outputs/`
- [ ] Folders are writable: Check permissions
- [ ] Browser cache cleared: Ctrl+Shift+Del
- [ ] Firefox/Chrome open: Try different browser
- [ ] Firewall allows port 5000: Network settings
- [ ] File format supported: Check docs/05-guides/CONVERSION_RULES.md
- [ ] Conversion pair allowed: Check docs/05-guides/CONVERSION_RULES.md

---

## 🆘 Still Having Issues?

1. **Check all logs:**
   - Backend terminal output
   - Browser console (F12)
   - Browser Network tab

2. **Verify configuration:**
   - File paths correct
   - Permissions set
   - Ports not blocked

3. **Try simplest test:**
   - New .docx file
   - Convert to PDF
   - Check if file appears in `/outputs` folder

4. **Review guides:**
   - Check API documentation
   - Review conversion rules
   - See deployment guide

---

**Most issues have been experienced before - check here first!** 🎯

# 🔧 Development Environment Setup

**Prerequisites:** Windows 10+, Python 3.7+, Internet connection

---

## 1️⃣ Install Python Dependencies

### **Step 1: Navigate to Project**
```powershell
cd "C:\Users\graje\OneDrive\Desktop\project do"
```

### **Step 2: Create Virtual Environment (Recommended)**
```powershell
python -m venv venv
```

### **Step 3: Activate Virtual Environment**
```powershell
venv\Scripts\activate
```

You should see `(venv)` before your prompt.

### **Step 4: Install Required Packages**
```powershell
pip install --upgrade pip
pip install flask flask-cors
```

**Expected output:**
```
Successfully installed flask flask-cors ...
```

---

## 2️⃣ Verify Installation

### **Check Python**
```powershell
python --version
# Expected: Python 3.x.x
```

### **Check Flask**
```powershell
python -c "import flask; print(flask.__version__)"
# Expected: 3.x.x
```

### **Check CORS**
```powershell
python -c "import flask_cors; print('CORS OK')"
# Expected: CORS OK
```

---

## 3️⃣ Start Backend Server

### **Navigate to Backend**
```powershell
cd backend
```

### **Run Flask App**
```powershell
python app.py
```

### **Expected Output**
```
==================================================
SmartConvert Backend
==================================================
📁 Upload folder: C:\...
📁 Output folder: C:\...
🔗 Running on http://127.0.0.1:5000
==================================================
```

---

## 4️⃣ Test Backend

### **In New PowerShell Window, Test Connection**
```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:5000/" -UseBasicParsing
```

**Expected:** Status 200 OK ✅

---

## ✅ Setup Checklist

- [ ] Python 3.7+ installed
- [ ] Virtual environment created
- [ ] Flask installed
- [ ] Flask-CORS installed
- [ ] Backend runs without errors
- [ ] Frontend loads at http://127.0.0.1:5000
- [ ] LibreOffice installed (separate guide)

---

## 📁 Folder Permissions

Ensure these folders are writable:
```
backend/uploads/     - For uploaded files
backend/outputs/     - For converted files
```

If you see permission errors:
```powershell
# Check permissions
Get-Acl "C:\Users\graje\OneDrive\Desktop\project do\backend\uploads"

# Allow full permissions if needed
icacls "C:\Users\graje\OneDrive\Desktop\project do\backend" /grant Everyone:F
```

---

**Environment setup complete! Ready to convert files.** 🚀

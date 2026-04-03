# 🚀 Deployment Guide

**For:** Production server setup  
**Target:** Linux/Windows servers  
**Time:** 30-45 minutes

---

## 📋 Pre-Deployment Checklist

- [ ] Python 3.7+ on server
- [ ] LibreOffice installed
- [ ] MySQL configured (optional)
- [ ] Firewall rules set (port 5000 or 80)
- [ ] SSL certificates ready (for HTTPS)
- [ ] Backup strategy planned

---

## 🔧 Server Preparation

### **1. Install Dependencies**

**Windows:**
```powershell
python -m pip install --upgrade pip
pip install flask flask-cors gunicorn
```

**Linux:**
```bash
sudo apt-get update
sudo apt-get install python3 python3-pip libreoffice
pip3 install flask flask-cors gunicorn
```

### **2. Install LibreOffice**

See: `02-setup/INSTALL_LIBREOFFICE.md`

### **3. Create Directories**

```bash
mkdir -p backend/uploads
mkdir -p backend/outputs
chmod 755 backend/uploads backend/outputs
```

---

## 🌐 Deployment Options

### **Option 1: Development Server** (Testing Only)
```bash
cd backend
python app.py
```
⚠️ **NOT for production!** Single-threaded, debug mode enabled

---

### **Option 2: Gunicorn** (Production)

**Install Gunicorn:**
```bash
pip install gunicorn
```

**Run with 4 workers:**
```bash
cd backend
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

**Run in background (Linux):**
```bash
nohup gunicorn -w 4 -b 0.0.0.0:5000 app:app > app.log 2>&1 &
```

**Run with systemd service (Linux):**
See: `SYSTEMD_SERVICE.md`

---

### **Option 3: Docker** (Recommended)

**Create Dockerfile:**
```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y libreoffice
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["gunicorn", "-w 4", "-b 0.0.0.0:5000", "app:app"]
```

**Create requirements.txt:**
```
flask==3.1.3
flask-cors==6.0.2
gunicorn==21.2.0
```

**Build and run:**
```bash
docker build -t smartconvert .
docker run -p 5000:5000 -v uploads:/app/backend/uploads -v outputs:/app/backend/outputs smartconvert
```

---

## 🔒 Security Configuration

### **1. HTTPS with Nginx**

**Create nginx config:**
```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### **2. File Size Limit**

In `app.py`:
```python
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB
```

### **3. Rate Limiting**

```bash
pip install Flask-Limiter
```

In `app.py`:
```python
from flask_limiter import Limiter

limiter = Limiter(app)

@app.route('/api/convert/convert', methods=['POST'])
@limiter.limit("10/minute")
def convert_file():
    # ...
```

---

## 📊 Performance Tuning

### **Optimize Gunicorn**
```bash
gunicorn \
  -w 8 \
  --worker-class sync \
  --bind 0.0.0.0:5000 \
  --timeout 300 \
  --access-logfile - \
  --error-logfile - \
  app:app
```

### **Enable Caching**
```bash
pip install Flask-Caching
```

### **Monitor Resources**
```bash
# CPU & Memory
top
ps aux | grep gunicorn

# Disk
du -sh backend/uploads backend/outputs
```

---

## 🔍 Monitoring

### **Check Logs**
```bash
tail -f app.log | grep ERROR
```

### **Monitor Backend**
```bash
curl http://yourdomain.com/api/convert/upload
# Should return 405 (POST method required)
```

### **Check File Folders**
```bash
ls -lh backend/uploads/    # Uploaded files
ls -lh backend/outputs/    # Converted files
```

---

## 🧹 Maintenance

### **Daily**
```bash
# Check disk space
df -h

# Rotate logs
logrotate -f /etc/logrotate.d/smartconvert
```

### **Weekly**
```bash
# Clean old files
find backend/uploads -mtime +7 -delete
find backend/outputs -mtime +7 -delete

# Check performance
ps aux | grep gunicorn
```

### **Monthly**
```bash
# Update packages
pip install --upgrade -r requirements.txt

# Review logs
grep ERROR app.log | tail -20
```

---

## 🚨 Troubleshooting

### **Port Already in Use**
```bash
# Find process
lsof -i :5000

# Kill process
kill -9 <PID>
```

### **Permission Denied**
```bash
# Fix permissions
chmod 755 backend/uploads backend/outputs
chown www-data:www-data backend/  # If using web server
```

### **Out of Memory**
```bash
# Reduce workers
gunicorn -w 2 app:app

# Increase swap
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### **LibreOffice Hanging**
```bash
# Restart service
systemctl restart smartconvert

# Or kill manually
pkill -9 soffice
```

---

## 📈 Scaling

### **Phase 1: Single Server** (Now)
- All services on one machine
- Suitable for: < 100 conversions/day

### **Phase 2: Reverse Proxy**
- Nginx in front of Gunicorn
- Multiple workers
- Suitable for: 100-1000 conversions/day

### **Phase 3: Queue System**
- Celery + Redis for async conversions
- Separate conversion workers
- Suitable for: 1000+ conversions/day

### **Phase 4: Microservices**
- Separate backend instances
- Load balancer (HAProxy/Nginx)
- Database cluster
- Suitable for: 10,000+ conversions/day

---

## ✅ Deployment Checklist

- [ ] Server environment configured
- [ ] Python 3.7+ installed
- [ ] LibreOffice installed & verified
- [ ] Required packages installed
- [ ] Gunicorn/Docker configured
- [ ] Firewall rules set
- [ ] Nginx configured (optional)
- [ ] SSL certificates configured
- [ ] File permissions set correctly
- [ ] Logging enabled
- [ ] Monitoring set up
- [ ] Backup strategy implemented
- [ ] Health checks configured
- [ ] Verified with load test

---

**Your SmartConvert application is production-ready!** 🚀

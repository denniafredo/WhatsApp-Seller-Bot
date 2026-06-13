# Ubuntu Server Setup

Bot ini memakai WPPConnect, yang menjalankan WhatsApp Web lewat Puppeteer/Chromium. Di Ubuntu server, masalah paling sering adalah Node.js terlalu lama, Chromium belum ada, atau dependency browser belum lengkap.

## 1. Install Node.js

Gunakan Node.js 18 atau lebih baru.

```bash
node -v
npm -v
```

## 2. Install browser

Untuk Ubuntu server, lebih stabil pakai Google Chrome `.deb` daripada `chromium-browser` Snap.

```bash
sudo apt update
sudo apt install -y wget gnupg ca-certificates
wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install -y /tmp/google-chrome.deb
```

Lalu cek:

```bash
google-chrome-stable --version
which google-chrome-stable
```

Masukkan path Chrome ke `.env`:

```env
CHROME_PATH=/usr/bin/google-chrome-stable
PUPPETEER_HEADLESS=true
```

Kalau tetap ingin memakai Chromium, pastikan binary-nya bisa jalan:

```bash
chromium --version
chromium-browser --version
```

Error `Code: 127` biasanya berarti browser gagal dieksekusi karena command/dependency hilang.

## 3. Install dependency browser tambahan

Kalau Chrome masih gagal start, install dependency berikut:

```bash
sudo apt update
sudo apt install -y \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  xdg-utils
```

## 4. Buat `.env`

Copy dari contoh:

```bash
cp .env.example .env
```

Isi nomor bisnis:

```env
BUSINESS_PHONE=6285176707544
PUPPETEER_HEADLESS=true
CHROME_PATH=/usr/bin/google-chrome-stable
```

## 5. Install dan jalankan

```bash
npm install
npm start
```

Kalau QR tidak muncul atau browser gagal start, kirim error terminal yang muncul setelah `Failed to start WhatsApp bot:`.

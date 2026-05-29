# AIVA Web2APK v2.0

Build APK dari website, clone HTML, dan deploy — **tanpa bergantung ke server eksternal**.

---

## 🚀 Cara Install & Jalankan

### Metode 1: Setup Interaktif (Terminal)
```bash
node server.js
```
Pilih menu `1. Install & Jalankan Website` lalu ikuti instruksi.

### Metode 2: Langsung Jalankan Server
```bash
# Copy .env.example ke .env terlebih dahulu
cp .env.example .env
# Edit .env sesuai kebutuhan
nano .env
# Install dependencies
npm install
# Jalankan
node server.js --server
```

### Metode 3: PM2 (Production)
```bash
npm install -g pm2
pm2 start server.js --name web2apk -- --server
pm2 save
pm2 startup
```

---

## ⚙️ Konfigurasi .env

| Variabel | Wajib | Keterangan |
|---|---|---|
| `PORT` | ❌ | Default: 3000 |
| `JWT_SECRET` | ✅ | String random panjang untuk keamanan token |
| `ADMIN_KEY` | ✅ | Key untuk akses panel admin |
| `LIMIT_FREE` | ❌ | Build limit user Free/hari. Default: 5 |
| `LIMIT_PRO` | ❌ | Build limit user Pro/hari. Default: 30 |
| `LOCAL_BUILD` | ❌ | Set `true` untuk build lokal (default) |
| `EXTERNAL_BUILD_API` | ❌ | URL build server eksternal (opsional) |
| `EXTERNAL_BUILD_KEY` | ❌ | API key untuk server eksternal |
| `REMOVEBG_API_KEY` | ❌ | Untuk fitur remove background |

---

## 📋 Fitur per Role

| Fitur | Free | Pro | ProMax |
|---|---|---|---|
| Build APK (URL/HTML) | ✅ 5x/hari | ✅ 30x/hari | ✅ Unlimited |
| Clone Website HTML | ✅ 5x/hari | ✅ 30x/hari | ✅ Unlimited |
| API Key untuk Build | ✅ 5x/hari | ✅ 30x/hari | ✅ Unlimited |
| Riwayat Build | ✅ | ✅ | ✅ |
| Analisa APK | ✅ | ✅ | ✅ |
| Deploy Website | ❌ | ❌ | ✅ |
| Remove Background | ❌ | ✅ | ✅ |
| Upscale Gambar | ❌ | ✅ | ✅ |
| Arduino Compiler | ✅ | ✅ | ✅ |

---

## 🔑 Penggunaan API Key

### Mendapatkan API Key
1. Login ke dashboard
2. Masuk ke menu **API Key**
3. Klik **Generate API Key**

### Build APK via API
```bash
curl -X POST https://yourdomain.com/api/apk/build-api \
  -H "X-API-Key: aiva_xxxxxxxxxxxx" \
  -F "appName=My App" \
  -F "packageName=com.myapp.example" \
  -F "url=https://yourwebsite.com"
```

### Build dengan file HTML
```bash
curl -X POST https://yourdomain.com/api/apk/build-api \
  -H "X-API-Key: aiva_xxxxxxxxxxxx" \
  -F "appName=My App" \
  -F "packageName=com.myapp.example" \
  -F "html=@/path/to/index.html"
```

### Response sukses
```json
{
  "success": true,
  "buildId": "abc123",
  "fileName": "My_App_v1.0.apk",
  "downloadUrl": "/uploads/apk/My_App_v1.0.apk",
  "size": 102400,
  "apiUsage": {
    "used": 1,
    "limit": 5,
    "remaining": 4
  }
}
```

---

## 🏗️ Mode Build APK

### Mode Lokal (Default)
Tidak perlu konfigurasi tambahan. APK di-generate langsung di server menggunakan template WebView Android.

> **Catatan:** Untuk APK yang fully native dan bisa langsung diinstal di semua device, disarankan setup Android Build Tools di server atau gunakan External Build Server.

### Mode External (Opsional)
Set di `.env`:
```
EXTERNAL_BUILD_API=https://your-build-server.com
EXTERNAL_BUILD_KEY=your_key_here
```

---

## 📁 Struktur Project

```
web2apk/
├── server.js          ← Entry point + terminal menu
├── database.js        ← JSON file database
├── .env               ← Konfigurasi (buat dari .env.example)
├── .env.example       ← Template konfigurasi
├── routes/
│   ├── apk.js         ← Build APK + API Key endpoint
│   ├── scrape.js      ← Clone website HTML
│   ├── deploy.js      ← Deploy website (ProMax)
│   ├── auth.js        ← Login/Register
│   ├── admin.js       ← Panel admin
│   └── ...
├── middleware/
│   └── auth.js        ← JWT middleware
├── public/
│   └── index.html     ← Frontend
├── data/              ← Database JSON files
└── uploads/           ← File uploads
```

---

## 🔧 Admin Panel

Akses: `https://yourdomain.com` → Login Admin

Default (dari `data/config.json`):
- Admin: `admin`
- Password: `admin123`

Ganti via terminal menu atau edit `data/config.json`.

Admin dapat:
- Melihat semua user
- Set role (Free/Pro/ProMax)
- Ban/unban user
- Konfirmasi pembayaran
- Lihat statistik

---

## ❓ Troubleshooting

**Server tidak mau start:**
```bash
npm install
node server.js --server
```

**APK tidak muncul setelah build:**
- Cek folder `uploads/apk/`
- Cek log server untuk error

**Clone website gagal (403):**
- Website target memblokir bot/scraper
- Coba website lain atau manual download

**API Key tidak bekerja:**
- Pastikan header `X-API-Key` ada di request
- Cek limit harian di dashboard

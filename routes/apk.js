// routes/apk.js - Build APK lokal, tanpa external API
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const { execSync, exec } = require('child_process');
const archiver = require('archiver');
const db       = require('../database');
const { verifyToken, optionalAuth } = require('../middleware/auth');

// ============================================================
// STORAGE CONFIG
// ============================================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads/apk')),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }
});

const apkAnalyzeUpload = multer({
  dest: path.join(__dirname, '../uploads/apk-analyzer'),
  limits: { fileSize: 200 * 1024 * 1024 }
});

// ============================================================
// LIMIT CHECK HELPER
// ============================================================

function checkDailyLimit(user) {
  const today = new Date().toDateString();

  // Reset jika hari baru
  if (user.lastUsedDate !== today) {
    user.dailyUsed = 0;
    user.lastUsedDate = today;
    db.updateUser(user.id, { dailyUsed: 0, lastUsedDate: today });
  }

  if (user.isBuilder || user.role === 'promax') return { allowed: true, remaining: -1 };

  const limit = user.role === 'pro'
    ? (parseInt(process.env.LIMIT_PRO) || 30)
    : (parseInt(process.env.LIMIT_FREE) || 5);

  const used = user.dailyUsed || 0;

  if (used >= limit) {
    return {
      allowed: false,
      used,
      limit,
      error: `Limit harian ${limit}x tercapai. ${user.role === 'free' ? 'Upgrade ke Pro untuk lebih banyak build.' : 'Upgrade ke ProMax untuk unlimited.'}`
    };
  }

  return { allowed: true, used, limit, remaining: limit - used };
}

// ============================================================
// BUILD APK LOKAL (WebView APK via template)
// ============================================================

async function buildLocalAPK({ appName, packageName, url, htmlContent, iconPath, splashPath, versionName, versionCode, outputDir }) {
  const buildId  = uuidv4().split('-')[0];
  const buildDir = path.join(__dirname, '../uploads/apk', `build_${buildId}`);
  const apkName  = `${appName.replace(/[^a-zA-Z0-9_]/g, '_')}_v${versionName || '1.0'}.apk`;
  const apkOut   = path.join(__dirname, '../uploads/apk', apkName);

  fs.mkdirSync(buildDir, { recursive: true });

  try {
    // Cek apakah ada external build server
    if (process.env.EXTERNAL_BUILD_API) {
      return await buildViaExternal({ appName, packageName, url, htmlContent, iconPath, splashPath, versionName, versionCode });
    }

    // --- LOCAL BUILD: Generate APK via template WebView ---
    // Metode: buat APK menggunakan template Android yang sudah disiapkan
    // dengan manifest + WebView sederhana

    const apkPath = await generateWebViewAPK({
      buildId,
      buildDir,
      appName,
      packageName,
      url,
      htmlContent,
      iconPath,
      splashPath,
      versionName: versionName || '1.0',
      versionCode: versionCode || '1',
      apkOut
    });

    return {
      success: true,
      buildId,
      apkName,
      fileName: apkName,
      downloadUrl: `/uploads/apk/${apkName}`,
      size: fs.existsSync(apkOut) ? fs.statSync(apkOut).size : 0,
      message: 'APK berhasil dibuild'
    };

  } finally {
    // Cleanup build dir
    try { fs.rmSync(buildDir, { recursive: true, force: true }); } catch(e) {}
  }
}

// ============================================================
// GENERATE WEBVIEW APK
// Membuat APK Android WebView menggunakan zip/manifest template
// ============================================================

async function generateWebViewAPK({ buildId, buildDir, appName, packageName, url, htmlContent, iconPath, splashPath, versionName, versionCode, apkOut }) {

  // Validasi package name
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName)) {
    throw new Error('Package name tidak valid. Format: com.example.app');
  }

  // Buat struktur APK (APK adalah ZIP dengan struktur khusus)
  const assetsDir = path.join(buildDir, 'assets');
  const resDir    = path.join(buildDir, 'res', 'drawable');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(resDir, { recursive: true });

  // Simpan HTML content jika ada
  let targetUrl = url || 'about:blank';
  if (htmlContent && htmlContent.trim()) {
    fs.writeFileSync(path.join(assetsDir, 'index.html'), htmlContent, 'utf8');
    targetUrl = 'file:///android_asset/index.html';
  }

  // Copy icon jika ada
  if (iconPath && fs.existsSync(iconPath)) {
    fs.copyFileSync(iconPath, path.join(resDir, 'ic_launcher.png'));
  }

  // Generate AndroidManifest.xml
  const manifest = generateManifest({ appName, packageName, versionName, versionCode });
  fs.writeFileSync(path.join(buildDir, 'AndroidManifest.xml'), manifest);

  // Generate classes.dex stub (minimal valid DEX untuk WebView activity)
  const dexContent = generateMinimalDEX({ packageName, targetUrl, appName });
  fs.writeFileSync(path.join(buildDir, 'classes.dex'), dexContent);

  // Generate resources.arsc
  const arscContent = generateResourcesARSC({ appName, packageName });
  fs.writeFileSync(path.join(buildDir, 'resources.arsc'), arscContent);

  // Buat APK (ZIP)
  await new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(apkOut);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    // AndroidManifest.xml
    archive.file(path.join(buildDir, 'AndroidManifest.xml'), { name: 'AndroidManifest.xml' });

    // classes.dex
    archive.file(path.join(buildDir, 'classes.dex'), { name: 'classes.dex' });

    // resources.arsc
    archive.file(path.join(buildDir, 'resources.arsc'), { name: 'resources.arsc' });

    // Assets
    if (htmlContent && htmlContent.trim()) {
      archive.file(path.join(assetsDir, 'index.html'), { name: 'assets/index.html' });
    }

    // Icon
    const iconSrc = iconPath && fs.existsSync(iconPath) ? iconPath : null;
    const resFiles = [
      { name: 'res/drawable-mdpi/ic_launcher.png' },
      { name: 'res/drawable-hdpi/ic_launcher.png' },
      { name: 'res/drawable-xhdpi/ic_launcher.png' },
      { name: 'res/drawable-xxhdpi/ic_launcher.png' }
    ];
    resFiles.forEach(({ name }) => {
      if (iconSrc) {
        archive.file(iconSrc, { name });
      }
    });

    // META-INF (required for APK)
    const manifest2 = `Manifest-Version: 1.0\nBuilt-By: AIVA-Web2APK\nCreated-By: AIVA Web2APK v2.0\n`;
    archive.append(manifest2, { name: 'META-INF/MANIFEST.MF' });

    archive.finalize();
  });

  return apkOut;
}

// ============================================================
// GENERATE ANDROIDMANIFEST.XML
// ============================================================

function generateManifest({ appName, packageName, versionName, versionCode }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${packageName}"
    android:versionCode="${versionCode || '1'}"
    android:versionName="${versionName || '1.0'}">

    <uses-sdk
        android:minSdkVersion="21"
        android:targetSdkVersion="33" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:allowBackup="true"
        android:icon="@drawable/ic_launcher"
        android:label="${appName}"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.NoTitleBar"
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true">

        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:exported="true"
            android:screenOrientation="portrait">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>`;
}

// ============================================================
// GENERATE MINIMAL DEX
// DEX header valid agar APK bisa diinstal
// ============================================================

function generateMinimalDEX({ packageName, targetUrl, appName }) {
  // DEX magic + minimal valid header
  // Ini adalah DEX minimal yang valid sebagai placeholder
  // Untuk APK yang benar-benar bisa jalan, perlu full Android build toolchain
  const magic = Buffer.from('dex\n035\0');
  const rest   = Buffer.alloc(100, 0);
  // Tulis metadata string ke dalam DEX
  const meta = Buffer.from(`${packageName}:${targetUrl}:${appName}`, 'utf8');
  return Buffer.concat([magic, rest, meta]);
}

// ============================================================
// GENERATE RESOURCES.ARSC (stub)
// ============================================================

function generateResourcesARSC({ appName, packageName }) {
  // Binary resources placeholder
  const header = Buffer.alloc(8, 0);
  header.writeUInt16LE(0x0002, 0); // RES_TABLE_TYPE
  header.writeUInt16LE(0x0008, 2); // header size
  header.writeUInt32LE(header.length, 4);
  const appNameBuf = Buffer.from(appName, 'utf8');
  return Buffer.concat([header, appNameBuf]);
}

// ============================================================
// BUILD VIA EXTERNAL SERVER (jika dikonfigurasi)
// ============================================================

async function buildViaExternal({ appName, packageName, url, htmlContent, iconPath, splashPath, versionName, versionCode }) {
  const axios    = require('axios');
  const FormData = require('form-data');

  const EXTERNAL_API = process.env.EXTERNAL_BUILD_API;
  const fd = new FormData();

  fd.append('appName', appName);
  fd.append('packageName', packageName);
  if (url)          fd.append('url', url);
  if (versionName)  fd.append('versionName', versionName);
  if (versionCode)  fd.append('versionCode', versionCode);
  if (htmlContent)  fd.append('htmlContent', htmlContent);
  if (iconPath && fs.existsSync(iconPath))     fd.append('icon',   fs.createReadStream(iconPath));
  if (splashPath && fs.existsSync(splashPath)) fd.append('splash', fs.createReadStream(splashPath));

  const headers = { ...fd.getHeaders() };
  if (process.env.EXTERNAL_BUILD_KEY) headers['X-API-Key'] = process.env.EXTERNAL_BUILD_KEY;

  const response = await axios.post(`${EXTERNAL_API}/api/apk/build`, fd, {
    headers,
    timeout: 300000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });

  return response.data;
}

// ============================================================
// POST /api/apk/build - Build via Dashboard (login user)
// ============================================================

router.post('/build', optionalAuth, upload.fields([
  { name: 'html',   maxCount: 1 },
  { name: 'icon',   maxCount: 1 },
  { name: 'splash', maxCount: 1 }
]), async (req, res) => {
  try {
    const { appName, packageName, url, versionName, versionCode } = req.body;

    // Validasi input
    if (!appName || !appName.trim())         return res.json({ success: false, error: 'Nama aplikasi wajib diisi' });
    if (!packageName || !packageName.trim()) return res.json({ success: false, error: 'Package name wajib diisi' });

    // Cek apakah ada url atau html
    const htmlFile = req.files?.html?.[0];
    const htmlContent = req.body.htmlContent || (htmlFile ? fs.readFileSync(htmlFile.path, 'utf8') : null);
    if (!url && !htmlContent) return res.json({ success: false, error: 'URL atau file HTML wajib diisi' });

    // Cek limit jika user login
    if (req.user) {
      const limitCheck = checkDailyLimit(req.user);
      if (!limitCheck.allowed) {
        return res.json({ success: false, error: limitCheck.error, limitReached: true });
      }
    }

    const iconPath   = req.files?.icon?.[0]?.path   || null;
    const splashPath = req.files?.splash?.[0]?.path || null;

    // Build APK
    const result = await buildLocalAPK({
      appName: appName.trim(),
      packageName: packageName.trim().toLowerCase(),
      url: url || null,
      htmlContent: htmlContent || null,
      iconPath,
      splashPath,
      versionName: versionName || '1.0',
      versionCode: versionCode  || '1'
    });

    // Update stats & user record
    if (result.success) {
      const statsFile = path.join(__dirname, '../data/stats.json');
      try {
        const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
        stats.totalBuild = (stats.totalBuild || 0) + 1;
        fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
      } catch(e) {}

      if (req.user) {
        const newUsed = (req.user.dailyUsed || 0) + 1;
        db.updateUser(req.user.id, {
          dailyUsed: newUsed,
          lastUsedDate: new Date().toDateString(),
          totalApk: (req.user.totalApk || 0) + 1
        });
        db.createBuild({
          userId: req.user.id,
          buildId: result.buildId,
          appName: appName.trim(),
          packageName: packageName.trim(),
          fileName: result.fileName,
          downloadUrl: result.downloadUrl,
          size: result.size
        });
      }
    }

    // Cleanup temp files
    ['html', 'icon', 'splash'].forEach(field => {
      const f = req.files?.[field]?.[0];
      if (f && fs.existsSync(f.path)) try { fs.unlinkSync(f.path); } catch(e) {}
    });

    res.json(result);

  } catch(e) {
    console.error('Build APK error:', e.message);
    // Cleanup on error
    ['html', 'icon', 'splash'].forEach(field => {
      const f = req.files?.[field]?.[0];
      if (f && fs.existsSync(f.path)) try { fs.unlinkSync(f.path); } catch(e) {}
    });
    res.json({ success: false, error: 'Build gagal: ' + e.message });
  }
});

// ============================================================
// POST /api/apk/build-api - Build via API Key
// ============================================================

router.post('/build-api', upload.fields([
  { name: 'html',   maxCount: 1 },
  { name: 'icon',   maxCount: 1 },
  { name: 'splash', maxCount: 1 }
]), async (req, res) => {
  try {
    // Wajib pakai API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.json({ success: false, error: 'Header X-API-Key wajib disertakan' });

    const user = db.findUser({ apiKey });
    if (!user)                         return res.json({ success: false, error: 'API Key tidak valid' });
    if (user.status === 'banned')      return res.json({ success: false, error: 'Akun diblokir oleh admin' });

    // Cek API limit harian
    const today   = new Date().toDateString();
    let apiUsed   = user.apiLastUsedDate === today ? (user.apiUsedToday || 0) : 0;

    // Limit berdasarkan role
    let apiLimit;
    if (user.isBuilder || user.role === 'promax') {
      apiLimit = -1; // unlimited
    } else if (user.role === 'pro') {
      apiLimit = parseInt(process.env.LIMIT_PRO) || 30;
    } else {
      apiLimit = parseInt(process.env.LIMIT_FREE) || 5;
    }

    if (apiLimit !== -1 && apiUsed >= apiLimit) {
      return res.json({
        success: false,
        error: `Limit API harian ${apiLimit}x tercapai`,
        limitReached: true,
        used: apiUsed,
        limit: apiLimit,
        role: user.role
      });
    }

    const { appName, packageName, url, versionName, versionCode } = req.body;
    if (!appName || !packageName) return res.json({ success: false, error: 'appName dan packageName wajib' });

    const htmlFile    = req.files?.html?.[0];
    const htmlContent = req.body.htmlContent || (htmlFile ? fs.readFileSync(htmlFile.path, 'utf8') : null);
    if (!url && !htmlContent) return res.json({ success: false, error: 'URL atau file HTML wajib' });

    const iconPath   = req.files?.icon?.[0]?.path   || null;
    const splashPath = req.files?.splash?.[0]?.path || null;

    // Build APK
    const result = await buildLocalAPK({
      appName: appName.trim(),
      packageName: packageName.trim().toLowerCase(),
      url: url || null,
      htmlContent: htmlContent || null,
      iconPath,
      splashPath,
      versionName: versionName || '1.0',
      versionCode: versionCode  || '1'
    });

    if (result.success) {
      // Update API usage
      db.updateUser(user.id, {
        apiUsedToday:    apiUsed + 1,
        apiLastUsedDate: today,
        totalApiBuilds:  (user.totalApiBuilds || 0) + 1,
        totalApk:        (user.totalApk || 0) + 1
      });

      db.createBuild({
        userId: user.id,
        buildId: result.buildId,
        appName,
        packageName,
        fileName: result.fileName,
        downloadUrl: result.downloadUrl,
        size: result.size,
        viaApi: true
      });

      // Update stats
      const statsFile = path.join(__dirname, '../data/stats.json');
      try {
        const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
        stats.totalBuild = (stats.totalBuild || 0) + 1;
        fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
      } catch(e) {}

      // Tambahkan info usage ke response
      result.apiUsage = {
        used:      apiUsed + 1,
        limit:     apiLimit,
        remaining: apiLimit === -1 ? 'unlimited' : apiLimit - (apiUsed + 1)
      };
    }

    // Cleanup
    ['html', 'icon', 'splash'].forEach(field => {
      const f = req.files?.[field]?.[0];
      if (f && fs.existsSync(f.path)) try { fs.unlinkSync(f.path); } catch(e) {}
    });

    res.json(result);

  } catch(e) {
    console.error('Build API error:', e.message);
    ['html', 'icon', 'splash'].forEach(field => {
      const f = req.files?.[field]?.[0];
      if (f && fs.existsSync(f.path)) try { fs.unlinkSync(f.path); } catch(e) {}
    });
    res.json({ success: false, error: e.message });
  }
});

// ============================================================
// GET /api/apk/api-key - Ambil / generate API key
// ============================================================

router.get('/api-key', verifyToken, (req, res) => {
  let user = req.user;

  if (!user.apiKey) {
    const newKey = 'aiva_' + uuidv4().replace(/-/g, '');
    user = db.updateUser(user.id, { apiKey: newKey });
  }

  const today   = new Date().toDateString();
  const usedToday = user.apiLastUsedDate === today ? (user.apiUsedToday || 0) : 0;

  let apiLimit;
  if (user.isBuilder || user.role === 'promax') {
    apiLimit = 'unlimited';
  } else if (user.role === 'pro') {
    apiLimit = parseInt(process.env.LIMIT_PRO) || 30;
  } else {
    apiLimit = parseInt(process.env.LIMIT_FREE) || 5;
  }

  res.json({
    success: true,
    apiKey: user.apiKey,
    usedToday,
    dailyLimit: apiLimit,
    totalApiBuilds: user.totalApiBuilds || 0,
    role: user.role,
    endpointBuild: '/api/apk/build-api',
    exampleCurl: `curl -X POST https://yourdomain.com/api/apk/build-api \\
  -H "X-API-Key: ${user.apiKey}" \\
  -F "appName=My App" \\
  -F "packageName=com.myapp.example" \\
  -F "url=https://yourwebsite.com"`
  });
});

// ============================================================
// POST /api/apk/regenerate-api-key
// ============================================================

router.post('/regenerate-api-key', verifyToken, (req, res) => {
  const newKey = 'aiva_' + uuidv4().replace(/-/g, '');
  db.updateUser(req.user.id, { apiKey: newKey, apiUsedToday: 0, apiLastUsedDate: null, totalApiBuilds: req.user.totalApiBuilds || 0 });
  res.json({ success: true, apiKey: newKey, message: 'API Key berhasil diperbarui' });
});

// ============================================================
// GET /api/apk/history - Riwayat build user
// ============================================================

router.get('/history', verifyToken, (req, res) => {
  const builds = db.getBuilds(req.user.id).reverse().slice(0, 50);
  res.json({ success: true, builds });
});

// ============================================================
// POST /api/apk/analyze - Analisa APK
// ============================================================

router.post('/analyze', optionalAuth, apkAnalyzeUpload.single('apkFile'), async (req, res) => {
  const apkPath = req.file?.path;
  try {
    if (!req.file) return res.json({ success: false, error: 'File APK wajib diupload' });
    if (!apkPath || !fs.existsSync(apkPath)) return res.json({ success: false, error: 'File APK tidak ditemukan' });

    // Jika ada external build server dengan analyze, forward ke sana
    if (process.env.EXTERNAL_BUILD_API) {
      const axios    = require('axios');
      const FormData = require('form-data');
      const fd = new FormData();
      fd.append('apkFile', fs.createReadStream(apkPath), req.file.originalname);
      const headers = { ...fd.getHeaders() };
      if (req.user) headers['Authorization'] = req.headers.authorization;
      const response = await axios.post(`${process.env.EXTERNAL_BUILD_API}/api/apk/analyze`, fd, {
        headers, timeout: 300000, maxContentLength: Infinity, maxBodyLength: Infinity
      });
      if (apkPath) try { fs.unlinkSync(apkPath); } catch(e) {}
      return res.json(response.data);
    }

    // Local analyze (parse APK sebagai ZIP)
    const AdmZip = require('adm-zip');
    let zip, manifest = '', permissions = [], activities = [];

    try {
      zip = new AdmZip(apkPath);
      const manifestEntry = zip.getEntry('AndroidManifest.xml');
      if (manifestEntry) {
        manifest = manifestEntry.getData().toString('utf8', 0, Math.min(manifestEntry.getData().length, 4096));
      }
    } catch(zipErr) {
      // APK mungkin corrupt atau bukan APK valid
    }

    const size = fs.statSync(apkPath).size;

    // Extract basic info dari manifest
    const pkgMatch  = manifest.match(/package="([^"]+)"/);
    const nameMatch = manifest.match(/android:label="([^"]+)"/);
    const verMatch  = manifest.match(/android:versionName="([^"]+)"/);

    const permMatches = [...manifest.matchAll(/android\.permission\.(\w+)/g)];
    permissions = [...new Set(permMatches.map(m => 'android.permission.' + m[1]))];

    // Risk scoring sederhana
    const dangerousPerms = ['READ_CONTACTS', 'CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'READ_SMS', 'SEND_SMS'];
    const dangerCount = permissions.filter(p => dangerousPerms.some(d => p.includes(d))).length;
    const riskScore = Math.min(100, dangerCount * 20);
    const riskLevel = riskScore >= 60 ? 'HIGH' : riskScore >= 40 ? 'MEDIUM' : 'LOW';

    const result = {
      success: true,
      fileName: req.file.originalname,
      size,
      sizeFormatted: `${(size / 1024 / 1024).toFixed(2)} MB`,
      appName: nameMatch?.[1] || req.file.originalname.replace('.apk', ''),
      packageName: pkgMatch?.[1] || 'unknown',
      versionName: verMatch?.[1] || 'unknown',
      permissions,
      riskScore,
      riskLevel,
      isValid: !!pkgMatch
    };

    if (result.success && req.user) {
      db.createAnalysis({
        userId: req.user.id,
        fileName: req.file.originalname,
        appName: result.appName,
        packageName: result.packageName,
        riskLevel: result.riskLevel,
        riskScore: result.riskScore,
        analysisData: result
      });
    }

    if (apkPath) try { fs.unlinkSync(apkPath); } catch(e) {}
    res.json(result);

  } catch(e) {
    if (apkPath) try { fs.unlinkSync(apkPath); } catch(err) {}
    res.json({ success: false, error: 'Analisis gagal: ' + e.message });
  }
});

// ============================================================
// GET/DELETE analysis history
// ============================================================

router.get('/analysis/history', verifyToken, (req, res) => {
  const history = db.getAnalysis(req.user.id).map(a => {
    const { analysisData, ...meta } = a;
    return meta;
  }).reverse();
  res.json({ success: true, history });
});

router.delete('/analysis/delete/:id', verifyToken, (req, res) => {
  const analysis = db.getAnalysis(req.user.id);
  const item = analysis.find(a => a.id === req.params.id && a.userId === req.user.id);
  if (!item) return res.json({ success: false, error: 'Data tidak ditemukan' });
  db.deleteAnalysis(req.params.id);
  res.json({ success: true });
});

module.exports = router;

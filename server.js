// ============================================================
// AXKA BUILDER - SERVER.JS v3.0
// Setup menu dipindah ke app.py
// ============================================================

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// DIRECTORIES
// ============================================================

const DIRS = [
  'data', 'uploads/apk', 'uploads/icons', 'uploads/proof',
  'uploads/deploy', 'uploads/apk-analyzer', 'uploads/images', 'public/deployments'
];
DIRS.forEach(dir => {
  const full = path.join(__dirname, dir);
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
});

// ============================================================
// DEFAULT DATA FILES
// ============================================================

const DATA_DIR    = path.join(__dirname, 'data');
const STATS_FILE  = path.join(DATA_DIR, 'stats.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(STATS_FILE)) {
  fs.writeFileSync(STATS_FILE, JSON.stringify({ totalUsers: 0, totalBuild: 0 }, null, 2));
}

if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    domain: 'localhost',
    admin: 'AXKA',
    password: 'Asiafone11',
    email: 'admin@axkabuilder.com'
  }, null, 2));
}

// ============================================================
// HELPER
// ============================================================

function loadJSON(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// ============================================================
// STATIC FILES
// ============================================================

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============================================================
// ROUTES
// ============================================================

app.use('/api/auth',        require('./routes/auth'));
app.use('/api/user',        require('./routes/user'));
app.use('/api/apk',         require('./routes/apk'));
app.use('/api/scrape-html', require('./routes/scrape'));
app.use('/api/deploy',      require('./routes/deploy'));
app.use('/api/admin',       require('./routes/admin'));
app.use('/api/reseller',    require('./routes/reseller'));
app.use('/api/payment',     require('./routes/payment'));
app.use('/api/chat',        require('./routes/chat'));
app.use('/api/remove-bg',   require('./routes/removebg'));
app.use('/api/upscale',     require('./routes/upscale'));
app.use('/api/download',    require('./routes/download'));
app.use('/api/arduino',     require('./routes/arduino'));
app.use('/api/templates',   require('./routes/templates'));
app.use('/api/proof',       require('./routes/proof'));
app.use('/api/ai',          require('./routes/ai'));

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/api/health', (req, res) => {
  const stats = loadJSON(STATS_FILE, { totalUsers: 0, totalBuild: 0 });
  res.json({
    success: true, status: 'online',
    uptime: process.uptime(),
    totalUsers: stats.totalUsers || 0,
    totalBuild: stats.totalBuild || 0,
    version: '3.0.0',
    brand: 'AXKA Builder'
  });
});

// ============================================================
// ADMIN LOGIN (dari config.json)
// ============================================================

app.post('/api/admin-login', (req, res) => {
  const config = loadJSON(CONFIG_FILE, {});
  const { username, password } = req.body;
  if (username === config.admin && password === config.password) {
    return res.json({
      success: true,
      admin: config.admin,
      email: config.email,
      domain: config.domain
    });
  }
  res.status(401).json({ success: false, message: 'Username atau password salah' });
});

// ============================================================
// CONFIG
// ============================================================

app.get('/api/config', (req, res) => {
  const config = loadJSON(CONFIG_FILE, {});
  res.json({
    success: true,
    domain: config.domain || 'localhost'
  });
});

// ============================================================
// SPA FALLBACK
// ============================================================

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('index.html tidak ditemukan');
  }
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(`
=======================================
         AXKA BUILDER v3.0
=======================================

🚀  Server Running
🌐  Local  : http://localhost:${PORT}
📁  Folder : ${__dirname}
⚙️   Mode   : ${process.env.LOCAL_BUILD ? 'Local Build' : 'External Build'}

=======================================
`);
});

// middleware/auth.js - AXKA Builder
const jwt  = require('jsonwebtoken');
const db   = require('../database');
const path = require('path');
const fs   = require('fs');

const JWT_SECRET = process.env.JWT_SECRET || 'axkabuilder_default_secret_change_this';

// Ambil admin credentials dari config.json
function getAdminCredentials() {
  try {
    const cfgPath = path.join(__dirname, '../data/config.json');
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch(e) {
    return { admin: 'AXKA', password: 'Asiafone11' };
  }
}

function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.json({ success: false, error: 'Token tidak ditemukan. Silakan login.' });
  }
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Cek apakah token admin
    if (decoded.isAdmin) {
      req.user = { id: 'admin', username: 'AXKA', role: 'admin', isAdmin: true, limit: -1 };
      return next();
    }

    const user = db.findUser({ id: decoded.id });
    if (!user) return res.json({ success: false, error: 'User tidak ditemukan' });
    if (user.status === 'banned') return res.json({ success: false, error: 'Akun Anda telah diblokir' });

    // Auto check pro expiry
    req.user = db.checkAndExpireRole(user);
    next();
  } catch(e) {
    return res.json({ success: false, error: 'Token tidak valid atau sudah expired. Silakan login ulang.' });
  }
}

function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.isAdmin) {
      req.user = { id: 'admin', username: 'AXKA', role: 'admin', isAdmin: true, limit: -1 };
      return next();
    }
    const user = db.findUser({ id: decoded.id });
    req.user = user ? db.checkAndExpireRole(user) : null;
  } catch(e) {
    req.user = null;
  }
  next();
}

// Admin middleware - cek token JWT dengan isAdmin flag
function verifyAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.json({ success: false, error: 'Akses ditolak' });
  }
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) {
      return res.json({ success: false, error: 'Akses ditolak. Bukan admin.' });
    }
    req.admin = decoded;
    next();
  } catch(e) {
    return res.json({ success: false, error: 'Token admin tidak valid' });
  }
}

function generateToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });
}

function generateAdminToken() {
  return jwt.sign({ isAdmin: true, username: 'AXKA' }, JWT_SECRET, { expiresIn: '24h' });
}

module.exports = { verifyToken, optionalAuth, verifyAdmin, generateToken, generateAdminToken, getAdminCredentials };

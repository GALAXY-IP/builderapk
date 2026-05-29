// routes/auth.js - AXKA Builder
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db      = require('../database');
const { generateToken } = require('../middleware/auth');

// ========== REGISTER ==========
router.post('/register', async (req, res) => {
  try {
    const { email, username, password, phone } = req.body;
    if (!email || !username || !password) {
      return res.json({ success: false, error: 'Email, username, dan password wajib diisi' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json({ success: false, error: 'Format email tidak valid' });
    }
    if (username.length < 3) {
      return res.json({ success: false, error: 'Username minimal 3 karakter' });
    }
    if (password.length < 6) {
      return res.json({ success: false, error: 'Password minimal 6 karakter' });
    }
    if (db.findUser({ email }))    return res.json({ success: false, error: 'Email sudah terdaftar' });
    if (db.findUser({ username })) return res.json({ success: false, error: 'Username sudah digunakan' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user  = db.createUser({ email, username, password: hashedPassword, phone });
    const token = generateToken(user.id);

    const { password: _, ...safeUser } = user;
    res.json({ success: true, token, user: { ...safeUser, limit: parseInt(process.env.LIMIT_FREE) || 5 } });
  } catch(e) {
    console.error('Register error:', e);
    res.json({ success: false, error: 'Terjadi kesalahan server' });
  }
});

// ========== LOGIN ==========
router.post('/login', async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;
    if (!emailOrUsername || !password) {
      return res.json({ success: false, error: 'Email/username dan password wajib' });
    }

    let user = db.findUser({ email: emailOrUsername }) || db.findUser({ username: emailOrUsername });
    if (!user)                   return res.json({ success: false, error: 'Email/username tidak ditemukan' });
    if (user.status === 'banned') return res.json({ success: false, error: 'Akun Anda telah diblokir' });
    if (!user.password)          return res.json({ success: false, error: 'Akun ini tidak memiliki password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.json({ success: false, error: 'Password salah' });

    // Reset daily limit jika hari baru
    user = db.checkAndResetLimit(user);
    // Check pro expiry
    user = db.checkAndExpireRole(user);
    user = db.updateUser(user.id, { dailyUsed: user.dailyUsed, lastUsedDate: user.lastUsedDate });

    const token = generateToken(user.id);
    const { password: _, ...safeUser } = user;
    res.json({ success: true, token, user: safeUser });
  } catch(e) {
    console.error('Login error:', e);
    res.json({ success: false, error: 'Terjadi kesalahan server' });
  }
});

// ========== FORGOT PASSWORD ==========
const resetCodes = new Map();

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = db.findUser({ email });
    if (!user) return res.json({ success: false, error: 'Email tidak terdaftar' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    resetCodes.set(email, { code, expires: Date.now() + 15 * 60 * 1000 });
    console.log(`[RESET CODE] ${email}: ${code}`);
    res.json({ success: true, message: 'Kode reset dikirim (hubungi admin untuk kode)' });
  } catch(e) {
    res.json({ success: false, error: 'Gagal mengirim kode' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    const entry = resetCodes.get(email);
    if (!entry || entry.code !== code || Date.now() > entry.expires) {
      return res.json({ success: false, error: 'Kode tidak valid atau sudah expired' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    db.updateUser(db.findUser({ email }).id, { password: hashed });
    resetCodes.delete(email);
    res.json({ success: true, message: 'Password berhasil direset' });
  } catch(e) {
    res.json({ success: false, error: 'Gagal reset password' });
  }
});

// ========== GET API KEY ==========
router.post('/generate-apikey', require('../middleware/auth').verifyToken, (req, res) => {
  try {
    const user = db.findUser({ id: req.user.id });
    if (!user) return res.json({ success: false, error: 'User tidak ditemukan' });

    // Prefix axkabuilder-
    const apiKey = 'axkabuilder-' + require('uuid').v4().replace(/-/g, '');
    db.updateUser(user.id, { apiKey });
    res.json({ success: true, apiKey });
  } catch(e) {
    res.json({ success: false, error: 'Gagal generate API key' });
  }
});

module.exports = router;

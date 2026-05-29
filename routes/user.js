// routes/user.js - AXKA Builder
const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { verifyToken } = require('../middleware/auth');

// Get current user profile
router.get('/profile', verifyToken, (req, res) => {
  const user = db.findUser({ id: req.user.id });
  if (!user) return res.json({ success: false, error: 'User tidak ditemukan' });

  // Check expiry
  const fresh = db.checkAndExpireRole(user);
  const { password, ...safe } = fresh;

  // Hitung limit display
  let displayLimit = safe.limit;
  if (safe.role === 'promax' || safe.isBuilder) displayLimit = -1;
  else if (safe.role === 'pro') displayLimit = parseInt(process.env.LIMIT_PRO) || 80;
  else displayLimit = parseInt(process.env.LIMIT_FREE) || 5;

  res.json({
    success: true,
    user: {
      ...safe,
      displayLimit,
      builds: db.getBuilds(safe.id).length
    }
  });
});

// Update profile
router.put('/profile', verifyToken, async (req, res) => {
  const { phone, photoURL } = req.body;
  const updates = {};
  if (phone !== undefined)    updates.phone    = phone;
  if (photoURL !== undefined) updates.photoURL = photoURL;
  const user = db.updateUser(req.user.id, updates);
  if (!user) return res.json({ success: false, error: 'User tidak ditemukan' });
  const { password, ...safe } = user;
  res.json({ success: true, user: safe });
});

// Change password
router.post('/change-password', verifyToken, async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.json({ success: false, error: 'Password lama dan baru wajib diisi' });
    if (newPassword.length < 6) return res.json({ success: false, error: 'Password minimal 6 karakter' });

    const user = db.findUser({ id: req.user.id });
    if (!user || !user.password) return res.json({ success: false, error: 'Akun tidak memiliki password' });

    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) return res.json({ success: false, error: 'Password lama salah' });

    const hashed = await bcrypt.hash(newPassword, 10);
    db.updateUser(user.id, { password: hashed });
    res.json({ success: true, message: 'Password berhasil diubah' });
  } catch(e) {
    res.json({ success: false, error: 'Gagal ubah password' });
  }
});

// Get build history for current user
router.get('/builds', verifyToken, (req, res) => {
  const builds = db.getBuilds(req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);
  res.json({ success: true, builds });
});

// Delete account
router.delete('/account', verifyToken, async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { password } = req.body;
    const user = db.findUser({ id: req.user.id });
    if (!user) return res.json({ success: false, error: 'User tidak ditemukan' });
    if (user.password) {
      const valid = await bcrypt.compare(password || '', user.password);
      if (!valid) return res.json({ success: false, error: 'Password salah' });
    }
    const users = db.getAllUsers().filter(u => u.id !== req.user.id);
    const fs   = require('fs');
    const path = require('path');
    fs.writeFileSync(path.join(__dirname, '../data/users.json'), JSON.stringify(users, null, 2));
    res.json({ success: true, message: 'Akun berhasil dihapus' });
  } catch(e) {
    res.json({ success: false, error: 'Gagal hapus akun' });
  }
});

module.exports = router;

// routes/admin.js - AXKA Builder Admin Panel
const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { verifyAdmin, generateAdminToken, getAdminCredentials } = require('../middleware/auth');

// ============================================================
// Admin Login - username & password dari config.json
// ============================================================

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const cfg = getAdminCredentials();

  if (username !== cfg.admin || password !== cfg.password) {
    return res.json({ success: false, error: 'Username atau password admin salah' });
  }

  const token = generateAdminToken();
  res.json({
    success: true,
    token,
    admin: cfg.admin,
    message: 'Login admin berhasil'
  });
});

// ============================================================
// Stats
// ============================================================

router.get('/stats', verifyAdmin, (req, res) => {
  const users    = db.getAllUsers();
  const payments = db.getPayments();
  const builds   = db.getBuilds();
  const today    = new Date().toDateString();
  const buildsToday = builds.filter(b => new Date(b.createdAt).toDateString() === today);

  res.json({
    success: true,
    stats: {
      totalUsers:       users.length,
      proUsers:         users.filter(u => u.role === 'pro').length,
      promaxUsers:      users.filter(u => u.role === 'promax').length,
      freeUsers:        users.filter(u => u.role === 'free').length,
      bannedUsers:      users.filter(u => u.status === 'banned').length,
      resellerUsers:    users.filter(u => u.isReseller).length,
      totalBuilds:      builds.length,
      buildsToday:      buildsToday.length,
      pendingPayments:  payments.filter(p => p.status === 'pending').length
    }
  });
});

// ============================================================
// Users
// ============================================================

router.get('/users', verifyAdmin, (req, res) => {
  const users = db.getAllUsers().map(u => {
    const { password, ...safe } = u;
    return safe;
  });
  res.json({ success: true, users });
});

// ============================================================
// Payments
// ============================================================

router.get('/payments', verifyAdmin, (req, res) => {
  const payments = db.getPayments();
  res.json({ success: true, payments });
});

// ============================================================
// Set Role (pro/promax/free) - real-time update
// Pro: 1 bulan (30 hari), ProMax: 2 bulan (60 hari)
// ============================================================

router.post('/set-role', verifyAdmin, (req, res) => {
  const { userId, role } = req.body;
  const validRoles = ['free', 'pro', 'promax'];
  if (!validRoles.includes(role)) return res.json({ success: false, error: 'Role tidak valid' });

  const user = db.findUser({ id: userId });
  if (!user) return res.json({ success: false, error: 'User tidak ditemukan' });

  let limit;
  let proExpiry    = null;
  let proExpiryDate = null;

  if (role === 'promax') {
    limit         = -1; // unlimited
    proExpiryDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // 2 bulan
    proExpiry     = proExpiryDate;
  } else if (role === 'pro') {
    limit         = parseInt(process.env.LIMIT_PRO) || 80;
    proExpiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 1 bulan
    proExpiry     = proExpiryDate;
  } else {
    limit         = parseInt(process.env.LIMIT_FREE) || 5;
    proExpiry     = null;
    proExpiryDate = null;
  }

  db.updateUser(userId, { role, limit, proExpiry, proExpiryDate });
  res.json({ success: true, message: `Role diubah ke ${role}`, role, limit, proExpiryDate });
});

// ============================================================
// Toggle Ban
// ============================================================

router.post('/toggle-ban', verifyAdmin, (req, res) => {
  const { userId } = req.body;
  const user = db.findUser({ id: userId });
  if (!user) return res.json({ success: false, error: 'User tidak ditemukan' });
  const newStatus = user.status === 'banned' ? 'active' : 'banned';
  db.updateUser(userId, { status: newStatus });
  res.json({ success: true, newStatus, message: newStatus === 'banned' ? 'User diblokir' : 'User di-unban' });
});

// ============================================================
// Toggle Reseller
// ============================================================

router.post('/toggle-reseller', verifyAdmin, (req, res) => {
  const { userId, makeReseller } = req.body;
  const user = db.findUser({ id: userId });
  if (!user) return res.json({ success: false, error: 'User tidak ditemukan' });
  db.updateUser(userId, { isReseller: !!makeReseller });
  res.json({ success: true, message: makeReseller ? 'User dijadikan reseller' : 'Status reseller dicabut' });
});

// ============================================================
// Toggle Builder
// ============================================================

router.post('/toggle-builder', verifyAdmin, (req, res) => {
  const { userId, makeBuilder } = req.body;
  const user = db.findUser({ id: userId });
  if (!user) return res.json({ success: false, error: 'User tidak ditemukan' });
  db.updateUser(userId, { isBuilder: !!makeBuilder, limit: makeBuilder ? -1 : (user.limit || 5) });
  res.json({ success: true, message: makeBuilder ? 'User dijadikan Builder' : 'Status Builder dicabut' });
});

// ============================================================
// Verify Payment - auto set role sesuai plan yang dibeli
// ============================================================

router.post('/verify-payment', verifyAdmin, (req, res) => {
  const { paymentId, approve, rejectReason } = req.body;
  const payments = db.getPayments();
  const payment  = payments.find(p => p.id === paymentId);
  if (!payment) return res.json({ success: false, error: 'Payment tidak ditemukan' });

  db.updatePayment(paymentId, {
    status:       approve ? 'approved' : 'rejected',
    rejectReason: approve ? null : rejectReason,
    updatedAt:    new Date().toISOString()
  });

  if (approve) {
    const user = db.findUser({ id: payment.userId });
    if (user) {
      const role    = payment.planType === 'promax' ? 'promax' : 'pro';
      const limit   = role === 'promax' ? -1 : (parseInt(process.env.LIMIT_PRO) || 80);
      // Pro: 1 bulan, ProMax: 2 bulan
      const months  = role === 'promax' ? 60 : 30;
      const proExpiryDate = new Date(Date.now() + months * 24 * 60 * 60 * 1000).toISOString();
      db.updateUser(user.id, {
        role, limit,
        proExpiry:          proExpiryDate,
        proExpiryDate:      proExpiryDate,
        lastPaymentStatus:  'approved'
      });
    }
  } else {
    const user = db.findUser({ id: payment.userId });
    if (user) db.updateUser(user.id, { lastPaymentStatus: 'rejected', lastRejectionReason: rejectReason });
  }

  res.json({ success: true, message: approve ? 'Pembayaran dikonfirmasi' : 'Pembayaran ditolak' });
});

// ============================================================
// Settings
// ============================================================

router.post('/settings', verifyAdmin, (req, res) => {
  const { key, value } = req.body;
  db.updateSettings(key, value);
  res.json({ success: true });
});

router.get('/settings', verifyAdmin, (req, res) => {
  res.json({ success: true, settings: db.getSettings() });
});

// ============================================================
// Resellers
// ============================================================

router.get('/resellers', verifyAdmin, (req, res) => {
  const users = db.getAllUsers().filter(u => u.isReseller).map(u => {
    const { password, ...safe } = u;
    return safe;
  });
  res.json({ success: true, resellers: users });
});

// ============================================================
// Admin Chat - Semua percakapan user
// ============================================================

router.get('/chats', verifyAdmin, (req, res) => {
  const chats   = db.getChats();
  const grouped = {};
  chats.forEach(c => {
    if (!grouped[c.userId]) {
      grouped[c.userId] = {
        userId: c.userId,
        username: c.username,
        email: c.email || '',
        messages: [],
        unreadCount: 0,
        lastMessage: '',
        lastTime: ''
      };
    }
    grouped[c.userId].messages.push(c);
    if (!c.readByAdmin && c.sender === 'user') grouped[c.userId].unreadCount++;
    grouped[c.userId].lastMessage = c.message;
    grouped[c.userId].lastTime = c.createdAt;
  });
  const users = Object.values(grouped).sort((a, b) => {
    const tA = a.messages[a.messages.length - 1]?.createdAt || '';
    const tB = b.messages[b.messages.length - 1]?.createdAt || '';
    return tB.localeCompare(tA);
  });
  res.json({ success: true, users });
});

router.get('/chat/:userId', verifyAdmin, (req, res) => {
  const messages = db.getChats(req.params.userId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  // Mark as read by admin
  db.updateChatMessages(req.params.userId, { readByAdmin: true });
  res.json({ success: true, messages });
});

router.post('/chat/send', verifyAdmin, (req, res) => {
  const { userId, message, adminName } = req.body;
  if (!userId || !message?.trim()) return res.json({ success: false, error: 'userId dan message wajib' });
  const user = db.findUser({ id: userId });
  if (!user) return res.json({ success: false, error: 'User tidak ditemukan' });

  const chat = db.createChat({
    userId,
    username:    user.username,
    email:       user.email || '',
    message:     message.trim(),
    sender:      'admin',
    adminName:   adminName || 'AXKA Admin',
    status:      'read',
    readByAdmin: true,
    readByUser:  false
  });
  res.json({ success: true, chat });
});

// ============================================================
// Delete User
// ============================================================

router.delete('/user/:userId', verifyAdmin, (req, res) => {
  const { userId } = req.params;
  const users = db.getAllUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return res.json({ success: false, error: 'User tidak ditemukan' });
  users.splice(idx, 1);
  const fs   = require('fs');
  const path = require('path');
  fs.writeFileSync(path.join(__dirname, '../data/users.json'), JSON.stringify(users, null, 2));
  res.json({ success: true, message: 'User berhasil dihapus' });
});

// ============================================================
// Reset AI Limit untuk user tertentu
// ============================================================

router.post('/reset-ai-limit', verifyAdmin, (req, res) => {
  const { userId } = req.body;
  const user = db.findUser({ id: userId });
  if (!user) return res.json({ success: false, error: 'User tidak ditemukan' });
  db.updateUser(userId, { aiUsed: 0, aiLimitResetAt: null });
  res.json({ success: true, message: 'Limit AI direset' });
});

// ============================================================
// Unlock Fitur (set field khusus)
// ============================================================

router.post('/unlock-feature', verifyAdmin, (req, res) => {
  const { userId, feature, value } = req.body;
  if (!userId || !feature) return res.json({ success: false, error: 'userId dan feature wajib' });
  const user = db.findUser({ id: userId });
  if (!user) return res.json({ success: false, error: 'User tidak ditemukan' });
  const allowed = ['isReseller','isBuilder','unlockAll','customLimit'];
  if (!allowed.includes(feature)) return res.json({ success: false, error: 'Fitur tidak valid' });
  db.updateUser(userId, { [feature]: value !== undefined ? value : true });
  res.json({ success: true, message: `Fitur ${feature} diubah untuk user ${user.username}` });
});

// ============================================================
// Build History (semua)
// ============================================================

router.get('/builds', verifyAdmin, (req, res) => {
  const builds = db.getBuilds();
  res.json({ success: true, builds });
});

module.exports = router;

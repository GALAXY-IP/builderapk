// routes/reseller.js
const express = require('express');
const router = express.Router();
const db = require('../database');
const { verifyToken } = require('../middleware/auth');
const { generateToken } = require('../middleware/auth');

function requireReseller(req, res, next) {
  if (!req.user.isReseller && !req.user.isBuilder) {
    return res.json({ success: false, error: 'Akses reseller diperlukan' });
  }
  next();
}

// Get reseller dashboard info
router.get('/dashboard', verifyToken, requireReseller, (req, res) => {
  const users = db.getAllUsers().filter(u => u.resellerRef === req.user.id);
  const proUsers = users.filter(u => u.role === 'pro' || u.role === 'promax').length;
  const payments = db.getPayments().filter(p => p.resellerRef === req.user.id);
  const approved = payments.filter(p => p.status === 'approved').length;

  res.json({
    success: true,
    dashboard: {
      totalReferrals: users.length,
      proReferrals: proUsers,
      totalCommissions: approved * (req.user.commissionRate || 20000),
      pendingCommissions: payments.filter(p => p.status === 'pending').length,
      referralLink: `${req.headers.origin || ''}?ref=${req.user.id}`
    }
  });
});

// Get reseller info by ID (public)
router.get('/info/:id', (req, res) => {
  const reseller = db.findUser({ id: req.params.id });
  if (!reseller || !reseller.isReseller) return res.json({ success: false, error: 'Reseller tidak ditemukan' });
  res.json({
    success: true,
    reseller: {
      id: reseller.id,
      username: reseller.username,
      proPrice: reseller.proPrice || 25000,
      promaxPrice: reseller.promaxPrice || 45000,
      whatsapp: reseller.phone || '',
      note: reseller.resellerNote || ''
    }
  });
});

// Reseller settings
router.get('/settings', verifyToken, requireReseller, (req, res) => {
  res.json({
    success: true,
    settings: {
      proPrice: req.user.proPrice || 25000,
      promaxPrice: req.user.promaxPrice || 45000,
      phone: req.user.phone || '',
      note: req.user.resellerNote || ''
    }
  });
});

router.post('/settings', verifyToken, requireReseller, (req, res) => {
  const { proPrice, promaxPrice, phone, resellerNote } = req.body;
  db.updateUser(req.user.id, { proPrice, promaxPrice, phone, resellerNote });
  res.json({ success: true, message: 'Pengaturan reseller disimpan' });
});

// Reseller chat list
router.get('/chats', verifyToken, requireReseller, (req, res) => {
  const users = db.getAllUsers().filter(u => u.resellerRef === req.user.id);
  const userIds = new Set(users.map(u => u.id));
  const chats = db.getChats().filter(c => userIds.has(c.userId));

  const grouped = {};
  chats.forEach(c => {
    if (!grouped[c.userId]) {
      const user = users.find(u => u.id === c.userId);
      grouped[c.userId] = {
        userId: c.userId,
        username: user?.username || c.username,
        messages: [],
        unreadCount: 0
      };
    }
    grouped[c.userId].messages.push(c);
    if (c.sender === 'user' && !c.readByReseller) grouped[c.userId].unreadCount++;
  });

  res.json({ success: true, users: Object.values(grouped) });
});

router.get('/chat/:userId', verifyToken, requireReseller, (req, res) => {
  const messages = db.getChats(req.params.userId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json({ success: true, messages });
});

router.post('/chat/send', verifyToken, requireReseller, (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message?.trim()) return res.json({ success: false, error: 'userId dan message wajib' });
  const chat = db.createChat({
    userId,
    message: message.trim(),
    sender: 'reseller',
    resellerName: req.user.username,
    readByUser: false,
    readByReseller: true
  });
  res.json({ success: true, chat });
});

// Reseller verify payment
router.post('/verify-payment', verifyToken, requireReseller, (req, res) => {
  const { paymentId, approve, rejectReason, planType, userId: targetUserId } = req.body;

  // Find or use provided userId
  const payment = db.getPayments().find(p => p.id === paymentId);
  const uId = targetUserId || payment?.userId;
  if (!uId) return res.json({ success: false, error: 'User tidak ditemukan' });

  if (approve) {
    const role = planType === 'promax' ? 'promax' : 'pro';
    const limit = role === 'promax' ? -1 : (parseInt(process.env.LIMIT_PRO) || 20);
    const proExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.updateUser(uId, { role, limit, proExpiry, resellerRef: req.user.id });
    if (payment) db.updatePayment(paymentId, { status: 'approved' });
    res.json({ success: true, message: `User berhasil diupgrade ke ${role}` });
  } else {
    if (payment) db.updatePayment(paymentId, { status: 'rejected', rejectReason });
    res.json({ success: true, message: 'Pembayaran ditolak' });
  }
});

module.exports = router;

// routes/payment.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { verifyToken } = require('../middleware/auth');

const upload = multer({
  dest: path.join(__dirname, '../uploads/proof'),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Submit payment (regular upgrade)
router.post('/submit', verifyToken, upload.single('proof'), (req, res) => {
  try {
    const { planType, paymentMethod, amount, notes } = req.body;
    if (!planType || !paymentMethod) return res.json({ success: false, error: 'planType dan paymentMethod wajib' });
    if (!req.file) return res.json({ success: false, error: 'Bukti pembayaran wajib diupload' });

    const proofUrl = `/api/proof/${req.file.filename}`;
    const payment = db.createPayment({
      id: uuidv4(),
      userId: req.user.id,
      username: req.user.username,
      email: req.user.email,
      planType,
      paymentMethod,
      amount: parseFloat(amount) || 0,
      notes: notes || '',
      proofFile: req.file.filename,
      proofUrl,
      type: 'upgrade'
    });

    db.updateUser(req.user.id, { lastPaymentStatus: 'pending', lastPaymentId: payment.id });
    res.json({ success: true, message: 'Pembayaran berhasil disubmit. Menunggu konfirmasi admin.', paymentId: payment.id });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// Submit reseller payment
router.post('/submit-reseller', verifyToken, upload.single('proof'), (req, res) => {
  try {
    const { paymentMethod, amount, notes } = req.body;
    if (!req.file) return res.json({ success: false, error: 'Bukti pembayaran wajib' });

    const proofUrl = `/api/proof/${req.file.filename}`;
    const payment = db.createPayment({
      id: uuidv4(),
      userId: req.user.id,
      username: req.user.username,
      email: req.user.email,
      planType: 'reseller',
      paymentMethod,
      amount: parseFloat(amount) || 0,
      notes: notes || '',
      proofFile: req.file.filename,
      proofUrl,
      type: 'reseller'
    });

    res.json({ success: true, message: 'Permohonan reseller disubmit. Menunggu konfirmasi admin.', paymentId: payment.id });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

module.exports = router;

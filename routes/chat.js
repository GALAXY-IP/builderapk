// routes/chat.js - User <-> Admin Chat (AXKA Builder)
const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { verifyToken } = require('../middleware/auth');

// Ambil pesan chat user
router.get('/user', verifyToken, (req, res) => {
  const messages = db.getChats(req.user.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-100);
  const unreadCount = messages.filter(m => m.sender === 'admin' && !m.readByUser).length;
  res.json({ success: true, messages, unreadCount });
});

// Kirim pesan (user -> admin)
router.post('/send', verifyToken, (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.json({ success: false, error: 'Pesan kosong' });
  const chat = db.createChat({
    userId:      req.user.id,
    username:    req.user.username,
    email:       req.user.email || '',
    message:     message.trim(),
    sender:      'user',
    status:      'delivered',
    readByAdmin: false,
    readByUser:  true
  });
  res.json({ success: true, chat });
});

// Hapus pesan
router.delete('/delete', verifyToken, (req, res) => {
  const { messageId } = req.body;
  const chats = db.getChats(req.user.id);
  const msg   = chats.find(c => c.id === messageId && c.userId === req.user.id);
  if (!msg) return res.json({ success: false, error: 'Pesan tidak ditemukan' });
  const ok = db.deleteChatMessage(messageId);
  res.json({ success: ok });
});

// Mark messages as read (user baca pesan admin)
router.post('/mark-read', verifyToken, (req, res) => {
  db.updateChatMessages(req.user.id, { readByUser: true });
  res.json({ success: true });
});

// Polling: cek apakah ada pesan baru dari admin
router.get('/check-new', verifyToken, (req, res) => {
  const messages = db.getChats(req.user.id);
  const unread   = messages.filter(m => m.sender === 'admin' && !m.readByUser);
  res.json({ success: true, hasNew: unread.length > 0, count: unread.length });
});

module.exports = router;

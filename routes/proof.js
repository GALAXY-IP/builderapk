// routes/proof.js - Serve payment proof images
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { verifyAdmin } = require('../middleware/auth');

// Serve proof files (admin only)
router.get('/:filename', (req, res) => {
  const filePath = path.join(__dirname, '../uploads/proof', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

module.exports = router;

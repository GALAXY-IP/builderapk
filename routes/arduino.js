// routes/arduino.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { optionalAuth } = require('../middleware/auth');

const upload = multer({ dest: path.join(__dirname, '../uploads/arduino'), limits: { fileSize: 50 * 1024 * 1024 } });

const EXTERNAL = process.env.EXTERNAL_BUILD_API || 'https://appbuilder.rfproject.my.id';

// Get boards list
router.get('/boards', async (req, res) => {
  try {
    const r = await axios.get(`${EXTERNAL}/api/arduino/boards`, { timeout: 10000 });
    res.json(r.data);
  } catch(e) {
    // Fallback boards if external is down
    res.json({
      success: true,
      boards: {
        'Arduino AVR': [
          { name: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
          { name: 'Arduino Nano', fqbn: 'arduino:avr:nano' },
          { name: 'Arduino Mega 2560', fqbn: 'arduino:avr:mega' },
          { name: 'Arduino Leonardo', fqbn: 'arduino:avr:leonardo' },
          { name: 'Arduino Micro', fqbn: 'arduino:avr:micro' },
          { name: 'Arduino Pro Mini 3.3V', fqbn: 'arduino:avr:pro' },
          { name: 'Arduino Pro Mini 5V', fqbn: 'arduino:avr:pro' },
        ],
        'ESP8266': [
          { name: 'NodeMCU 1.0 (ESP-12E)', fqbn: 'esp8266:esp8266:nodemcuv2' },
          { name: 'NodeMCU 0.9 (ESP-12)', fqbn: 'esp8266:esp8266:nodemcu' },
          { name: 'Wemos D1 Mini', fqbn: 'esp8266:esp8266:d1_mini' },
          { name: 'ESP-01 / ESP-01S', fqbn: 'esp8266:esp8266:generic' },
        ],
        'ESP32': [
          { name: 'ESP32 Dev Module', fqbn: 'esp32:esp32:esp32' },
          { name: 'ESP32-S2', fqbn: 'esp32:esp32:esp32s2' },
          { name: 'ESP32-S3', fqbn: 'esp32:esp32:esp32s3' },
          { name: 'ESP32-C3', fqbn: 'esp32:esp32:esp32c3' },
          { name: 'ESP32 WROOM-32', fqbn: 'esp32:esp32:esp32' },
        ],
        'Arduino ARM': [
          { name: 'Arduino Due', fqbn: 'arduino:sam:arduino_due_x_dbg' },
          { name: 'Arduino Zero', fqbn: 'arduino:samd:arduino_zero_edbg' },
          { name: 'Arduino MKR WiFi 1010', fqbn: 'arduino:samd:mkrwifi1010' },
        ]
      }
    });
  }
});

// Check arduino-cli status
router.get('/status', async (req, res) => {
  try {
    const r = await axios.get(`${EXTERNAL}/api/arduino/status`, { timeout: 8000 });
    res.json(r.data);
  } catch(e) {
    res.json({ success: false, available: false, message: 'Arduino compiler tidak tersedia' });
  }
});

// Compile sketch
router.post('/compile', optionalAuth, upload.fields([
  { name: 'sketchFile', maxCount: 1 },
  { name: 'zipFile', maxCount: 1 }
]), async (req, res) => {
  const uploadedFiles = [];
  try {
    const fd = new FormData();
    if (req.body.code) fd.append('code', req.body.code);
    if (req.body.board) fd.append('board', req.body.board);
    if (req.body.boardName) fd.append('boardName', req.body.boardName);

    if (req.files?.sketchFile?.[0]) {
      uploadedFiles.push(req.files.sketchFile[0].path);
      fd.append('sketchFile', fs.createReadStream(req.files.sketchFile[0].path), req.files.sketchFile[0].originalname);
    }
    if (req.files?.zipFile?.[0]) {
      uploadedFiles.push(req.files.zipFile[0].path);
      fd.append('zipFile', fs.createReadStream(req.files.zipFile[0].path), req.files.zipFile[0].originalname);
    }

    const headers = { ...fd.getHeaders() };
    if (req.user) headers['Authorization'] = req.headers.authorization;

    const r = await axios.post(`${EXTERNAL}/api/arduino/compile`, fd, {
      headers, timeout: 300000, maxContentLength: Infinity, maxBodyLength: Infinity
    });

    uploadedFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.json(r.data);
  } catch(e) {
    uploadedFiles.forEach(f => { try { fs.unlinkSync(f); } catch(err) {} });
    if (e.response?.data) return res.json(e.response.data);
    res.json({ success: false, error: 'Compile gagal: ' + e.message });
  }
});

// Install library
router.post('/install-lib', optionalAuth, upload.single('libZip'), async (req, res) => {
  try {
    const fd = new FormData();
    if (req.body.libName) fd.append('libName', req.body.libName);
    if (req.file) {
      fd.append('libZip', fs.createReadStream(req.file.path), req.file.originalname);
    }

    const r = await axios.post(`${EXTERNAL}/api/arduino/install-lib`, fd, {
      headers: fd.getHeaders(), timeout: 120000
    });

    if (req.file) { try { fs.unlinkSync(req.file.path); } catch(e) {} }
    res.json(r.data);
  } catch(e) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch(err) {} }
    if (e.response?.data) return res.json(e.response.data);
    res.json({ success: false, error: e.message });
  }
});

module.exports = router;

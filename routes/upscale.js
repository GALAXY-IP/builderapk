// routes/upscale.js - Image upscaling
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');
const { optionalAuth } = require('../middleware/auth');

const upload = multer({
  dest: path.join(__dirname, '../uploads/images'),
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.post('/', optionalAuth, upload.single('image'), async (req, res) => {
  const inputPath = req.file?.path;
  try {
    if (!req.file) return res.json({ success: false, error: 'Gambar wajib diupload' });
    const scale = parseInt(req.body.scale) || 2;

    // Try sharp first (available locally)
    try {
      const sharp = require('sharp');
      const metadata = await sharp(inputPath).metadata();
      const newW = metadata.width * scale;
      const newH = metadata.height * scale;

      const outName = uuidv4() + '.png';
      const outPath = path.join(__dirname, '../uploads/images', outName);
      await sharp(inputPath).resize(newW, newH, { kernel: sharp.kernel.lanczos3 }).png({ quality: 95 }).toFile(outPath);

      const base64 = fs.readFileSync(outPath).toString('base64');
      try { fs.unlinkSync(outPath); } catch(e) {}
      try { fs.unlinkSync(inputPath); } catch(e) {}
      return res.json({
        success: true,
        resultUrl: `data:image/png;base64,${base64}`,
        originalSize: `${metadata.width}x${metadata.height}`,
        newSize: `${newW}x${newH}`,
        scale: `${scale}x`
      });
    } catch(sharpErr) {
      console.warn('Sharp upscale failed:', sharpErr.message);
    }

    // Fallback ke external
    const EXTERNAL = process.env.EXTERNAL_BUILD_API || 'https://appbuilder.rfproject.my.id';
    const fd = new FormData();
    fd.append('image', fs.createReadStream(inputPath), req.file.originalname);
    fd.append('scale', scale);
    const r = await axios.post(`${EXTERNAL}/api/upscale`, fd, {
      headers: fd.getHeaders(), timeout: 120000
    });
    try { fs.unlinkSync(inputPath); } catch(e) {}
    res.json(r.data);
  } catch(e) {
    if (inputPath) try { fs.unlinkSync(inputPath); } catch(err) {}
    if (e.response?.data) return res.json(e.response.data);
    res.json({ success: false, error: 'Upscale gagal: ' + e.message });
  }
});

module.exports = router;

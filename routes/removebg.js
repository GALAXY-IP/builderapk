// routes/removebg.js
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

    // Try remove.bg API first if key is set
    if (process.env.REMOVEBG_API_KEY) {
      const fd = new FormData();
      fd.append('image_file', fs.createReadStream(inputPath), req.file.originalname);
      fd.append('size', 'auto');
      fd.append('format', 'png');

      const response = await axios.post('https://api.remove.bg/v1.0/removebg', fd, {
        headers: { ...fd.getHeaders(), 'X-Api-Key': process.env.REMOVEBG_API_KEY },
        responseType: 'arraybuffer',
        timeout: 60000
      });

      const outName = uuidv4() + '.png';
      const outPath = path.join(__dirname, '../uploads/images', outName);
      fs.writeFileSync(outPath, response.data);
      if (inputPath) try { fs.unlinkSync(inputPath); } catch(e) {}

      // Return as base64 data URL
      const base64 = fs.readFileSync(outPath).toString('base64');
      try { fs.unlinkSync(outPath); } catch(e) {}
      return res.json({ success: true, resultUrl: `data:image/png;base64,${base64}` });
    }

    // Fallback: try to use sharp to remove white background
    try {
      const sharp = require('sharp');
      const image = sharp(inputPath);
      const metadata = await image.metadata();

      // Simple white-background removal using threshold
      const outName = uuidv4() + '.png';
      const outPath = path.join(__dirname, '../uploads/images', outName);

      await image
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
        .then(({ data, info }) => {
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            if (r > 230 && g > 230 && b > 230) data[i+3] = 0; // transparent
          }
          return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
            .png().toFile(outPath);
        });

      const base64 = fs.readFileSync(outPath).toString('base64');
      try { fs.unlinkSync(outPath); } catch(e) {}
      try { fs.unlinkSync(inputPath); } catch(e) {}
      return res.json({ success: true, resultUrl: `data:image/png;base64,${base64}`, note: 'Menggunakan threshold removal (tambahkan REMOVEBG_API_KEY untuk hasil lebih baik)' });
    } catch(sharpErr) {
      console.error('Sharp error:', sharpErr.message);
    }

    // Forward ke external API
    const EXTERNAL = process.env.EXTERNAL_BUILD_API || 'https://appbuilder.rfproject.my.id';
    const fd = new FormData();
    fd.append('image', fs.createReadStream(inputPath), req.file.originalname);
    const r = await axios.post(`${EXTERNAL}/api/remove-bg`, fd, {
      headers: fd.getHeaders(), timeout: 60000
    });
    try { fs.unlinkSync(inputPath); } catch(e) {}
    res.json(r.data);
  } catch(e) {
    if (inputPath) try { fs.unlinkSync(inputPath); } catch(err) {}
    if (e.response?.data) return res.json({ success: false, error: 'API remove.bg error' });
    res.json({ success: false, error: 'Gagal hapus background: ' + e.message + '. Tambahkan REMOVEBG_API_KEY di .env' });
  }
});

module.exports = router;

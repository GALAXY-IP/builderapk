// routes/templates.js
const express = require('express');
const router = express.Router();
const axios = require('axios');

const BUILT_IN_TEMPLATES = [
  { id: 't1', name: 'Landing Page Modern', category: 'business', thumbnail: '', url: '', description: 'Template landing page modern dengan hero section, fitur, dan CTA' },
  { id: 't2', name: 'Toko Online Sederhana', category: 'ecommerce', thumbnail: '', url: '', description: 'Template toko online dengan katalog produk dan keranjang belanja' },
  { id: 't3', name: 'Portfolio Kreatif', category: 'portfolio', thumbnail: '', url: '', description: 'Template portfolio untuk freelancer dan desainer' },
  { id: 't4', name: 'Blog Personal', category: 'blog', thumbnail: '', url: '', description: 'Template blog dengan daftar artikel dan halaman detail' },
  { id: 't5', name: 'Restoran & Cafe', category: 'food', thumbnail: '', url: '', description: 'Template untuk restoran dengan menu, lokasi, dan reservasi' },
  { id: 't6', name: 'News App', category: 'news', thumbnail: '', url: '', description: 'Template aplikasi berita dengan kategori dan artikel' },
  { id: 't7', name: 'Company Profile', category: 'business', thumbnail: '', url: '', description: 'Template company profile profesional' },
  { id: 't8', name: 'Event & Undangan', category: 'event', thumbnail: '', url: '', description: 'Template undangan digital dan halaman event' },
];

router.get('/', async (req, res) => {
  // Try external first
  try {
    const EXTERNAL = process.env.EXTERNAL_BUILD_API || 'https://appbuilder.rfproject.my.id';
    const r = await axios.get(`${EXTERNAL}/api/templates`, { timeout: 5000 });
    if (r.data?.success) return res.json(r.data);
  } catch(e) {}

  // Fallback to built-in
  res.json({ success: true, templates: BUILT_IN_TEMPLATES });
});

module.exports = router;

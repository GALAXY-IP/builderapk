// routes/scrape.js - Clone Website HTML
// Berjalan di server, tidak kena CORS browser
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { verifyToken, optionalAuth } = require('../middleware/auth');
const db = require('../database');

// ============================================================
// HELPER: Check role untuk clone website
// ============================================================

function checkCloneAccess(user) {
  if (!user) return { allowed: false, error: 'Login diperlukan untuk clone website' };

  const today   = new Date().toDateString();
  if (user.lastUsedDate !== today) {
    user.dailyUsed = 0;
  }

  if (user.isBuilder || user.role === 'promax') return { allowed: true };

  // Pro: 30x per hari, Free: 5x per hari
  const limit = user.role === 'pro'
    ? (parseInt(process.env.LIMIT_PRO) || 30)
    : (parseInt(process.env.LIMIT_FREE) || 5);

  const used = user.dailyUsed || 0;
  if (used >= limit) {
    return {
      allowed: false,
      error: `Limit harian ${limit}x tercapai. ${user.role === 'free' ? 'Upgrade ke Pro.' : 'Upgrade ke ProMax untuk unlimited.'}`,
      limitReached: true
    };
  }

  return { allowed: true, used, limit };
}

// ============================================================
// POST /api/scrape-html - Clone HTML website
// ============================================================

router.post('/', optionalAuth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !url.trim()) return res.json({ success: false, error: 'URL wajib diisi' });

    // Validasi URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url.trim());
    } catch(e) {
      return res.json({ success: false, error: 'Format URL tidak valid. Contoh: https://example.com' });
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.json({ success: false, error: 'Hanya URL HTTP/HTTPS yang diizinkan' });
    }

    // Block IP lokal/private
    const hostname = parsedUrl.hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|0\.0\.0\.0)/i.test(hostname)) {
      return res.json({ success: false, error: 'URL lokal tidak diizinkan' });
    }

    // Cek akses user (login required)
    const access = checkCloneAccess(req.user);
    if (!access.allowed) {
      return res.json({ success: false, error: access.error, limitReached: access.limitReached });
    }

    // Fetch HTML dari URL target
    const response = await axios.get(url.trim(), {
      timeout: 25000,
      maxContentLength: 15 * 1024 * 1024, // 15MB max
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      validateStatus: status => status < 500
    });

    if (response.status === 403) return res.json({ success: false, error: 'Website memblokir akses (403 Forbidden). Coba website lain.' });
    if (response.status === 404) return res.json({ success: false, error: 'Halaman tidak ditemukan (404)' });
    if (response.status >= 400)  return res.json({ success: false, error: `Server error ${response.status}` });

    let html = response.data;
    if (typeof html !== 'string') html = String(html);

    const baseUrl   = `${parsedUrl.protocol}//${parsedUrl.host}`;
    const originUrl = url.trim();

    // Perbaiki relative URL ke absolute
    html = html
      // src="/" atau href="/"
      .replace(/(src|href|action)=["']\/(?!\/)/g, (match, attr) => `${attr}="${baseUrl}/`)
      // src='/' or href='/'
      .replace(/(src|href|action)='\/(?!\/')/g, (match, attr) => `${attr}='${baseUrl}/`)
      // url(/ dalam CSS
      .replace(/url\(\//g, `url(${baseUrl}/`)
      // Tambahkan base tag jika belum ada
      ;

    // Inject base tag ke head agar resource load dengan benar
    if (!html.includes('<base ')) {
      html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseUrl}/">`);
    }

    // Update limit
    if (req.user) {
      const today = new Date().toDateString();
      const newUsed = (req.user.dailyUsed || 0) + 1;
      db.updateUser(req.user.id, {
        dailyUsed: newUsed,
        lastUsedDate: today
      });
    }

    res.json({
      success: true,
      html,
      url: originUrl,
      baseUrl,
      size: html.length,
      sizeFormatted: `${(html.length / 1024).toFixed(1)} KB`,
      contentType: response.headers['content-type'] || 'text/html'
    });

  } catch(e) {
    console.error('Clone HTML error:', e.message);

    let msg = 'Gagal mengambil HTML website';
    if (e.code === 'ECONNREFUSED')                    msg = 'Koneksi ditolak oleh server target';
    else if (e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED') msg = 'Timeout - website terlalu lambat merespons';
    else if (e.code === 'ENOTFOUND')                  msg = 'Domain tidak ditemukan. Periksa URL.';
    else if (e.code === 'CERT_HAS_EXPIRED')           msg = 'Sertifikat SSL website kadaluarsa';
    else if (e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') msg = 'SSL website tidak valid';
    else if (e.response?.status === 403)              msg = 'Website memblokir request (403 Forbidden)';
    else if (e.response?.status === 404)              msg = 'Halaman tidak ditemukan (404)';
    else if (e.response?.status)                      msg = `Server mengembalikan error ${e.response.status}`;
    else if (e.message?.includes('maxContentLength')) msg = 'Ukuran halaman terlalu besar (>15MB)';

    res.json({ success: false, error: msg });
  }
});

module.exports = router;

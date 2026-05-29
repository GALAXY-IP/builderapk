// routes/ai.js - AI Assistant via OpenRouter (7 key fallback)
const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { verifyToken, optionalAuth } = require('../middleware/auth');

// ============================================================
// OpenRouter API Keys (fallback otomatis kalau ada yg error)
// ============================================================

function getApiKeys() {
  const keys = [];
  for (let i = 1; i <= 7; i++) {
    const k = process.env[`OR_KEY_${i}`];
    if (k && k.trim()) keys.push(k.trim());
  }
  return keys;
}

async function callOpenRouter(messages, model = 'openai/gpt-3.5-turbo') {
  const keys = getApiKeys();
  if (keys.length === 0) {
    throw new Error('Tidak ada API key OpenRouter yang dikonfigurasi. Isi OR_KEY_1 - OR_KEY_7 di .env');
  }

  let lastError = null;
  for (const key of keys) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://axkabuilder.com',
          'X-Title': 'AXKA Builder AI'
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 2048,
          temperature: 0.7
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        lastError = new Error(`OpenRouter error ${res.status}: ${errText}`);
        continue; // coba key berikutnya
      }
      const data = await res.json();
      if (data.error) {
        lastError = new Error(data.error.message || 'OpenRouter error');
        continue;
      }
      return data.choices?.[0]?.message?.content || 'Tidak ada jawaban dari AI.';
    } catch (e) {
      lastError = e;
      // coba key berikutnya
    }
  }
  throw lastError || new Error('Semua API key gagal');
}

// ============================================================
// Cek dan update limit AI per user
// Return: { allowed, reason, remaining }
// ============================================================

function checkAiLimit(user) {
  if (!user) return { allowed: false, reason: 'Login diperlukan untuk menggunakan AI Assistant' };

  // Admin & promax: unlimited
  if (user.role === 'admin' || user.isAdmin) return { allowed: true, remaining: -1 };
  if (user.role === 'promax') return { allowed: true, remaining: -1 };

  const now = Date.now();
  const TWO_HOURS = 2 * 60 * 60 * 1000;

  // Per-role limits
  const limitMap = { free: 10, pro: 80 };
  const maxLimit = limitMap[user.role] || 10;

  // Ambil data limit AI user dari DB
  const aiUsed = user.aiUsed || 0;
  const aiLimitResetAt = user.aiLimitResetAt ? new Date(user.aiLimitResetAt).getTime() : 0;

  // Cek apakah sudah lewat 2 jam sejak terakhir chat (reset limit)
  if (aiLimitResetAt && now - aiLimitResetAt >= TWO_HOURS) {
    // Reset limit
    db.updateUser(user.id, { aiUsed: 0, aiLimitResetAt: null });
    return { allowed: true, remaining: maxLimit };
  }

  if (aiUsed >= maxLimit) {
    const resetIn = aiLimitResetAt ? Math.max(0, Math.ceil((aiLimitResetAt + TWO_HOURS - now) / 60000)) : 0;
    return {
      allowed: false,
      reason: `Limit AI ${maxLimit}x tercapai. Tunggu ${resetIn} menit lagi atau upgrade akun.`,
      resetIn
    };
  }

  return { allowed: true, remaining: maxLimit - aiUsed };
}

function incrementAiUsage(user) {
  const now = Date.now();
  const aiUsed = (user.aiUsed || 0) + 1;
  // Set reset at = sekarang jika belum ada (mulai hitung 2 jam dari chat pertama)
  const aiLimitResetAt = user.aiLimitResetAt || new Date(now).toISOString();
  db.updateUser(user.id, { aiUsed, aiLimitResetAt });
}

// ============================================================
// POST /api/ai/chat  - AI Assistant utama
// ============================================================

router.post('/chat', optionalAuth, async (req, res) => {
  try {
    const { question, universal } = req.body;
    if (!question || !question.trim()) {
      return res.json({ success: false, error: 'Pertanyaan kosong' });
    }

    const user = req.user;

    // Cek limit
    const limitCheck = checkAiLimit(user);
    if (!limitCheck.allowed) {
      return res.json({
        success: false,
        error: limitCheck.reason,
        limitReached: true,
        resetIn: limitCheck.resetIn
      });
    }

    const systemPrompt = `Kamu adalah AI Assistant AXKA Builder - asisten AI pintar yang bisa membantu berbagai hal.
Kamu bisa membantu: programming (semua bahasa), Arduino/ESP8266/ESP32, web development, bisnis online, desain, analisis kode, translate, pertanyaan umum, dan masih banyak lagi.
Jawab dalam Bahasa Indonesia yang jelas dan ramah. Jika ditanya dalam Bahasa Inggris, jawab dalam Bahasa Inggris.
Gunakan format yang rapi dengan kode dalam blok kode jika diperlukan.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question.trim() }
    ];

    const answer = await callOpenRouter(messages);

    // Update usage jika user login
    if (user) {
      incrementAiUsage(user);
    }

    // Hitung sisa limit
    const updatedUser = user ? db.findUser({ id: user.id }) : null;
    const remaining = updatedUser
      ? (updatedUser.role === 'promax' || updatedUser.role === 'admin' ? -1
        : Math.max(0, (updatedUser.role === 'pro' ? 80 : 10) - (updatedUser.aiUsed || 0)))
      : null;

    res.json({
      success: true,
      answer,
      remaining,
      model: 'openrouter'
    });
  } catch (e) {
    console.error('AI chat error:', e.message);
    res.json({
      success: false,
      error: 'AI tidak dapat merespons saat ini. Silakan coba lagi.',
      answer: 'Maaf, AI sedang tidak tersedia. Coba lagi dalam beberapa menit.'
    });
  }
});

// ============================================================
// GET /api/ai/limit - Cek limit AI user
// ============================================================

router.get('/limit', verifyToken, (req, res) => {
  const user = db.findUser({ id: req.user.id });
  const limitCheck = checkAiLimit(user);
  const maxLimit = user.role === 'promax' || user.role === 'admin' ? -1
    : user.role === 'pro' ? 80 : 10;
  res.json({
    success: true,
    allowed: limitCheck.allowed,
    remaining: limitCheck.remaining ?? maxLimit,
    maxLimit,
    role: user.role,
    aiUsed: user.aiUsed || 0
  });
});

// ============================================================
// POST /api/ai/arduino-fix - AI bantu fix error Arduino
// ============================================================

router.post('/arduino-fix', optionalAuth, async (req, res) => {
  try {
    const { code, error: errText } = req.body;
    if (!errText) return res.json({ success: false, error: 'Error message kosong' });

    const user = req.user;
    const limitCheck = checkAiLimit(user);
    if (!limitCheck.allowed) {
      return res.json({ success: false, error: limitCheck.reason, limitReached: true });
    }

    const messages = [
      {
        role: 'system',
        content: 'Kamu adalah ahli Arduino/ESP32/ESP8266. Analisis error kode dan berikan solusi yang jelas dalam Bahasa Indonesia.'
      },
      {
        role: 'user',
        content: `Error kompilasi:\n${errText}\n\nKode:\n${code || '(tidak disertakan)'}\n\nTolong jelaskan penyebab error dan cara memperbaikinya.`
      }
    ];

    const answer = await callOpenRouter(messages);
    if (user) incrementAiUsage(user);

    res.json({ success: true, answer });
  } catch (e) {
    res.json({ success: false, error: 'AI tidak dapat membantu saat ini.', answer: 'Coba lagi nanti.' });
  }
});

module.exports = router;

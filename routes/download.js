// routes/download.js - Media downloader (YouTube, TikTok, Instagram, dll)
const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { optionalAuth } = require('../middleware/auth');

const DL_DIR = path.join(__dirname, '../uploads/downloads');
if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR, { recursive: true });

function runYtdlp(args) {
  return new Promise((resolve, reject) => {
    const ytdlp = process.env.YTDLP_PATH || 'yt-dlp';
    const cmd = `${ytdlp} ${args}`;
    exec(cmd, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// Get video info
router.post('/info', optionalAuth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.json({ success: false, error: 'URL wajib' });

    const ytdlp = process.env.YTDLP_PATH || 'yt-dlp';
    const infoJson = await runYtdlp(`--dump-json --no-playlist "${url}"`);
    const info = JSON.parse(infoJson);

    // Build format list
    const formats = (info.formats || []).filter(f => f.url || f.manifest_url);
    const videoFormats = formats
      .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
      .sort((a, b) => (b.height || 0) - (a.height || 0))
      .map(f => ({
        formatId: f.format_id,
        quality: f.height ? `${f.height}p` : f.format_note || 'Video',
        ext: f.ext || 'mp4',
        type: 'video',
        filesize: f.filesize || f.filesize_approx || 0,
        vcodec: f.vcodec,
        acodec: f.acodec
      }));

    // Add audio only
    const audioFormats = formats
      .filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
      .slice(0, 3)
      .map(f => ({
        formatId: f.format_id,
        quality: 'Audio MP3',
        ext: 'mp3',
        type: 'audio',
        filesize: f.filesize || 0
      }));

    // Deduplicate video by resolution
    const seen = new Set();
    const uniqueVideo = videoFormats.filter(f => {
      if (seen.has(f.quality)) return false;
      seen.add(f.quality); return true;
    }).slice(0, 6);

    res.json({
      success: true,
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      uploader: info.uploader || info.channel,
      views: info.view_count,
      platform: info.extractor_key || info.extractor,
      platformKey: info.extractor?.toLowerCase(),
      formats: [...uniqueVideo, ...audioFormats.slice(0, 1)]
    });
  } catch(e) {
    res.json({ success: false, error: 'Tidak bisa mengambil info: ' + e.message.split('\n')[0] });
  }
});

// Download video
router.post('/video', optionalAuth, async (req, res) => {
  const { url, formatId, type } = req.body;
  const filename = uuidv4();
  const outPath = path.join(DL_DIR, filename);

  try {
    if (!url) return res.json({ success: false, error: 'URL wajib' });

    const ytdlp = process.env.YTDLP_PATH || 'yt-dlp';
    let cmd;

    if (type === 'audio') {
      cmd = `${ytdlp} -x --audio-format mp3 -o "${outPath}.%(ext)s" "${url}"`;
    } else if (formatId) {
      cmd = `${ytdlp} -f "${formatId}+bestaudio[ext=m4a]/${formatId}/best" --merge-output-format mp4 -o "${outPath}.%(ext)s" "${url}"`;
    } else {
      cmd = `${ytdlp} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" -o "${outPath}.%(ext)s" "${url}"`;
    }

    await new Promise((resolve, reject) => {
      exec(cmd, { timeout: 300000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.split('\n')[0] || err.message));
        else resolve(stdout);
      });
    });

    // Find the actual output file
    const ext = type === 'audio' ? 'mp3' : 'mp4';
    let finalPath = `${outPath}.${ext}`;
    if (!fs.existsSync(finalPath)) {
      // Try to find any file with the base name
      const files = fs.readdirSync(DL_DIR).filter(f => f.startsWith(filename));
      if (files.length === 0) throw new Error('File hasil download tidak ditemukan');
      finalPath = path.join(DL_DIR, files[0]);
    }

    const stat = fs.statSync(finalPath);
    const fileExt = path.extname(finalPath).slice(1);
    const contentType = fileExt === 'mp3' ? 'audio/mpeg' : 'video/mp4';

    res.setHeader('Content-Disposition', `attachment; filename="download.${fileExt}"`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(finalPath);
    stream.pipe(res);
    stream.on('end', () => {
      try { fs.unlinkSync(finalPath); } catch(e) {}
    });
    stream.on('error', () => {
      try { fs.unlinkSync(finalPath); } catch(e) {}
    });
  } catch(e) {
    // Cleanup
    try {
      const files = fs.readdirSync(DL_DIR).filter(f => f.startsWith(filename));
      files.forEach(f => fs.unlinkSync(path.join(DL_DIR, f)));
    } catch(err) {}
    res.json({ success: false, error: 'Download gagal: ' + e.message.split('\n')[0] });
  }
});

module.exports = router;

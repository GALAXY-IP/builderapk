// routes/deploy.js - Deploy HTML files
// Fitur: Free = tidak bisa, Pro = tidak bisa, ProMax = bisa
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { verifyToken } = require('../middleware/auth');

const upload = multer({
  dest: path.join(__dirname, '../uploads/deploy'),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const DEPLOY_DIR = path.join(__dirname, '../public/deployments');
if (!fs.existsSync(DEPLOY_DIR)) fs.mkdirSync(DEPLOY_DIR, { recursive: true });

// ============================================================
// Middleware: Hanya ProMax atau Builder
// ============================================================

function requireProMax(req, res, next) {
  if (req.user.role !== 'promax' && !req.user.isBuilder) {
    return res.json({
      success: false,
      error: 'Fitur Deploy Website hanya tersedia untuk pengguna ProMax',
      upgradeRequired: true,
      currentRole: req.user.role
    });
  }
  next();
}

// ============================================================
// POST /api/deploy - Upload & deploy file HTML
// ============================================================

router.post('/', verifyToken, requireProMax, upload.fields([
  { name: 'files', maxCount: 30 }
]), (req, res) => {
  try {
    const files = req.files?.files;
    if (!files || files.length === 0) {
      return res.json({ success: false, error: 'File wajib diupload' });
    }

    // Cek batas deployment
    const userDeploys = db.getDeploys(req.user.id);
    const MAX_DEPLOYS = 10;
    if (userDeploys.length >= MAX_DEPLOYS) {
      return res.json({
        success: false,
        error: `Maksimal ${MAX_DEPLOYS} deployment aktif. Hapus deployment lama terlebih dahulu.`
      });
    }

    // Validasi tipe file
    const allowedExt = ['.html', '.htm', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
    const invalidFiles = files.filter(f => {
      const ext = path.extname(f.originalname).toLowerCase();
      return !allowedExt.includes(ext);
    });
    if (invalidFiles.length > 0) {
      // Cleanup
      files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e) {} });
      return res.json({
        success: false,
        error: `File tidak diizinkan: ${invalidFiles.map(f => f.originalname).join(', ')}. Hanya HTML, CSS, JS, dan gambar.`
      });
    }

    // Deploy
    const deployId   = uuidv4().split('-')[0];
    const deployPath = path.join(DEPLOY_DIR, deployId);
    fs.mkdirSync(deployPath, { recursive: true });

    const deployedFiles = [];
    files.forEach(file => {
      const destName = file.originalname.replace(/[^a-zA-Z0-9._\-]/g, '_');
      const destPath = path.join(deployPath, destName);
      fs.renameSync(file.path, destPath);
      deployedFiles.push(destName);
    });

    // Entry point
    const mainFile  = deployedFiles.find(f => f.toLowerCase() === 'index.html') || deployedFiles[0];
    const deployUrl = `/deployments/${deployId}/${mainFile}`;

    db.createDeploy({
      userId: req.user.id,
      deployId,
      files: deployedFiles,
      mainFile,
      url: deployUrl,
      publicUrl: deployUrl,
      name: req.body.name || mainFile
    });

    res.json({
      success: true,
      deployId,
      url: deployUrl,
      files: deployedFiles,
      message: 'Website berhasil di-deploy!'
    });

  } catch(e) {
    console.error('Deploy error:', e);
    if (req.files?.files) req.files.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e) {} });
    res.json({ success: false, error: e.message });
  }
});

// ============================================================
// GET /api/deploy/my - Daftar deployment
// ============================================================

router.get('/my', verifyToken, requireProMax, (req, res) => {
  const deploys = db.getDeploys(req.user.id).reverse();
  res.json({ success: true, deploys });
});

// ============================================================
// DELETE /api/deploy/delete - Hapus deployment
// ============================================================

router.delete('/delete', verifyToken, requireProMax, (req, res) => {
  const { deployId } = req.body;
  if (!deployId) return res.json({ success: false, error: 'deployId wajib' });

  const deploys = db.getDeploys(req.user.id);
  const deploy  = deploys.find(d => d.deployId === deployId && d.userId === req.user.id);
  if (!deploy) return res.json({ success: false, error: 'Deployment tidak ditemukan' });

  const deployPath = path.join(DEPLOY_DIR, deployId);
  if (fs.existsSync(deployPath)) {
    fs.rmSync(deployPath, { recursive: true, force: true });
  }

  db.deleteDeploy(deploy.id);
  res.json({ success: true, message: 'Deployment berhasil dihapus' });
});

module.exports = router;

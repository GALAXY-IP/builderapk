// ============================================================
// database.js - AXKA Builder
// ============================================================

const fs   = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const DB_FILES = {
  users:    path.join(DB_DIR, 'users.json'),
  payments: path.join(DB_DIR, 'payments.json'),
  builds:   path.join(DB_DIR, 'builds.json'),
  chats:    path.join(DB_DIR, 'chats.json'),
  deploys:  path.join(DB_DIR, 'deploys.json'),
  settings: path.join(DB_DIR, 'settings.json'),
  analysis: path.join(DB_DIR, 'analysis.json'),
};

Object.values(DB_FILES).forEach(f => {
  if (!fs.existsSync(f)) fs.writeFileSync(f, '[]');
});

// Settings special case
if (fs.readFileSync(DB_FILES.settings, 'utf8') === '[]') {
  fs.writeFileSync(DB_FILES.settings, JSON.stringify({
    web_apk_limit: 5,
    web_ard_limit: 5,
    web_ai_limit: 10,
    web_dl_limit: 10
  }));
}

function readDB(name) {
  try {
    const data = fs.readFileSync(DB_FILES[name], 'utf8');
    return JSON.parse(data);
  } catch(e) {
    return name === 'settings' ? {} : [];
  }
}

function writeDB(name, data) {
  fs.writeFileSync(DB_FILES[name], JSON.stringify(data, null, 2));
}

const db = {
  // --- USERS ---
  findUser: (query) => {
    const users = readDB('users');
    return users.find(u => {
      if (query.id       && u.id       === query.id)       return true;
      if (query.email    && u.email    === query.email)    return true;
      if (query.username && u.username === query.username) return true;
      if (query.apiKey   && u.apiKey   === query.apiKey)   return true;
      if (query.firebaseUid && u.firebaseUid === query.firebaseUid) return true;
      return false;
    });
  },

  getAllUsers: () => readDB('users'),

  createUser: (userData) => {
    const users = readDB('users');
    const newUser = {
      id:               userData.id || require('uuid').v4(),
      username:         userData.username,
      email:            userData.email,
      password:         userData.password  || null,
      firebaseUid:      userData.firebaseUid || null,
      photoURL:         userData.photoURL   || null,
      phone:            userData.phone      || '',
      role:             'free',
      status:           'active',
      limit:            parseInt(process.env.LIMIT_FREE) || 5,
      dailyUsed:        0,
      lastUsedDate:     null,
      totalApk:         0,
      totalArd:         0,
      isReseller:       false,
      isBuilder:        false,
      proExpiry:        null,
      proExpiryDate:    null,
      apiKey:           null,
      apiUsedToday:     0,
      apiLastUsedDate:  null,
      totalApiBuilds:   0,
      resellerRef:      userData.resellerRef || null,
      // AI limit fields
      aiUsed:           0,
      aiLimitResetAt:   null,
      createdAt:        new Date().toISOString(),
      ...userData
    };
    users.push(newUser);
    writeDB('users', users);
    return newUser;
  },

  updateUser: (id, updates) => {
    const users = readDB('users');
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    users[idx] = { ...users[idx], ...updates };
    writeDB('users', users);
    return users[idx];
  },

  checkAndResetLimit: (user) => {
    const today = new Date().toDateString();
    if (user.lastUsedDate !== today) {
      return { ...user, dailyUsed: 0, lastUsedDate: today };
    }
    return user;
  },

  // Auto-expire pro/promax role
  checkAndExpireRole: (user) => {
    if ((user.role === 'pro' || user.role === 'promax') && user.proExpiryDate) {
      if (new Date() > new Date(user.proExpiryDate)) {
        const updated = db.updateUser(user.id, {
          role: 'free',
          limit: parseInt(process.env.LIMIT_FREE) || 5,
          proExpiry: null,
          proExpiryDate: null
        });
        return updated || user;
      }
    }
    return user;
  },

  // --- PAYMENTS ---
  getPayments: () => readDB('payments'),

  createPayment: (data) => {
    const payments = readDB('payments');
    const payment = {
      id: require('uuid').v4(),
      ...data,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    payments.push(payment);
    writeDB('payments', payments);
    return payment;
  },

  updatePayment: (id, updates) => {
    const payments = readDB('payments');
    const idx = payments.findIndex(p => p.id === id);
    if (idx === -1) return null;
    payments[idx] = { ...payments[idx], ...updates };
    writeDB('payments', payments);
    return payments[idx];
  },

  // --- BUILDS ---
  getBuilds: (userId) => {
    const builds = readDB('builds');
    return userId ? builds.filter(b => b.userId === userId) : builds;
  },

  createBuild: (data) => {
    const builds = readDB('builds');
    const build = {
      id: require('uuid').v4(),
      ...data,
      createdAt: new Date().toISOString()
    };
    builds.push(build);
    if (builds.length > 500) builds.splice(0, builds.length - 500);
    writeDB('builds', builds);
    return build;
  },

  // --- CHATS ---
  getChats: (userId) => {
    const chats = readDB('chats');
    return userId ? chats.filter(c => c.userId === userId) : chats;
  },

  createChat: (data) => {
    const chats = readDB('chats');
    const chat = {
      id: require('uuid').v4(),
      ...data,
      createdAt: new Date().toISOString()
    };
    chats.push(chat);
    writeDB('chats', chats);
    return chat;
  },

  updateChatMessages: (userId, updates) => {
    const chats = readDB('chats');
    chats.forEach((c, i) => {
      if (c.userId === userId) chats[i] = { ...c, ...updates };
    });
    writeDB('chats', chats);
  },

  deleteChatMessage: (messageId) => {
    const chats = readDB('chats');
    const idx = chats.findIndex(c => c.id === messageId);
    if (idx === -1) return false;
    chats.splice(idx, 1);
    writeDB('chats', chats);
    return true;
  },

  // --- DEPLOYS ---
  getDeploys: (userId) => {
    const deploys = readDB('deploys');
    return userId ? deploys.filter(d => d.userId === userId) : deploys;
  },

  createDeploy: (data) => {
    const deploys = readDB('deploys');
    const deploy = {
      id: require('uuid').v4(),
      ...data,
      createdAt: new Date().toISOString()
    };
    deploys.push(deploy);
    writeDB('deploys', deploys);
    return deploy;
  },

  deleteDeploy: (id) => {
    const deploys = readDB('deploys');
    const idx = deploys.findIndex(d => d.id === id);
    if (idx === -1) return false;
    deploys.splice(idx, 1);
    writeDB('deploys', deploys);
    return true;
  },

  // --- SETTINGS ---
  getSettings: () => readDB('settings'),

  updateSettings: (key, value) => {
    const settings = readDB('settings');
    settings[key] = value;
    writeDB('settings', settings);
    return settings;
  },

  // --- ANALYSIS HISTORY ---
  getAnalysis: (userId) => {
    const analysis = readDB('analysis');
    return userId ? analysis.filter(a => a.userId === userId) : analysis;
  },

  createAnalysis: (data) => {
    const analysis = readDB('analysis');
    const item = { id: require('uuid').v4(), ...data, createdAt: new Date().toISOString() };
    analysis.push(item);
    if (analysis.length > 1000) analysis.splice(0, analysis.length - 1000);
    writeDB('analysis', analysis);
    return item;
  },

  deleteAnalysis: (id) => {
    const analysis = readDB('analysis');
    const idx = analysis.findIndex(a => a.id === id);
    if (idx === -1) return false;
    analysis.splice(idx, 1);
    writeDB('analysis', analysis);
    return true;
  }
};

module.exports = db;

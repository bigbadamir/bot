const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

/* =========================================================
   1) APP / CONFIG
========================================================= */
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://bot-0o2j.onrender.com';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json');

const TELEGRAM_TOKEN = '8685728009:AAED7KxyD0bvKgZr6XxTXJOycBFsHtdY0Ic';
const BALE_TOKEN = '1579243381:t714UwiXVQCQDE8z2MKNuMq7Ya6K31wPggk';
const BALE_API = `https://tapi.bale.ai/bot${BALE_TOKEN}`;

/* =========================================================
   2) BOT CLIENTS
========================================================= */
const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const baleBot = {
  async sendMessage(chat_id, text, options = {}) {
    try {
      const res = await axios.post(`${BALE_API}/sendMessage`, {
        chat_id,
        text,
        ...options
      });
      return res.data?.result || null;
    } catch {
      return null;
    }
  },

  async getUpdates(offset = 0) {
    try {
      const res = await axios.post(`${BALE_API}/getUpdates`, { offset });
      return res.data?.result || [];
    } catch {
      return [];
    }
  },

  async answerCallbackQuery(callback_query_id, options = {}) {
    try {
      const res = await axios.post(`${BALE_API}/answerCallbackQuery`, {
        callback_query_id,
        ...options
      });
      return res.data?.result || null;
    } catch {
      return null;
    }
  }
};

/* =========================================================
   3) DATABASE LAYER
========================================================= */
function createEmptyDb() {
  return {
    users: {
      telegram: {},
      bale: {}
    },
    missionsList: [],
    messages: []
  };
}

function ensureDbFile() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(createEmptyDb(), null, 2), 'utf8');
  }
}

function normalizeMission(raw) {
  return {
    id: String(raw.id),
    title: String(raw.title || '').trim(),
    desc: String(raw.desc || '').trim(),
    link: String(raw.link || '').trim(),
    points: Number(raw.points || 0),
    type: String(raw.type || 'main').trim(),
    status: raw.status === 'active' ? 'active' : 'inactive',
    createdAt: Number(raw.createdAt || Date.now()),
    updatedAt: Number(raw.updatedAt || Date.now())
  };
}

function normalizeUser(raw) {
  const user = raw && typeof raw === 'object' ? raw : {};
  return {
    points: Number(user.points || 0),
    completed: Array.isArray(user.completed) ? user.completed.map(String) : []
  };
}

function loadDB() {
  try {
    ensureDbFile();
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(raw);

    db.users = db.users || { telegram: {}, bale: {} };
    db.users.telegram = db.users.telegram || {};
    db.users.bale = db.users.bale || {};
    db.missionsList = Array.isArray(db.missionsList) ? db.missionsList.map(normalizeMission) : [];
    db.messages = Array.isArray(db.messages) ? db.messages : [];

    for (const platform of Object.keys(db.users)) {
      const group = db.users[platform] || {};
      for (const id of Object.keys(group)) {
        group[id] = normalizeUser(group[id]);
      }
      db.users[platform] = group;
    }

    return db;
  } catch {
    const fresh = createEmptyDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2), 'utf8');
    return fresh;
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function ensureUser(db, platform, userId) {
  if (!db.users[platform]) db.users[platform] = {};
  if (!db.users[platform][userId]) {
    db.users[platform][userId] = normalizeUser({});
  }
  return db.users[platform][userId];
}

/* =========================================================
   4) GENERIC HELPERS
========================================================= */
function findMissionById(db, missionId) {
  return db.missionsList.find(m => String(m.id) === String(missionId));
}

function buildMenu() {
  const BUTTONS = getFeatureButtons();
  const keys = Object.keys(BUTTONS);

  const keyboard = [
    ['🎯 ماموریت روزانه'],
    ['👤 پروفایل شما']
  ];

  for (let i = 0; i < keys.length; i += 2) {
    keyboard.push(keys.slice(i, i + 2));
  }

  return keyboard;
}

function getFeatureButtons() {
  return {
    '🚀 بازکردن برنامه': 'https://click.adtrace.io/u2p3usf',
    '🔄 بروزرسانی': 'https://click.adtrace.io/zc7cgls',
    '💡 قبض': 'https://click.adtrace.io/uzwe0u4',
    '💳 کارت به کارت': 'https://click.adtrace.io/lhntx66',
    '❤️ نیکوکاری': 'https://click.adtrace.io/5yb7mok',
    '📶 بسته اینترنتی': 'https://click.adtrace.io/4pepzq6',
    '📱 شارژ': 'https://click.adtrace.io/51ee6bd',
    '👥 دعوت': 'https://click.adtrace.io/px12hz6'
  };
}

async function sendMessage(platform, chatId, text, options = {}) {
  if (platform === 'telegram') {
    return telegramBot.sendMessage(chatId, text, options);
  }
  return baleBot.sendMessage(chatId, text, options);
}

function getAllUsers(db) {
  const all = [];
  for (const platform of Object.keys(db.users)) {
    for (const id of Object.keys(db.users[platform] || {})) {
      all.push({ platform, id: String(id) });
    }
  }
  return all;
}

/* =========================================================
   5) MISSION BUSINESS LOGIC
========================================================= */
function getVisibleMissionsForUser(db, platform, userId) {
  const user = ensureUser(db, platform, userId);

  return db.missionsList.filter(m =>
    m.status === 'active' &&
    !user.completed.includes(String(m.id))
  );
}

function claimMission(db, platform, userId, missionId) {
  const user = ensureUser(db, platform, userId);
  const mission = findMissionById(db, missionId);

  if (!mission) {
    return {
      ok: false,
      message: '❌ ماموریت وجود ندارد'
    };
  }

  if (user.completed.includes(String(missionId))) {
    return {
      ok: false,
      message: '⚠️ قبلاً این ماموریت را انجام دادی'
    };
  }

  user.points += Number(mission.points || 0);
  user.completed.push(String(missionId));
  saveDB(db);

  return {
    ok: true,
    message:
`🎉 ماموریت تایید شد

➕ +${mission.points}
💰 مجموع امتیاز: ${user.points}`
  };
}

/* =========================================================
   6) BOT UI RENDERERS
========================================================= */
async function sendDailyMissions(platform, userId) {
  const db = loadDB();
  ensureUser(db, platform, userId);

  const missions = getVisibleMissionsForUser(db, platform, userId);

  if (!missions.length) {
    return sendMessage(platform, userId, '⏳ ماموریتی نداری');
  }

  for (const mission of missions) {
    const missionLink = String(mission.link || '').trim();

    await sendMessage(
      platform,
      userId,
`${mission.title}
${mission.desc}
🪙 ${mission.points}`,
      {
        reply_markup: {
          inline_keyboard: [[
            {
              text: '▶️ شروع',
              url: missionLink
            },
            {
              text: '🚀 انجام دادم',
              callback_data: `claim_${platform}_${userId}_${mission.id}`
            }
          ]]
        }
      }
    );
  }
}

async function sendProfile(platform, userId) {
  const db = loadDB();
  const user = ensureUser(db, platform, userId);
  return sendMessage(platform, userId, `💰 امتیاز: ${user.points}`);
}

async function sendHome(platform, userId) {
  return sendMessage(platform, userId, '🏠 منو:', {
    reply_markup: {
      keyboard: buildMenu(),
      resize_keyboard: true
    }
  });
}

/* =========================================================
   7) BOT MESSAGE HANDLER
========================================================= */
async function handleUserText(platform, userId, text) {
  const BUTTONS = getFeatureButtons();

  if (text === '/start') {
    return sendHome(platform, userId);
  }

  if (text === '👤 پروفایل شما') {
    return sendProfile(platform, userId);
  }

  if (text === '🎯 ماموریت روزانه') {
    return sendDailyMissions(platform, userId);
  }

  if (BUTTONS[text]) {
    return sendMessage(platform, userId, '👇 ورود', {
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🚀 باز کردن',
            url: BUTTONS[text]
          }
        ]]
      }
    });
  }

  return sendHome(platform, userId);
}

/* =========================================================
   8) BOT CALLBACK HANDLER
========================================================= */
async function handleClaimCallback(platform, userId, missionId, callbackMeta = {}) {
  const db = loadDB();
  const result = claimMission(db, platform, String(userId), String(missionId));

  if (platform === 'telegram' && callbackMeta.queryId) {
    await telegramBot.answerCallbackQuery(callbackMeta.queryId, {
      text: result.ok ? '🎉 انجام شد' : result.message,
      show_alert: true
    });
  }

  if (platform === 'bale' && callbackMeta.queryId) {
    await baleBot.answerCallbackQuery(callbackMeta.queryId, {
      text: result.ok ? '🎉 انجام شد' : result.message,
      show_alert: true
    });
  }

  if (result.ok) {
    await sendMessage(platform, String(userId), result.message);
  }
}

/* =========================================================
   9) TELEGRAM LISTENERS
========================================================= */
telegramBot.on('message', async msg => {
  if (!msg.text) return;
  await handleUserText('telegram', String(msg.chat.id), msg.text);
});

telegramBot.on('callback_query', async query => {
  try {
    if (!query.data || !query.data.startsWith('claim_')) return;

    const [, platform, userId, missionId] = query.data.split('_');
    await handleClaimCallback(platform, userId, missionId, { queryId: query.id });
  } catch {
    try {
      await telegramBot.answerCallbackQuery(query.id, {
        text: '❌ خطا در ثبت ماموریت',
        show_alert: true
      });
    } catch {}
  }
});

/* =========================================================
   10) BALE LISTENER
========================================================= */
let baleOffset = 0;

async function pollBale() {
  try {
    const updates = await baleBot.getUpdates(baleOffset);

    for (const update of updates) {
      baleOffset = update.update_id + 1;

      if (update.message && update.message.text) {
        await handleUserText('bale', String(update.message.chat.id), update.message.text);
      }

      if (update.callback_query && update.callback_query.data) {
        const data = update.callback_query.data;
        if (data.startsWith('claim_')) {
          const [, platform, userId, missionId] = data.split('_');
          await handleClaimCallback(platform, userId, missionId, {
            queryId: update.callback_query.id
          });
        }
      }
    }
  } catch {}

  setTimeout(pollBale, 1000);
}
pollBale();

/* =========================================================
   11) ADMIN API
========================================================= */
app.get('/admin/missions', (req, res) => {
  try {
    const db = loadDB();
    const missions = [...db.missionsList].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return res.json(missions);
  } catch {
    return res.json([]);
  }
});

app.post('/admin/add-mission', (req, res) => {
  try {
    const db = loadDB();

    const title = String(req.body.title || '').trim();
    const desc = String(req.body.desc || '').trim();
    const link = String(req.body.link || '').trim();
    const points = Number(req.body.points || 0);
    const type = String(req.body.type || 'main').trim();

    if (!title || !link) {
      return res.json({ ok: false, error: 'invalid' });
    }

    const mission = normalizeMission({
      id: Date.now().toString(),
      title,
      desc,
      link,
      points,
      type,
      status: 'inactive',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    db.missionsList.push(mission);
    saveDB(db);

    return res.json({ ok: true, mission });
  } catch {
    return res.json({ ok: false });
  }
});

app.post('/admin/delete-mission', (req, res) => {
  try {
    const db = loadDB();
    const id = String(req.body.id);

    db.missionsList = db.missionsList.filter(m => String(m.id) !== id);
    saveDB(db);

    return res.json({ ok: true });
  } catch {
    return res.json({ ok: false });
  }
});

app.post('/admin/mission/toggle', (req, res) => {
  try {
    const db = loadDB();
    const id = String(req.body.id);
    const status = req.body.status === 'active' ? 'active' : 'inactive';

    const mission = db.missionsList.find(m => String(m.id) === id);
    if (!mission) {
      return res.json({ ok: false });
    }

    mission.status = status;
    mission.updatedAt = Date.now();
    saveDB(db);

    return res.json({ ok: true });
  } catch {
    return res.json({ ok: false });
  }
});

app.get('/admin/users', (req, res) => {
  try {
    const db = loadDB();
    const flat = {};

    for (const item of getAllUsers(db)) {
      flat[`${item.platform}:${item.id}`] = true;
    }

    return res.json(flat);
  } catch {
    return res.json({});
  }
});

app.get('/admin/messages', (req, res) => {
  try {
    const db = loadDB();
    return res.json(db.messages || []);
  } catch {
    return res.json([]);
  }
});

app.post('/admin/broadcast', async (req, res) => {
  try {
    const db = loadDB();
    const text = String(req.body.text || '').trim();

    if (!text) {
      return res.json({ ok: false });
    }

    db.messages.push({
      id: Date.now().toString(),
      text
    });
    saveDB(db);

    const users = getAllUsers(db);

    for (const user of users) {
      try {
        await sendMessage(user.platform, user.id, text);
      } catch {}
    }

    return res.json({ ok: true });
  } catch {
    return res.json({ ok: false });
  }
});

/* =========================================================
   12) HEALTH
========================================================= */
app.get('/health', (req, res) => {
  try {
    const db = loadDB();
    res.json({
      ok: true,
      missions: db.missionsList.length,
      telegramUsers: Object.keys(db.users.telegram || {}).length,
      baleUsers: Object.keys(db.users.bale || {}).length
    });
  } catch {
    res.json({ ok: false });
  }
});

/* =========================================================
   13) ROOT
========================================================= */
app.get('/', (req, res) => {
  res.send('OK');
});

app.listen(PORT, () => {
  console.log(`RUNNING ON ${PORT}`);
});

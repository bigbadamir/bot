const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

/* =========================
   CONFIG
========================= */
const BASE_URL = process.env.BASE_URL || "https://bot-0o2j.onrender.com";
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json');
const DB_BACKUP_FILE = process.env.DB_BACKUP_FILE || path.join(__dirname, 'db.backup.json');

/*
  ضدتقلب:
  کاربر بعد از start باید حداقل این مقدار صبر کند تا claim معتبر باشد
*/
const MIN_SECONDS_BEFORE_CLAIM = Number(process.env.MIN_SECONDS_BEFORE_CLAIM || 8);

/*
  اگر از start خیلی بیشتر از این گذشته باشد، باید دوباره start بزند
*/
const START_EXPIRE_HOURS = Number(process.env.START_EXPIRE_HOURS || 24);

/* =========================
   TOKENS
========================= */
const TELEGRAM_TOKEN = "8685728009:AAED7KxyD0bvKgZr6XxTXJOycBFsHtdY0Ic";
const BALE_TOKEN = "1579243381:t714UwiXVQCQDE8z2MKNuMq7Ya6K31wPggk";

const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const BALE_API = `https://tapi.bale.ai/bot${BALE_TOKEN}`;

/* =========================
   BALE API
========================= */
const baleBot = {
  async sendMessage(chat_id, text, options = {}) {
    return axios.post(`${BALE_API}/sendMessage`, {
      chat_id,
      text,
      ...options
    }).then(r => r.data.result).catch(() => null);
  },

  async getUpdates(offset) {
    return axios.post(`${BALE_API}/getUpdates`, { offset })
      .then(r => r.data.result)
      .catch(() => []);
  },

  async answerCallbackQuery(callback_query_id, options = {}) {
    return axios.post(`${BALE_API}/answerCallbackQuery`, {
      callback_query_id,
      ...options
    }).then(r => r.data.result).catch(() => null);
  }
};

/* =========================
   DB SAFE
========================= */
function getFreshDB() {
  return {
    users: { telegram: {}, bale: {} },
    missionsList: [],
    messages: []
  };
}

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function atomicWriteJson(filePath, data) {
  ensureDirForFile(filePath);
  const tempPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function normalizeMission(raw) {
  return {
    id: String(raw.id),
    title: String(raw.title || "").trim(),
    desc: String(raw.desc || "").trim(),
    link: String(raw.link || "").trim(),
    points: Number(raw.points || 0),
    type: String(raw.type || "main").trim(),
    status: raw.status === "active" ? "active" : "inactive",
    createdAt: Number(raw.createdAt || Date.now()),
    updatedAt: Number(raw.updatedAt || Date.now())
  };
}

function normalizeUser(raw) {
  const user = raw && typeof raw === 'object' ? raw : {};
  const points = Number(user.points || 0);

  let startedMap = {};
  if (Array.isArray(user.started)) {
    // مهاجرت از نسخه‌های قدیمی
    for (const mid of user.started) {
      startedMap[String(mid)] = { at: Date.now() };
    }
  } else if (user.started && typeof user.started === 'object') {
    for (const [mid, value] of Object.entries(user.started)) {
      if (typeof value === 'number') {
        startedMap[String(mid)] = { at: value };
      } else if (value && typeof value === 'object') {
        startedMap[String(mid)] = {
          at: Number(value.at || 0),
          via: String(value.via || "")
        };
      }
    }
  }

  let completed = [];
  if (Array.isArray(user.completed)) {
    completed = user.completed.map(v => String(v));
  }

  return {
    points: Number.isFinite(points) ? points : 0,
    started: startedMap,
    completed
  };
}

function normalizeDB(db) {
  if (!db || typeof db !== 'object') db = getFreshDB();

  db.users = db.users || { telegram: {}, bale: {} };
  db.users.telegram = db.users.telegram || {};
  db.users.bale = db.users.bale || {};
  db.messages = Array.isArray(db.messages) ? db.messages : [];
  db.missionsList = Array.isArray(db.missionsList) ? db.missionsList.map(normalizeMission) : [];

  for (const platform of Object.keys(db.users)) {
    const group = db.users[platform] || {};
    for (const id of Object.keys(group)) {
      group[id] = normalizeUser(group[id]);
    }
    db.users[platform] = group;
  }

  return db;
}

function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function loadDB() {
  ensureDirForFile(DB_FILE);
  ensureDirForFile(DB_BACKUP_FILE);

  let db = readJsonFileSafe(DB_FILE);
  if (db) return normalizeDB(db);

  db = readJsonFileSafe(DB_BACKUP_FILE);
  if (db) {
    db = normalizeDB(db);
    try {
      atomicWriteJson(DB_FILE, db);
    } catch (_) {}
    return db;
  }

  const fresh = normalizeDB(getFreshDB());
  try {
    atomicWriteJson(DB_FILE, fresh);
    atomicWriteJson(DB_BACKUP_FILE, fresh);
  } catch (_) {}
  return fresh;
}

function saveDB(db) {
  const normalized = normalizeDB(db);
  atomicWriteJson(DB_FILE, normalized);
  atomicWriteJson(DB_BACKUP_FILE, normalized);
}

function initUser(db, p, id) {
  if (!db.users[p]) db.users[p] = {};
  if (!db.users[p][id]) {
    db.users[p][id] = normalizeUser({});
  } else {
    db.users[p][id] = normalizeUser(db.users[p][id]);
  }
}

function findMission(db, mid) {
  return db.missionsList.find(m => String(m.id) === String(mid));
}

function getAllUsers(db) {
  const out = [];
  for (const platform of Object.keys(db.users || {})) {
    const group = db.users[platform] || {};
    for (const id of Object.keys(group)) {
      out.push({ platform, id: String(id) });
    }
  }
  return out;
}

function cleanupUserMissionState(user, db) {
  const validMissionIds = new Set(db.missionsList.map(m => String(m.id)));

  user.completed = user.completed.filter(mid => validMissionIds.has(String(mid)));

  const nextStarted = {};
  for (const [mid, info] of Object.entries(user.started || {})) {
    if (validMissionIds.has(String(mid))) {
      nextStarted[String(mid)] = info;
    }
  }
  user.started = nextStarted;
}

function recordMissionStart(db, p, id, mid) {
  initUser(db, p, id);

  const user = db.users[p][id];
  const mission = findMission(db, mid);
  if (!mission) return { ok: false, message: "❌ ماموریت وجود ندارد" };

  user.started[String(mid)] = {
    at: Date.now(),
    via: "start-route"
  };

  saveDB(db);

  return { ok: true, mission };
}

function claimMission(db, p, id, mid) {
  initUser(db, p, id);

  const user = db.users[p][id];
  const mission = findMission(db, mid);

  if (!mission) {
    return { ok: false, message: "❌ ماموریت وجود ندارد" };
  }

  if (user.completed.includes(String(mid))) {
    return { ok: false, message: "⚠️ قبلاً این ماموریت را انجام دادی" };
  }

  const startInfo = user.started[String(mid)];
  if (!startInfo || !startInfo.at) {
    return { ok: false, message: "⛔ اول باید روی شروع بزنی" };
  }

  const now = Date.now();
  const ageMs = now - Number(startInfo.at || 0);
  const minMs = MIN_SECONDS_BEFORE_CLAIM * 1000;
  const maxMs = START_EXPIRE_HOURS * 60 * 60 * 1000;

  if (ageMs < minMs) {
    const remain = Math.ceil((minMs - ageMs) / 1000);
    return {
      ok: false,
      message: `⏳ کمی زود زدی. ${remain} ثانیه دیگر دوباره بزن`
    };
  }

  if (ageMs > maxMs) {
    delete user.started[String(mid)];
    saveDB(db);
    return {
      ok: false,
      message: "⛔ زمان این شروع منقضی شده. دوباره روی شروع بزن"
    };
  }

  user.points += Number(mission.points || 0);
  user.completed.push(String(mid));
  delete user.started[String(mid)];

  saveDB(db);

  return {
    ok: true,
    message:
`🎉 ماموریت تایید شد

➕ +${mission.points}
💰 مجموع امتیاز: ${user.points}`
  };
}

/* =========================
   BUTTONS
========================= */
const BUTTONS = {
  "🚀 بازکردن برنامه": "https://click.adtrace.io/u2p3usf",
  "🔄 بروزرسانی": "https://click.adtrace.io/zc7cgls",
  "💡 قبض": "https://click.adtrace.io/uzwe0u4",
  "💳 کارت به کارت": "https://click.adtrace.io/lhntx66",
  "❤️ نیکوکاری": "https://click.adtrace.io/5yb7mok",
  "📶 بسته اینترنتی": "https://click.adtrace.io/4pepzq6",
  "📱 شارژ": "https://click.adtrace.io/51ee6bd",
  "👥 دعوت": "https://click.adtrace.io/px12hz6"
};

function buildMenu() {
  const keys = Object.keys(BUTTONS);
  const kb = [
    ["🎯 ماموریت روزانه"],
    ["👤 پروفایل شما"]
  ];

  for (let i = 0; i < keys.length; i += 2) {
    kb.push(keys.slice(i, i + 2));
  }

  return kb;
}

/* =========================
   SEND WRAPPER
========================= */
async function send(p, id, text, options = {}) {
  if (p === "telegram") {
    return telegramBot.sendMessage(id, text, options);
  }
  return baleBot.sendMessage(id, text, options);
}

/* =========================
   BOT HANDLE
========================= */
async function handle(p, id, text) {
  const db = loadDB();
  initUser(db, p, id);

  const user = db.users[p][id];
  cleanupUserMissionState(user, db);

  if (text === "/start") {
    saveDB(db);
    return send(p, id, "🏠 منو:", {
      reply_markup: { keyboard: buildMenu(), resize_keyboard: true }
    });
  }

  if (text === "👤 پروفایل شما") {
    return send(p, id, `💰 امتیاز: ${user.points}`);
  }

  if (text === "🎯 ماموریت روزانه") {
    const active = db.missionsList.filter(m =>
      m.status === "active" &&
      !user.completed.includes(String(m.id))
    );

    if (!active.length) {
      return send(p, id, "⏳ ماموریتی نداری");
    }

    for (const m of active) {
      await send(
        p,
        id,
`${m.title}
${m.desc}
🪙 ${m.points}`,
        {
          reply_markup: {
            inline_keyboard: [[
              {
                text: "▶️ شروع",
                url: `${BASE_URL}/start/${p}/${id}/${m.id}`
              },
              {
                text: "🚀 انجام دادم",
                callback_data: `claim_${p}_${id}_${m.id}`
              }
            ]]
          }
        }
      );
    }

    return;
  }

  if (BUTTONS[text]) {
    return send(p, id, "👇 ورود", {
      reply_markup: {
        inline_keyboard: [[
          {
            text: "🚀 باز کردن",
            url: BUTTONS[text]
          }
        ]]
      }
    });
  }

  return send(p, id, "🏠 منو:", {
    reply_markup: { keyboard: buildMenu(), resize_keyboard: true }
  });
}

/* =========================
   TELEGRAM
========================= */
telegramBot.on('message', msg => {
  if (!msg.text) return;
  handle("telegram", String(msg.chat.id), msg.text);
});

telegramBot.on('callback_query', async q => {
  try {
    if (!q.data || !q.data.startsWith("claim_")) return;

    const [, p, id, mid] = q.data.split("_");
    const db = loadDB();
    const result = claimMission(db, p, String(id), String(mid));

    await telegramBot.answerCallbackQuery(q.id, {
      text: result.ok ? "🎉 انجام شد" : result.message,
      show_alert: true
    });

    if (result.ok) {
      await telegramBot.sendMessage(id, result.message);
    }
  } catch (_) {
    try {
      await telegramBot.answerCallbackQuery(q.id, {
        text: "❌ خطا در ثبت ماموریت",
        show_alert: true
      });
    } catch (_) {}
  }
});

/* =========================
   BALE
========================= */
let offset = 0;

async function listenBale() {
  try {
    const updates = await baleBot.getUpdates(offset);

    for (const u of updates) {
      offset = u.update_id + 1;

      if (u.message && u.message.text) {
        handle("bale", String(u.message.chat.id), u.message.text);
      }

      if (u.callback_query && u.callback_query.data) {
        const data = u.callback_query.data;

        if (data.startsWith("claim_")) {
          const [, p, id, mid] = data.split("_");
          const db = loadDB();
          const result = claimMission(db, p, String(id), String(mid));

          await baleBot.answerCallbackQuery(u.callback_query.id, {
            text: result.ok ? "🎉 انجام شد" : result.message,
            show_alert: true
          });

          if (result.ok) {
            await baleBot.sendMessage(id, result.message);
          }
        }
      }
    }
  } catch (_) {}

  setTimeout(listenBale, 1000);
}
listenBale();

/* =========================
   START ROUTE
========================= */
app.get('/start/:p/:id/:mid', (req, res) => {
  try {
    const { p, id, mid } = req.params;
    const db = loadDB();
    const result = recordMissionStart(db, p, String(id), String(mid));

    if (!result.ok) {
      return res.status(404).send(result.message);
    }

    const missionLink = String(result.mission.link || "").trim();
    if (!missionLink) {
      return res.status(400).send("Mission link not found");
    }

    return res.redirect(missionLink);
  } catch (_) {
    return res.status(500).send("Start tracking failed");
  }
});

/* =========================
   LEGACY ROUTES
========================= */
app.get('/claim/:p/:id/:mid', (req, res) => {
  return res.send("disabled");
});

/* =========================
   ADMIN
========================= */
app.get('/admin/missions', (req, res) => {
  try {
    const db = loadDB();
    return res.json(db.missionsList || []);
  } catch (_) {
    return res.json([]);
  }
});

app.post('/admin/add-mission', (req, res) => {
  try {
    const db = loadDB();

    const title = (req.body.title || "").trim();
    const desc = (req.body.desc || "").trim();
    const link = (req.body.link || "").trim();
    const points = Number(req.body.points || 0);
    const type = (req.body.type || "main").trim();

    if (!title || !link) {
      return res.json({ ok: false, error: "invalid" });
    }

    const mission = normalizeMission({
      id: Date.now(),
      title,
      desc,
      link,
      points,
      type,
      status: "inactive",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    db.missionsList.push(mission);

    saveDB(db);
    return res.json({ ok: true, mission });
  } catch (_) {
    return res.json({ ok: false });
  }
});

app.post('/admin/delete-mission', (req, res) => {
  try {
    const db = loadDB();

    db.missionsList = db.missionsList.filter(
      m => String(m.id) !== String(req.body.id)
    );

    saveDB(db);
    return res.json({ ok: true });
  } catch (_) {
    return res.json({ ok: false });
  }
});

app.post('/admin/mission/toggle', (req, res) => {
  try {
    const db = loadDB();

    const m = db.missionsList.find(x => String(x.id) === String(req.body.id));
    if (!m) return res.json({ ok: false });

    m.status = req.body.status === "active" ? "active" : "inactive";
    m.updatedAt = Date.now();

    saveDB(db);
    return res.json({ ok: true });
  } catch (_) {
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
  } catch (_) {
    return res.json({});
  }
});

app.get('/admin/messages', (req, res) => {
  try {
    const db = loadDB();
    return res.json(db.messages || []);
  } catch (_) {
    return res.json([]);
  }
});

app.post('/admin/broadcast', async (req, res) => {
  try {
    const db = loadDB();
    const text = String(req.body.text || "").trim();

    if (!text) {
      return res.json({ ok: false });
    }

    db.messages.push({
      id: Date.now(),
      text
    });
    saveDB(db);

    const users = getAllUsers(db);

    for (const u of users) {
      try {
        await send(u.platform, u.id, text);
      } catch (_) {}
    }

    return res.json({ ok: true });
  } catch (_) {
    return res.json({ ok: false });
  }
});

/* =========================
   HEALTH
========================= */
app.get('/health', (req, res) => {
  try {
    const db = loadDB();
    res.json({
      ok: true,
      missions: db.missionsList.length,
      telegramUsers: Object.keys(db.users.telegram || {}).length,
      baleUsers: Object.keys(db.users.bale || {}).length
    });
  } catch (_) {
    res.json({ ok: false });
  }
});

/* =========================
   SERVER
========================= */
app.listen(3000, () => console.log("RUNNING"));
app.get("/", (req, res) => res.send("OK"));

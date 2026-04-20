const express = require('express');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.static('public'));

/* =========================
   CONFIG
========================= */
const BASE_URL = process.env.BASE_URL || "https://bot-0o2j.onrender.com";

/*
  برای ماندگاری روی Render اگر Persistent Disk داری:
  DB_FILE=/var/data/db.json
  یا هر مسیری که روی دیسک mount کرده‌ای
*/
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json');

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

function ensureDbFile() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(getFreshDB(), null, 2), 'utf8');
  }
}

function loadDB() {
  try {
    ensureDbFile();

    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(raw);

    if (!db || typeof db !== 'object') {
      throw new Error('bad db');
    }

    db.users = db.users || { telegram: {}, bale: {} };
    db.users.telegram = db.users.telegram || {};
    db.users.bale = db.users.bale || {};
    db.missionsList = Array.isArray(db.missionsList) ? db.missionsList : [];
    db.messages = Array.isArray(db.messages) ? db.messages : [];

    return db;
  } catch (e) {
    const fresh = getFreshDB();
    try {
      ensureDbFile();
      fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2), 'utf8');
    } catch (_) {}
    return fresh;
  }
}

function saveDB(db) {
  ensureDbFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function initUser(db, p, id) {
  if (!db.users[p]) db.users[p] = {};

  if (!db.users[p][id]) {
    db.users[p][id] = {
      points: 0,
      started: [],
      completed: []
    };
  }

  if (!Array.isArray(db.users[p][id].started)) db.users[p][id].started = [];
  if (!Array.isArray(db.users[p][id].completed)) db.users[p][id].completed = [];
  if (typeof db.users[p][id].points !== 'number') {
    db.users[p][id].points = Number(db.users[p][id].points || 0);
  }
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
   HELPERS
========================= */
function findMission(db, mid) {
  return db.missionsList.find(m => String(m.id) === String(mid));
}

function recordStart(db, p, id, mid) {
  initUser(db, p, id);
  const user = db.users[p][id];

  if (!user.started.includes(String(mid))) {
    user.started.push(String(mid));
  }

  saveDB(db);
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

  if (!user.started.includes(String(mid))) {
    return { ok: false, message: "⛔ اول باید روی شروع بزنی و لینک مأموریت باز شود" };
  }

  user.points += Number(mission.points || 0);
  user.completed.push(String(mid));

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
   HANDLE
========================= */
async function handle(p, id, text) {
  const db = loadDB();
  initUser(db, p, id);

  const user = db.users[p][id];

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
   TELEGRAM MESSAGE
========================= */
telegramBot.on('message', msg => {
  if (!msg.text) return;
  handle("telegram", String(msg.chat.id), msg.text);
});

/* =========================
   TELEGRAM CALLBACK
========================= */
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
  } catch (e) {
    try {
      await telegramBot.answerCallbackQuery(q.id, {
        text: "❌ خطا در ثبت ماموریت",
        show_alert: true
      });
    } catch (_) {}
  }
});

/* =========================
   BALE POLLING
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
  } catch (e) {}

  setTimeout(listenBale, 1000);
}
listenBale();

/* =========================
   START TRACK + REDIRECT
========================= */
app.get('/start/:p/:id/:mid', (req, res) => {
  try {
    const { p, id, mid } = req.params;
    const db = loadDB();

    initUser(db, p, String(id));

    const mission = findMission(db, String(mid));

    if (!mission) {
      return res.status(404).send("Mission not found");
    }

    const realMissionLink = String(mission.link || "").trim();

    if (!realMissionLink) {
      return res.status(400).send("Mission link not found");
    }

    recordStart(db, p, String(id), String(mid));

    return res.redirect(realMissionLink);
  } catch (e) {
    return res.status(500).send("Start tracking failed");
  }
});

/* =========================
   LEGACY CLAIM ROUTE
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
  } catch (e) {
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

    if (!title || !link) {
      return res.json({ ok: false, error: "invalid" });
    }

    db.missionsList.push({
      id: Date.now(),
      title,
      desc,
      link,
      points,
      status: "inactive"
    });

    saveDB(db);
    return res.json({ ok: true });
  } catch (e) {
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
  } catch (e) {
    return res.json({ ok: false });
  }
});

app.post('/admin/mission/toggle', (req, res) => {
  try {
    const db = loadDB();

    const m = db.missionsList.find(x => String(x.id) === String(req.body.id));
    if (!m) return res.json({ ok: false });

    m.status = req.body.status;
    saveDB(db);

    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: false });
  }
});

/* =========================
   SERVER
========================= */
app.listen(3000, () => console.log("RUNNING"));
app.get("/", (req, res) => res.send("OK"));

const express = require('express');
const fs = require('fs');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const TELEGRAM_TOKEN = "8685728009:AAED7KxyD0bvKgZr6XxTXJOycBFsHtdY0Ic";
const BALE_TOKEN = "1579243381:t714UwiXVQCQDE8z2MKNuMq7Ya6K31wPggk";

const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const BALE_API = `https://tapi.bale.ai/bot${BALE_TOKEN}`;

/* =========================
   BALE
========================= */
const baleBot = {
  async sendMessage(chat_id, text, options = {}) {
    return axios.post(`${BALE_API}/sendMessage`, { chat_id, text, ...options })
      .then(r => r.data.result);
  },
  async getUpdates(offset) {
    return axios.post(`${BALE_API}/getUpdates`, {
      offset,
      limit: 100,
      timeout: 25
    }, {
      timeout: 30000
    }).then(r => r.data.result);
  },
  async answerCallbackQuery(callback_query_id, options = {}) {
    return axios.post(`${BALE_API}/answerCallbackQuery`, {
      callback_query_id,
      ...options
    }).then(r => r.data.result);
  },
  async deleteWebhook() {
    return axios.post(`${BALE_API}/deleteWebhook`, {})
      .then(r => r.data.result);
  }
};

/* =========================
   DB
========================= */
const DB_FILE = './db.json';

function loadDB() {
  try {
    let db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.users = db.users || { telegram: {}, bale: {} };
    db.missionsList = Array.isArray(db.missionsList) ? db.missionsList : [];
    db.clicks = Array.isArray(db.clicks) ? db.clicks : [];
    db.messages = Array.isArray(db.messages) ? db.messages : [];
    return db;
  } catch (e) {
    let fresh = {
      users: { telegram: {}, bale: {} },
      missionsList: [],
      clicks: [],
      messages: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function initUser(db, p, id) {
  id = String(id);
  if (!db.users[p]) db.users[p] = {};
  if (!db.users[p][id]) {
    db.users[p][id] = { points: 0, completed: [] };
  }
}

/* =========================
   MENU
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

  let kb = [
    ["🎯 ماموریت روزانه"],
    ["👤 پروفایل شما"]
  ];

  for (let i = 0; i < keys.length; i += 2) {
    kb.push(keys.slice(i, i + 2));
  }

  return kb;
}

/* =========================
   HELPERS
========================= */
function appendTrackingParams(link, userId, missionId) {
  const cleanLink = String(link || "").trim();
  if (!cleanLink) return "";

  const separator = cleanLink.includes('?') ? '&' : '?';
  return `${cleanLink}${separator}sub_id=${encodeURIComponent(userId)}&sub_id2=${encodeURIComponent(missionId)}`;
}

async function send(p, id, text, options = {}) {
  return p === "telegram"
    ? telegramBot.sendMessage(id, text, options)
    : baleBot.sendMessage(id, text, ...[options][0]);
}

async function answerPlatformCallback(platform, callbackId, text, showAlert = true) {
  try {
    if (!callbackId) return;

    if (platform === "telegram") {
      await telegramBot.answerCallbackQuery(callbackId, {
        text,
        show_alert: showAlert
      });
    } else {
      await baleBot.answerCallbackQuery(callbackId, {
        text,
        show_alert: showAlert
      });
    }
  } catch (e) {
    console.log(`callback answer error [${platform}]`, e?.response?.data || e.message);
  }
}

/* =========================
   CLAIM LOGIC
========================= */
async function processClaim(platform, userId, missionId, callbackId = null) {
  let db = loadDB();
  userId = String(userId);
  missionId = String(missionId);

  initUser(db, platform, userId);
  let user = db.users[platform][userId];

  let mission = db.missionsList.find(m => String(m.id) === missionId);

  if (!mission) {
    await answerPlatformCallback(platform, callbackId, "❌ ماموریت نیست", true);
    return;
  }

  if (user.completed.includes(missionId)) {
    await answerPlatformCallback(platform, callbackId, "⚠️ قبلاً انجام دادی", true);
    return;
  }

  let clicked = db.clicks.find(c =>
    String(c.uid) === userId &&
    String(c.mid) === missionId
  );

  if (!clicked) {
    await answerPlatformCallback(platform, callbackId, "❌ هنوز وارد لینک نشدی", true);
    return;
  }

  user.points += Number(mission.points || 0);
  user.completed.push(missionId);
  saveDB(db);

  await answerPlatformCallback(platform, callbackId, "🎉 انجام شد", true);

  await send(platform, userId,
`🎉 ماموریت تایید شد

+${mission.points}
💰 ${user.points}`);
}

/* =========================
   HANDLE
========================= */
async function handle(p, id, text) {
  let db = loadDB();
  id = String(id);

  initUser(db, p, id);
  let user = db.users[p][id];

  if (text === "/start") {
    saveDB(db);
    return send(p, id, "🏠 منو:", {
      reply_markup: { keyboard: buildMenu(), resize_keyboard: true }
    });
  }

  if (text === "👤 پروفایل شما") {
    return send(p, id, `💰 امتیاز شما: ${user.points}`);
  }

  if (text === "🎯 ماموریت روزانه") {
    let active = db.missionsList.filter(m =>
      m.status === "active" &&
      !user.completed.includes(String(m.id))
    );

    if (active.length === 0) {
      return send(p, id, "⏳ ماموریتی نداری");
    }

    for (let m of active) {
      const finalLink = appendTrackingParams(m.link, id, m.id);

      await send(p, id,
`${m.title}
${m.desc}
🪙 ${m.points}`, {
        reply_markup: {
          inline_keyboard: [[
            { text: "▶️ شروع", url: finalLink },
            { text: "🚀 انجام دادم", callback_data: `claim_${p}_${id}_${m.id}` }
          ]]
        }
      });
    }

    return;
  }

  if (BUTTONS[text]) {
    return send(p, id, "👇 ورود", {
      reply_markup: {
        inline_keyboard: [[{
          text: "🚀 باز کردن",
          url: BUTTONS[text]
        }]]
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
telegramBot.on('message', async msg => {
  try {
    if (!msg.text) return;
    await handle("telegram", msg.chat.id, msg.text);
  } catch (e) {
    console.log("telegram message error", e.message);
  }
});

telegramBot.on('callback_query', async query => {
  try {
    if (!query.data || !query.data.startsWith("claim_")) return;

    const [, p, id, mid] = query.data.split("_");
    await processClaim(p, id, mid, query.id);
  } catch (e) {
    console.log("telegram callback error", e.message);
  }
});

/* =========================
   BALE POLLING
========================= */
let baleOffset = 0;
let balePollingStarted = false;

async function handleBaleUpdate(update) {
  try {
    if (update.message && update.message.text) {
      const chatId = update.message.chat && update.message.chat.id;
      if (!chatId) return;
      await handle("bale", chatId, update.message.text);
      return;
    }

    if (update.callback_query && update.callback_query.data) {
      const query = update.callback_query;
      const data = query.data;

      if (!data.startsWith("claim_")) {
        await answerPlatformCallback("bale", query.id, "", false);
        return;
      }

      const [, p, id, mid] = data.split("_");
      await processClaim(p, id, mid, query.id);
    }
  } catch (e) {
    console.log("bale update error", e?.response?.data || e.message);
  }
}

async function startBalePolling() {
  if (balePollingStarted) return;
  balePollingStarted = true;

  try {
    await baleBot.deleteWebhook();
  } catch (e) {
    console.log("bale deleteWebhook error", e?.response?.data || e.message);
  }

  while (true) {
    try {
      const updates = await baleBot.getUpdates(baleOffset);

      if (Array.isArray(updates) && updates.length > 0) {
        for (const update of updates) {
          baleOffset = update.update_id + 1;
          await handleBaleUpdate(update);
        }
      }
    } catch (e) {
      console.log("bale polling error", e?.response?.data || e.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

/* =========================
   ADTRACE CALLBACK ENDPOINT
========================= */
app.get('/adtrace/click', (req, res) => {
  let db = loadDB();

  const uid = String(req.query.uid || "");
  const mid = String(req.query.mid || "");

  if (uid && mid) {
    let exists = db.clicks.find(c =>
      String(c.uid) === uid &&
      String(c.mid) === mid
    );

    if (!exists) {
      db.clicks.push({
        uid,
        mid,
        time: Date.now()
      });
      saveDB(db);
    }
  }

  res.send("OK");
});

/* =========================
   ADMIN APIs
========================= */
app.get('/admin/missions', (req, res) => {
  let db = loadDB();
  res.json(db.missionsList);
});

app.post('/admin/add-mission', (req, res) => {
  let db = loadDB();

  db.missionsList.push({
    id: Date.now(),
    title: req.body.title,
    desc: req.body.desc,
    link: req.body.link,
    points: req.body.points,
    type: req.body.type || "main",
    status: "inactive"
  });

  saveDB(db);
  res.json({ ok: true });
});

app.post('/admin/delete-mission', (req, res) => {
  let db = loadDB();
  db.missionsList = db.missionsList.filter(
    m => String(m.id) !== String(req.body.id)
  );
  saveDB(db);
  res.json({ ok: true });
});

app.post('/admin/mission/toggle', (req, res) => {
  let db = loadDB();
  let m = db.missionsList.find(x => String(x.id) === String(req.body.id));
  if (!m) return res.json({ ok: false });
  m.status = req.body.status;
  saveDB(db);
  res.json({ ok: true });
});

app.get('/admin/users', (req, res) => {
  let db = loadDB();
  const merged = {
    ...db.users.telegram,
    ...db.users.bale
  };
  res.json(merged);
});

app.get('/admin/messages', (req, res) => {
  let db = loadDB();
  res.json(db.messages || []);
});

app.post('/admin/broadcast', async (req, res) => {
  let db = loadDB();
  const text = req.body.text || "";

  db.messages = db.messages || [];
  db.messages.push({
    id: Date.now(),
    text
  });
  saveDB(db);

  const telegramUsers = Object.keys(db.users.telegram || {});
  const baleUsers = Object.keys(db.users.bale || {});

  for (const id of telegramUsers) {
    try {
      await send("telegram", id, text, { parse_mode: "HTML" });
    } catch (e) {
      console.log("telegram broadcast error", id, e.message);
    }
  }

  for (const id of baleUsers) {
    try {
      await send("bale", id, text, { parse_mode: "HTML" });
    } catch (e) {
      console.log("bale broadcast error", id, e.message);
    }
  }

  res.json({ ok: true });
});

/* =========================
   SERVER
========================= */
app.get("/", (req, res) => res.send("OK"));

app.listen(3000, () => {
  console.log("RUNNING");
  startBalePolling();
});

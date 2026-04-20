const express = require('express');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.static('public'));

/* =========================
   TOKENS
========================= */
const TELEGRAM_TOKEN = "8685728009:AAED7KxyD0bvKgZr6XxTXJOycBFsHtdY0Ic";
const BALE_TOKEN = "1579243381:t714UwiXVQCQDE8z2MKNuMq7Ya6K31wPggk";

const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const BALE_API = `https://tapi.bale.ai/bot${BALE_TOKEN}`;

/* =========================
   BALE (FIXED + ENABLED)
========================= */
const baleBot = {
  async sendMessage(chat_id, text, options = {}) {
    return axios.post(`${BALE_API}/sendMessage`, {
      chat_id,
      text,
      ...options
    }).then(r => r.data.result);
  },

  async getUpdates(offset) {
    return axios.post(`${BALE_API}/getUpdates`, {
      offset
    }).then(r => r.data.result);
  }
};

/* =========================
   DB SAFE
========================= */
const DB_FILE = './db.json';

function loadDB(){
  try{
    const db = JSON.parse(fs.readFileSync(DB_FILE,'utf8'));

    db.users = db.users || {telegram:{},bale:{}};
    db.missionsList = Array.isArray(db.missionsList) ? db.missionsList : [];

    return db;
  }catch(e){
    const fresh = { users:{telegram:{},bale:{}}, missionsList:[] };
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh,null,2));
    return fresh;
  }
}

function saveDB(db){
  fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2));
}

function initUser(db,p,id){
  if(!db.users[p]) db.users[p]={};
  if(!db.users[p][id]){
    db.users[p][id]={points:0,started:[],completed:[]};
  }
}

/* =========================
   BUTTONS (UNCHANGED)
========================= */
const BUTTONS = {
"🚀 بازکردن برنامه":"https://click.adtrace.io/u2p3usf",
"🔄 بروزرسانی":"https://click.adtrace.io/zc7cgls",
"💡 قبض":"https://click.adtrace.io/uzwe0u4",
"💳 کارت به کارت":"https://click.adtrace.io/lhntx66",
"❤️ نیکوکاری":"https://click.adtrace.io/5yb7mok",
"📶 بسته اینترنتی":"https://click.adtrace.io/4pepzq6",
"📱 شارژ":"https://click.adtrace.io/51ee6bd",
"👥 دعوت":"https://click.adtrace.io/px12hz6"
};

function buildMenu(){
  const keys = Object.keys(BUTTONS);

  let kb = [
    ["🎯 ماموریت روزانه"],
    ["👤 پروفایل شما"]
  ];

  for(let i=0;i<keys.length;i+=2){
    kb.push(keys.slice(i,i+2));
  }

  return kb;
}

/* =========================
   SEND UNIFIED
========================= */
async function send(p,id,text,options={}){
  return p==="telegram"
    ? telegramBot.sendMessage(id,text,options)
    : baleBot.sendMessage(id,text,options);
}

/* =========================
   HANDLE
========================= */
async function handle(p,id,text){

  const db = loadDB();
  initUser(db,p,id);

  const user = db.users[p][id];

  if(text==="/start"){
    saveDB(db);
    return send(p,id,"🏠 منو:",{
      reply_markup:{keyboard:buildMenu(),resize_keyboard:true}
    });
  }

  if(text==="👤 پروفایل شما"){
    return send(p,id,`💰 امتیاز: ${user.points}`);
  }

  if(text==="🎯 ماموریت روزانه"){

    const active = db.missionsList.filter(m =>
      m.status==="active" &&
      !user.completed.includes(String(m.id))
    );

    if(!active.length){
      return send(p,id,"⏳ ماموریتی نداری");
    }

    for(let m of active){
      await send(p,id,
`${m.title}
${m.desc}
🪙 ${m.points}`,{
        reply_markup:{
          inline_keyboard:[[
            {text:"▶️ شروع", url:m.link},
            {text:"🚀 انجام دادم", callback_data:`claim_${p}_${id}_${m.id}`}
          ]]
        }
      });
    }

    return;
  }

  if(BUTTONS[text]){
    return send(p,id,"👇 ورود",{
      reply_markup:{
        inline_keyboard:[[{
          text:"🚀 باز کردن",
          url:BUTTONS[text]
        }]]
      }
    });
  }

  return send(p,id,"🏠 منو:",{
    reply_markup:{keyboard:buildMenu(),resize_keyboard:true}
  });
}

/* =========================
   TELEGRAM
========================= */
telegramBot.on('message',msg=>{
  if(!msg.text) return;
  handle("telegram",msg.chat.id,msg.text);
});

/* =========================
   CALLBACK FIX (IMPORTANT PART)
========================= */
telegramBot.on('callback_query', async q => {

  if(!q.data.startsWith("claim_")) return;

  const [,p,id,mid] = q.data.split("_");

  const db = loadDB();
  initUser(db,p,id);

  const user = db.users[p][id];
  const mission = db.missionsList.find(m=>String(m.id)===String(mid));

  if(!mission){
    return telegramBot.answerCallbackQuery(q.id,{
      text:"❌ ماموریت پیدا نشد",
      show_alert:true
    });
  }

  if(user.completed.includes(String(mid))){
    return telegramBot.answerCallbackQuery(q.id,{
      text:"⚠️ این ماموریت قبلاً انجام شده",
      show_alert:true
    });
  }

  user.points += Number(mission.points);
  user.completed.push(String(mid));

  saveDB(db);

  telegramBot.answerCallbackQuery(q.id,{
    text:"🎉 ماموریت تایید شد",
    show_alert:true
  });

  telegramBot.sendMessage(id,
`🎉 ماموریت انجام شد

➕ +${mission.points}
💰 مجموع: ${user.points}`);
});

/* =========================
   BALE LOOP (FIXED)
========================= */
let offset = 0;

async function listenBale(){
  try{
    const updates = await baleBot.getUpdates(offset);

    for(const u of updates){
      offset = u.update_id + 1;
      if(!u.message) continue;

      handle("bale",u.message.chat.id,u.message.text);
    }
  }catch(e){}

  setTimeout(listenBale,1000);
}
listenBale();

/* =========================
   CLAIM HTTP (optional fallback)
========================= */
app.get('/claim/:p/:id/:mid',(req,res)=>{
  res.send("OK (use button inside bot)");
});

/* =========================
   SERVER
========================= */
app.listen(3000,()=>console.log("RUNNING"));
app.get("/",(req,res)=>res.send("OK"));

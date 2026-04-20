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

const baleBot = {
  async sendMessage(chat_id, text, options = {}) {
    return axios.post(`${BALE_API}/sendMessage`, { chat_id, text, ...options });
  },
  async getUpdates(offset) {
    return axios.post(`${BALE_API}/getUpdates`, { offset }).then(r => r.data.result);
  }
};

/* =========================
   DB SAFE (FIXED)
========================= */
const DB_FILE = './db.json';

function loadDB(){
  try{
    let db = JSON.parse(fs.readFileSync(DB_FILE,'utf8'));

    if(!db || typeof db !== "object") throw "bad db";

    db.users = db.users || {telegram:{},bale:{}};
    db.missionsList = Array.isArray(db.missionsList) ? db.missionsList : [];

    return db;

  }catch(e){
    let fresh = {
      users:{telegram:{},bale:{}},
      missionsList:[]
    };

    fs.writeFileSync(DB_FILE, JSON.stringify(fresh,null,2));
    return fresh;
  }
}

function saveDB(db){
  fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2));
}

function initUser(db,p,id){
  if(!db.users[p][id]){
    db.users[p][id] = {points:0,started:[],completed:[]};
  }
}

/* =========================
   SEND
========================= */
async function send(p,id,text,options={}){
  return telegramBot.sendMessage(id,text,options);
}

/* =========================
   BUTTONS
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
   HANDLE
========================= */
async function handle(p,id,text){

  let db = loadDB();
  initUser(db,p,id);
  let user = db.users[p][id];

  if(text==="/start"){
    saveDB(db);
    return send(p,id,"🏠 منو:",{
      reply_markup:{keyboard:buildMenu(),resize_keyboard:true}
    });
  }

  if(text==="👤 پروفایل شما"){
    return send(p,id,`💰 امتیاز شما: ${user.points}`);
  }

  if(text==="🎯 ماموریت روزانه"){

    let active = db.missionsList.filter(m =>
      m.status==="active" &&
      !user.completed.includes(String(m.id))
    );

    if(active.length===0){
      return send(p,id,"⏳ ماموریتی نداری");
    }

    for(let m of active){
      await send(p,id,
`${m.title}
${m.desc}
🪙 ${m.points}`,{
        reply_markup:{
          inline_keyboard:[[
            { text:"🚀 انجام دادم", callback_data:`claim_${p}_${id}_${m.id}` },
            { text:"▶️ شروع", url:m.link }
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
   BALE
========================= */
let offset=0;

async function listenBale(){
  try{
    let updates = await baleBot.getUpdates(offset);

    for(let u of updates){
      offset = u.update_id+1;
      if(!u.message) continue;

      handle("bale",u.message.chat.id,u.message.text);
    }
  }catch(e){}

  setTimeout(listenBale,1000);
}
listenBale();

/* =========================
   ADMIN - ADD MISSION (FIXED VALIDATION)
========================= */
app.post('/admin/add-mission',(req,res)=>{

  let db = loadDB();

  let title = (req.body.title || "").trim();
  let desc = (req.body.desc || "").trim();
  let link = (req.body.link || "").trim();
  let points = Number(req.body.points || 0);

  if(!title || !link){
    return res.json({ok:false,error:"invalid data"});
  }

  db.missionsList.push({
    id: Date.now(),
    title,
    desc,
    link,
    points,
    status:"inactive"
  });

  saveDB(db);

  res.json({ok:true});
});

/* =========================
   ADMIN - LIST MISSIONS (FIXED)
========================= */
app.get('/admin/missions',(req,res)=>{
  let db = loadDB();
  res.json(db.missionsList);
});

/* =========================
   DELETE MISSION
========================= */
app.post('/admin/delete-mission',(req,res)=>{
  let db = loadDB();

  db.missionsList = db.missionsList.filter(
    m => String(m.id) !== String(req.body.id)
  );

  saveDB(db);

  res.json({ok:true});
});

/* =========================
   TOGGLE
========================= */
app.post('/admin/mission/toggle',(req,res)=>{
  let db = loadDB();

  let m = db.missionsList.find(x=>String(x.id)===String(req.body.id));
  if(!m) return res.json({ok:false});

  m.status = req.body.status;

  saveDB(db);

  res.json({ok:true});
});

/* =========================
   CLAIM
========================= */
app.get('/claim/:p/:id/:mid',(req,res)=>{
  let db = loadDB();

  let {p,id,mid} = req.params;

  initUser(db,p,id);
  let user = db.users[p][id];

  let mission = db.missionsList.find(m=>String(m.id)===String(mid));

  if(!mission) return res.send("❌");

  if(user.completed.includes(String(mid)))
    return res.send("❌ تکراری");

  user.points += Number(mission.points);
  user.completed.push(String(mid));

  saveDB(db);

  send(p,id,`🎉 +${mission.points}\n💰 ${user.points}`);

  res.send("OK");
});

/* =========================
   SERVER
========================= */
app.listen(3000,()=>console.log("RUNNING"));

app.get("/",(req,res)=>res.send("OK"));

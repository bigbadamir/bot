const express = require('express');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const TELEGRAM_TOKEN = "8685728009:AAED7KxyD0bvKgZr6XxTXJOycBFsHtdY0Ic";
const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

/* =========================
   DB SAFE CORE (NO CRASH EVER)
========================= */
const DB_FILE = './db.json';

function loadDB(){
  try{
    const raw = fs.readFileSync(DB_FILE,'utf8');
    let db = JSON.parse(raw);

    if(!db || typeof db !== "object") throw "bad";

    db.users = db.users || {telegram:{},bale:{}};
    db.missionsList = Array.isArray(db.missionsList) ? db.missionsList : [];

    return db;

  }catch(e){
    const fresh = {
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
  if(!db.users[p]) db.users[p]={};
  if(!db.users[p][id]){
    db.users[p][id]={points:0,started:[],completed:[]};
  }
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
   SAFE SEND
========================= */
async function send(p,id,text,options={}){
  return telegramBot.sendMessage(id,text,options);
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
            {text:"🚀 انجام دادم", callback_data:`claim_${p}_${id}_${m.id}`},
            {text:"▶️ شروع", url:m.link}
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
   ADMIN - MISSIONS (FIXED + SAFE JSON ALWAYS)
========================= */
app.get('/admin/missions',(req,res)=>{
  try{
    const db = loadDB();
    return res.json(db.missionsList || []);
  }catch(e){
    return res.json([]);
  }
});

/* =========================
   ADD MISSION
========================= */
app.post('/admin/add-mission',(req,res)=>{

  const db = loadDB();

  const title = (req.body.title||"").trim();
  const desc = (req.body.desc||"").trim();
  const link = (req.body.link||"").trim();
  const points = Number(req.body.points||0);

  if(!title || !link){
    return res.json({ok:false,error:"invalid"});
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
   DELETE
========================= */
app.post('/admin/delete-mission',(req,res)=>{
  const db = loadDB();

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
  const db = loadDB();

  const m = db.missionsList.find(x=>String(x.id)===String(req.body.id));
  if(!m) return res.json({ok:false});

  m.status = req.body.status;

  saveDB(db);

  res.json({ok:true});
});

/* =========================
   CLAIM
========================= */
app.get('/claim/:p/:id/:mid',(req,res)=>{

  const db = loadDB();

  const {p,id,mid} = req.params;

  initUser(db,p,id);
  const user = db.users[p][id];

  const mission = db.missionsList.find(m=>String(m.id)===String(mid));

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

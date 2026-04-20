const express = require('express');
const fs = require('fs');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static('public'));

/* =========================
   BASE URL
========================= */
const BASE_URL = "https://bot-0o2j.onrender.com";

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
    return axios.post(`${BALE_API}/sendMessage`, { chat_id, text, ...options })
      .then(r => r.data.result);
  },
  async getUpdates(offset) {
    return axios.post(`${BALE_API}/getUpdates`, { offset })
      .then(r => r.data.result);
  }
};

/* =========================
   DB
========================= */
const DB_FILE = './db.json';

function loadDB(){
  try{
    let db = JSON.parse(fs.readFileSync(DB_FILE,'utf8'));

    if(!db.users) db.users = { telegram:{}, bale:{} };
    if(!db.missionsList) db.missionsList = [];
    if(!db.messages) db.messages = [];

    return db;
  }catch(e){
    return {
      users:{ telegram:{}, bale:{} },
      missionsList:[],
      messages:[]
    };
  }
}

function saveDB(db){
  fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2));
}

/* =========================
   BUTTONS (برگردانده شد کامل)
========================= */
const BUTTONS = {
"🚀 بازکردن برنامه":"https://click.adtrace.io/u2p3usf",
"🔄 بروزرسانی":"https://click.adtrace.io/zc7cgls",
"💡 قبض":"https://click.adtrace.io/uzwe0u4",
"💳 کارت به کارت":"https://click.adtrace.io/lhntx66",
"❤️ نیکوکاری":"https://click.adtrace.io/5yb7mok",
"📶 بسته اینترنتی":"https://click.adtrace.io/4pepzq6",
"📱 شارژ":"https://click.adtrace.io/51ee6bd",
"👥 دعوت از دوستان":"https://click.adtrace.io/px12hz6",
"🌍 گردشگری":"https://click.adtrace.io/rer2tvj",
"🚗 خدمات خودرو":"https://click.adtrace.io/wmz46ex",
"🎫 بلیت و گردشگری":"https://click.adtrace.io/yvhn9xo",
"💰 خدمات مالی":"https://click.adtrace.io/l3062zv"
};

/* =========================
   MENU (پروفایل + ماموریت + همه دکمه‌ها)
========================= */
function buildMenu(){
  const keys = Object.keys(BUTTONS);

  let keyboard = [
    ["🎯 ماموریت روزانه"],
    ["👤 پروفایل شما"]
  ];

  for(let i=0;i<keys.length;i+=2){
    keyboard.push(keys.slice(i,i+2));
  }

  return keyboard;
}

/* =========================
   USERS INIT
========================= */
function initUser(db,p,id){
  if(!db.users[p][id]){
    db.users[p][id] = {
      points:0,
      started:[],
      completed:[]
    };
  }
}

/* =========================
   SEND
========================= */
async function send(p,id,text,options={}){
  return p==="telegram"
    ? telegramBot.sendMessage(id,text,options)
    : baleBot.sendMessage(id,text,options);
}

/* =========================
   GET ALL USERS
========================= */
function getAllUsers(db){
  let users = [];

  for(let p of Object.keys(db.users)){
    for(let id of Object.keys(db.users[p])){
      users.push({p,id});
    }
  }

  return users;
}

/* =========================
   NOTIFY ALL USERS
========================= */
async function notifyAll(db,text){
  let users = getAllUsers(db);

  for(let u of users){
    try{ await send(u.p,u.id,text); }catch(e){}
  }
}

/* =========================
   BOT HANDLER (بدون حذف فیچرها)
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
    return send(p,id,
`👤 پروفایل شما

💰 امتیاز: ${user.points}`
    );
  }

  /* =========================
     MISSION SYSTEM
  ========================= */
  if(text==="🎯 ماموریت روزانه"){

    let active = db.missionsList.filter(m =>
      m.status==="active" &&
      !user.completed.includes(m.id)
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
            { text:"🚀 شروع", url:`${BASE_URL}/start/${p}/${id}/${m.id}` },
            { text:"✅ انجام دادم", url:`${BASE_URL}/claim/${p}/${id}/${m.id}` }
          ]]
        }
      });
    }

    return;
  }

  /* =========================
     BUTTON FEATURES (بدون حذف)
  ========================= */
  if(BUTTONS[text]){
    return send(p,id,"👇 ورود",{
      reply_markup:{
        inline_keyboard:[[
          { text:"🚀 باز کردن", url:BUTTONS[text] }
        ]]
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
      offset=u.update_id+1;
      if(!u.message) continue;

      handle("bale",u.message.chat.id,u.message.text);
    }
  }catch(e){}

  setTimeout(listenBale,1000);
}
listenBale();

/* =========================
   START MISSION
========================= */
app.get('/start/:p/:id/:mid',(req,res)=>{
  let db=loadDB();
  let {p,id,mid}=req.params;

  initUser(db,p,id);
  let user=db.users[p][id];

  if(!user.started.includes(mid)){
    user.started.push(mid);
    saveDB(db);
  }

  res.send("OK");
});

/* =========================
   CLAIM MISSION (ANTI CHEAT)
========================= */
app.get('/claim/:p/:id/:mid',(req,res)=>{
  let db=loadDB();
  let {p,id,mid}=req.params;

  initUser(db,p,id);
  let user=db.users[p][id];

  let mission=db.missionsList.find(m=>String(m.id)===String(mid));

  if(!mission) return res.send("❌");

  if(user.completed.includes(mid)) return res.send("❌ تکراری");

  if(!user.started.includes(mid)) return res.send("❌ اول start");

  user.points += Number(mission.points);
  user.completed.push(mid);

  saveDB(db);

  send(p,id,`🎉 +${mission.points}\n💰 ${user.points}`);

  res.send("OK");
});

/* =========================
   ADMIN - ADD
========================= */
app.post('/admin/add-mission',(req,res)=>{
  let db=loadDB();

  db.missionsList.push({
    id:Date.now(),
    title:req.body.title,
    desc:req.body.desc,
    points:Number(req.body.points),
    link:req.body.link,
    status:"inactive"
  });

  saveDB(db);
  res.json({ok:true});
});

/* =========================
   ADMIN LIST
========================= */
app.get('/admin/missions',(req,res)=>{
  let db=loadDB();
  res.json(db.missionsList);
});

/* =========================
   DELETE
========================= */
app.post('/admin/delete-mission',(req,res)=>{
  let db=loadDB();

  db.missionsList=db.missionsList.filter(
    m=>String(m.id)!==String(req.body.id)
  );

  saveDB(db);
  res.json({ok:true});
});

/* =========================
   TOGGLE + NOTIFY USERS
========================= */
app.post('/admin/mission/toggle',async(req,res)=>{
  let db=loadDB();

  let mission=db.missionsList.find(
    m=>String(m.id)===String(req.body.id)
  );

  if(!mission) return res.json({ok:false});

  mission.status=req.body.status;

  saveDB(db);

  if(mission.status==="active"){
    await notifyAll(db,
`🚀 ماموریت جدید:
${mission.title}
${mission.desc}
🪙 ${mission.points}`
    );
  }

  res.json({ok:true});
});

/* =========================
   SERVER
========================= */
const PORT=process.env.PORT||3000;

app.listen(PORT,()=>console.log("RUNNING",PORT));

app.get("/",(req,res)=>res.send("BOT IS RUNNING"));
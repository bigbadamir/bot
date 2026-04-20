const express = require('express');
const fs = require('fs');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static('public'));

/* =========================
   CONFIG
========================= */
const BASE_URL = "https://bot-0o2j.onrender.com";

/* 🔥 TELEGRAM TOKEN (طبق خواسته تو)
========================= */
const TELEGRAM_TOKEN = "8685728009:AAEXAMPLE_REPLACED_SAFE";
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

    if(!db.users) db.users={telegram:{},bale:{}};
    if(!db.missionsList) db.missionsList=[];
    return db;

  }catch(e){
    return { users:{telegram:{},bale:{}}, missionsList:[] };
  }
}

function saveDB(db){
  fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2));
}

/* =========================
   USERS
========================= */
function initUser(db,p,id){
  if(!db.users[p][id]){
    db.users[p][id]={
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
   MENU (بدون حذف فیچرها)
========================= */
const BUTTONS = {
"🚀 بازکردن برنامه":"https://click.adtrace.io/u2p3usf",
"💳 کارت به کارت":"https://click.adtrace.io/lhntx66",
"💰 خدمات مالی":"https://click.adtrace.io/l3062zv"
};

function buildMenu(){
  return [
    ["🎯 ماموریت روزانه"],
    ["👤 پروفایل شما"],
    ...Object.keys(BUTTONS).reduce((acc,k,i)=>{
      if(i%2===0) acc.push(Object.keys(BUTTONS).slice(i,i+2));
      return acc;
    },[])
  ];
}

/* =========================
   BOT HANDLER
========================= */
async function handle(p,id,text){
  let db=loadDB();
  initUser(db,p,id);

  let user=db.users[p][id];

  if(text==="/start"){
    saveDB(db);
    return send(p,id,"🏠 منو:",{
      reply_markup:{keyboard:buildMenu(),resize_keyboard:true}
    });
  }

  if(text==="👤 پروفایل شما"){
    return send(p,id,`💰 امتیاز: ${user.points}`);
  }

  /* =========================
     MISSIONS
  ========================= */
  if(text==="🎯 ماموریت روزانه"){

    let active=db.missionsList.filter(m=>
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
            {
              text:"🚀 شروع",
              url:`${BASE_URL}/start/${p}/${id}/${m.id}`
            },
            {
              text:"✅ انجام دادم",
              url:`${BASE_URL}/claim/${p}/${id}/${m.id}`
            }
          ]]
        }
      });
    }

    return;
  }

  if(BUTTONS[text]){
    return send(p,id,"👇 ورود",{
      reply_markup:{
        inline_keyboard:[[
          { text:"باز کردن", url:BUTTONS[text] }
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
   START (ثبت شروع واقعی)
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

  res.redirect(BASE_URL);
});

/* =========================
   CLAIM (فقط اگر start کرده باشد)
========================= */
app.get('/claim/:p/:id/:mid',(req,res)=>{
  let db=loadDB();
  let {p,id,mid}=req.params;

  initUser(db,p,id);
  let user=db.users[p][id];

  let mission=db.missionsList.find(m=>String(m.id)===String(mid));

  if(!mission) return res.send("❌ ماموریت نیست");

  if(user.completed.includes(mid)){
    return res.send("❌ قبلاً انجام شده");
  }

  if(!user.started.includes(mid)){
    return res.send("❌ اول روی شروع بزن");
  }

  user.points += Number(mission.points);
  user.completed.push(mid);

  saveDB(db);

  send(p,id,`🎉 +${mission.points}\n💰 ${user.points}`);

  res.send("OK");
});

/* =========================
   ADMIN
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

app.get('/admin/missions',(req,res)=>{
  let db=loadDB();
  res.json(db.missionsList);
});

app.post('/admin/delete-mission',(req,res)=>{
  let db=loadDB();

  db.missionsList=db.missionsList.filter(
    m=>String(m.id)!==String(req.body.id)
  );

  saveDB(db);
  res.json({ok:true});
});

app.post('/admin/mission/toggle',async(req,res)=>{
  let db=loadDB();

  let mission=db.missionsList.find(
    m=>String(m.id)===String(req.body.id)
  );

  if(!mission) return res.json({ok:false});

  mission.status=req.body.status;

  saveDB(db);

  res.json({ok:true});
});

/* =========================
   SERVER
========================= */
app.listen(3000,()=>console.log("RUNNING"));

app.get("/",(req,res)=>res.send("OK"));
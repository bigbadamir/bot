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
    db.users = db.users || {telegram:{},bale:{}};
    db.missionsList = Array.isArray(db.missionsList) ? db.missionsList : [];
    db.clicks = db.clicks || []; // 🔥 مهم
    return db;
  }catch(e){
    let fresh = { users:{telegram:{},bale:{}}, missionsList:[], clicks:[] };
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh,null,2));
    return fresh;
  }
}

function saveDB(db){
  fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2));
}

function initUser(db,p,id){
  if(!db.users[p][id]){
    db.users[p][id]={points:0,completed:[]};
  }
}

/* =========================
   MENU
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
   SEND
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

      // 🔥 این مهم‌ترین خطه
      let finalLink = `${m.link}?sub_id=${id}&sub_id2=${m.id}`;

      await send(p,id,
`${m.title}
${m.desc}
🪙 ${m.points}`,{
        reply_markup:{
          inline_keyboard:[[
            { text:"▶️ شروع", url: finalLink },
            { text:"🚀 انجام دادم", callback_data:`claim_${p}_${id}_${m.id}` }
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
   CALLBACK CLAIM
========================= */
telegramBot.on('callback_query', async query => {

  if(!query.data.startsWith("claim_")) return;

  const [,p,id,mid] = query.data.split("_");

  let db = loadDB();
  initUser(db,p,id);
  let user = db.users[p][id];

  let mission = db.missionsList.find(m=>String(m.id)===String(mid));

  if(!mission){
    return telegramBot.answerCallbackQuery(query.id,{text:"❌ ماموریت نیست"});
  }

  if(user.completed.includes(String(mid))){
    return telegramBot.answerCallbackQuery(query.id,{
      text:"⚠️ قبلاً انجام دادی"
    });
  }

  // 🔥 چک کلیک
  let clicked = db.clicks.find(c => 
    String(c.uid) === String(id) &&
    String(c.mid) === String(mid)
  );

  if(!clicked){
    return telegramBot.answerCallbackQuery(query.id,{
      text:"❌ هنوز وارد لینک نشدی",
      show_alert:true
    });
  }

  // ✅ امتیاز
  user.points += Number(mission.points);
  user.completed.push(String(mid));
  saveDB(db);

  telegramBot.answerCallbackQuery(query.id,{
    text:"🎉 انجام شد",
    show_alert:true
  });

  telegramBot.sendMessage(id,
`🎉 ماموریت تایید شد

+${mission.points}
💰 ${user.points}`);
});

/* =========================
   🔥 ADTRACE CLICK ENDPOINT
========================= */
app.get('/adtrace/click', (req,res)=>{

  let db = loadDB();

  let uid = req.query.uid;
  let mid = req.query.mid;

  if(uid && mid){

    // جلوگیری از تکراری
    let exists = db.clicks.find(c => 
      String(c.uid)===String(uid) && String(c.mid)===String(mid)
    );

    if(!exists){
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
   ADMIN APIs (بدون تغییر)
========================= */
app.get('/admin/missions',(req,res)=>{
  let db=loadDB();
  res.json(db.missionsList);
});

app.post('/admin/add-mission',(req,res)=>{
  let db=loadDB();

  db.missionsList.push({
    id: Date.now(),
    title:req.body.title,
    desc:req.body.desc,
    link:req.body.link,
    points:req.body.points,
    status:"inactive"
  });

  saveDB(db);
  res.json({ok:true});
});

app.post('/admin/delete-mission',(req,res)=>{
  let db=loadDB();
  db.missionsList=db.missionsList.filter(
    m=>String(m.id)!==String(req.body.id)
  );
  saveDB(db);
  res.json({ok:true});
});

app.post('/admin/mission/toggle',(req,res)=>{
  let db=loadDB();
  let m=db.missionsList.find(x=>String(x.id)===String(req.body.id));
  if(!m) return res.json({ok:false});
  m.status=req.body.status;
  saveDB(db);
  res.json({ok:true});
});

/* =========================
   SERVER
========================= */
app.listen(3000,()=>console.log("RUNNING"));
app.get("/",(req,res)=>res.send("OK"));

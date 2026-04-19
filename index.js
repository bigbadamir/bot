const express = require('express');
const fs = require('fs');
const axios = require('axios');
const multer = require('multer');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

/* =========================
   CONFIG
========================= */
const BASE_URL = "http://localhost:3000";

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
  async sendPhoto(chat_id, photo, options = {}) {
    return axios.post(`${BALE_API}/sendPhoto`, { chat_id, photo, ...options })
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
  let db = JSON.parse(fs.readFileSync(DB_FILE));

  if(!db.users) db.users = { telegram:{}, bale:{} };
  if(!db.missionsList) db.missionsList = [];
  if(!db.messages) db.messages = [];

  return db;
}

function saveDB(db){
  fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2));
}

/* =========================
   BUTTONS (همه سر جاش)
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
   MENU (FIX شده + کامل)
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
   SEND
========================= */
async function send(platform,id,text,options={}){
  return platform==="telegram"
    ? telegramBot.sendMessage(id,text,options)
    : baleBot.sendMessage(id,text,options);
}

/* =========================
   INIT USER
========================= */
function initUser(db,platform,id){
  if(!db.users[platform][id]){
    db.users[platform][id]={
      points:0,
      completed:[],
      started:[]
    };
  }
}

/* =========================
   HANDLER
========================= */
async function handle(platform,id,text){
  let db = loadDB();
  initUser(db,platform,id);
  saveDB(db);

  let user = db.users[platform][id];

  if(text==="/start"){
    return send(platform,id,"🏠 منو:",{
      reply_markup:{
        keyboard:buildMenu(),
        resize_keyboard:true
      }
    });
  }

  /* =========================
     PROFILE
  ========================= */
  if(text==="👤 پروفایل شما"){
    return send(platform,id,
`👤 پروفایل شما

💰 امتیاز: ${user.points}

🎯 انجام شده: ${user.completed.length}`
    );
  }

  /* =========================
     MISSIONS (FIX اصلی اینجا بود)
  ========================= */
  if(text==="🎯 ماموریت روزانه"){

    let active = db.missionsList.filter(m =>
      m.status === "active" &&
      !user.completed.includes(String(m.id))
    );

    if(active.length === 0){
      return send(platform,id,"⏳ ماموریت جدیدی نداری");
    }

    for(let m of active){
      await send(platform,id,
`${m.title}
${m.desc}
🪙 ${m.points}`,{
        reply_markup:{
          inline_keyboard:[[
            {
              text:"🚀 شروع",
              url:`${BASE_URL}/start/${platform}/${id}/${m.id}`
            },
            {
              text:"✅ انجام دادم",
              url:`${BASE_URL}/claim/${platform}/${id}/${m.id}`
            }
          ]]
        }
      });
    }

    return;
  }

  /* =========================
     BUTTONS
  ========================= */
  if(BUTTONS[text]){
    return send(platform,id,"👇 ورود",{
      reply_markup:{
        inline_keyboard:[[
          {
            text:"🚀 باز کردن",
            url:BUTTONS[text]
          }
        ]]
      }
    });
  }

  return send(platform,id,"🏠 منو:",{
    reply_markup:{
      keyboard:buildMenu(),
      resize_keyboard:true
    }
  });
}

/* =========================
   TELEGRAM
========================= */
telegramBot.on('message', msg=>{
  if(msg.text) handle("telegram",msg.chat.id,msg.text);
});

/* =========================
   BALE
========================= */
let offset=0;
async function listen(){
  try{
    let u=await baleBot.getUpdates(offset);

    for(let x of u){
      offset = x.update_id + 1;
      if(x.message){
        handle("bale",x.message.chat.id,x.message.text);
      }
    }
  }catch(e){}

  setTimeout(listen,1000);
}
listen();

/* =========================
   CLAIM (بدون تغییر مهم)
========================= */
app.get('/claim/:p/:id/:mid',(req,res)=>{
  let {p,id,mid}=req.params;

  let db=loadDB();
  initUser(db,p,id);

  let user=db.users[p][id];
  let m=db.missionsList.find(x=>String(x.id)===String(mid));

  if(!m) return res.send("❌ ماموریت وجود ندارد");

  if(user.completed.includes(String(mid)))
    return res.send("❌ قبلاً انجام شده");

  if(!user.started.includes(String(mid)))
    return res.send("❌ اول شروع کن");

  user.points += Number(m.points);
  user.completed.push(String(mid));

  saveDB(db);

  send(p,id,
`🎉 انجام شد!

🪙 +${m.points}
💰 مجموع: ${user.points}`
  );

  res.send("✅ ثبت شد");
});

/* =========================
   START
========================= */
app.get('/start/:p/:id/:mid',(req,res)=>{
  let {p,id,mid}=req.params;

  let db=loadDB();
  initUser(db,p,id);

  let user=db.users[p][id];

  if(!user.started.includes(String(mid))){
    user.started.push(String(mid));
    saveDB(db);
  }

  res.send("✅ ثبت شد");
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
    link:req.body.link,
    points:req.body.points,
    type:req.body.type,
    status:"inactive"
  });

  saveDB(db);
  res.json({ok:true});
});

app.post('/admin/mission/toggle',(req,res)=>{
  let db=loadDB();
  let m=db.missionsList.find(x=>x.id==req.body.id);

  m.status=req.body.status;
  saveDB(db);

  res.json({ok:true});
});

app.listen(3000,()=>console.log("http://localhost:3000/admin.html"));
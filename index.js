const express = require('express');
const fs = require('fs');
const axios = require('axios');
const multer = require('multer');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

const BASE_URL = "http://localhost:3000";

/* TOKENS */
const TELEGRAM_TOKEN = "8685728009:AAED7KxyD0bvKgZr6XxTXJOycBFsHtdY0Ic";
const BALE_TOKEN = "1579243381:t714UwiXVQCQDE8z2MKNuMq7Ya6K31wPggk";

const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const BALE_API = `https://tapi.bale.ai/bot${BALE_TOKEN}`;

/* BALE */
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

/* DB */
const DB_FILE = './db.json';

function loadDB(){
  let db = JSON.parse(fs.readFileSync(DB_FILE));

  if(!db.users) db.users = { telegram:{}, bale:{} };
  if(!db.missionsList) db.missionsList = [];

  return db;
}

function saveDB(db){
  fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2));
}

/* BUTTONS (برگردانده شد کامل) */
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

/* MENU */
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

/* SEND */
async function send(p,id,text,options={}){
  return p==="telegram"
    ? telegramBot.sendMessage(id,text,options)
    : baleBot.sendMessage(id,text,options);
}

/* USER INIT */
function initUser(db,p,id){
  if(!db.users[p][id]){
    db.users[p][id]={
      points:0,
      started:[],
      completed:[]
    };
  }
}

/* SINGLE HANDLER LOCK (رفع دوبار اجرا شدن) */
const running = new Set();

async function handle(p,id,text){
  const key = p+id+text;

  if(running.has(key)) return;
  running.add(key);

  setTimeout(()=>running.delete(key),500);

  let db = loadDB();
  initUser(db,p,id);
  let user = db.users[p][id];

  /* START */
  if(text==="/start"){
    saveDB(db);
    running.delete(key);

    return send(p,id,"🏠 منو:",{
      reply_markup:{ keyboard:buildMenu(), resize_keyboard:true }
    });
  }

  /* PROFILE */
  if(text==="👤 پروفایل شما"){
    saveDB(db);
    running.delete(key);

    return send(p,id,`👤 پروفایل شما\n\n💰 امتیاز: ${user.points}`);
  }

  /* MISSIONS */
  if(text==="🎯 ماموریت روزانه"){

    let active = db.missionsList.filter(m =>
      m.status==="active" &&
      !user.completed.includes(m.id)
    );

    if(active.length===0){
      running.delete(key);
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
              callback_data:`claim_${p}_${id}_${m.id}`
            }
          ]]
        }
      });
    }

    running.delete(key);
    return;
  }

  /* BUTTONS */
  if(BUTTONS[text]){
    running.delete(key);

    return send(p,id,"👇 ورود",{
      reply_markup:{
        inline_keyboard:[[{
          text:"🚀 باز کردن",
          url:BUTTONS[text]
        }]]
      }
    });
  }

  saveDB(db);
  running.delete(key);

  return send(p,id,"🏠 منو:",{
    reply_markup:{ keyboard:buildMenu(), resize_keyboard:true }
  });
}

/* CALLBACK HANDLER (خیلی مهم برای fix claim) */
telegramBot.on('callback_query', async q => {
  const [action,p,id,mid] = q.data.split('_');

  if(action!=="claim") return;

  let db = loadDB();
  initUser(db,p,id);
  let user = db.users[p][id];

  let mission = db.missionsList.find(m=>String(m.id)===mid);
  if(!mission) return;

  if(user.completed.includes(mid)){
    return telegramBot.answerCallbackQuery(q.id,{text:"قبلاً انجام شده"});
  }

  if(!user.started.includes(mid)){
    return telegramBot.answerCallbackQuery(q.id,{text:"اول روی شروع بزن"});
  }

  user.points += Number(mission.points);
  user.completed.push(mid);

  saveDB(db);

  telegramBot.answerCallbackQuery(q.id,{text:"تایید شد ✅"});

  telegramBot.sendMessage(id,
`🎉 انجام شد!

+${mission.points}
💰 کل امتیاز: ${user.points}`);
});

/* TELEGRAM */
telegramBot.on('message', msg=>{
  if(!msg.text) return;
  handle("telegram",msg.chat.id,msg.text);
});

/* BALE */
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

/* START ROUTE */
app.get('/start/:p/:id/:mid',(req,res)=>{
  let {p,id,mid} = req.params;

  let db = loadDB();
  initUser(db,p,id);

  let user = db.users[p][id];

  if(!user.started.includes(mid)){
    user.started.push(mid);
    saveDB(db);
  }

  res.send("✅ شروع ثبت شد");
});

/* ADMIN MINIMAL */
app.post('/admin/add-mission',(req,res)=>{
  let db=loadDB();

  db.missionsList.push({
    id:Date.now(),
    title:req.body.title,
    desc:req.body.desc,
    points:req.body.points,
    link:req.body.link,
    status:"inactive"
  });

  saveDB(db);
  res.json({ok:true});
});

app.listen(3000,()=>console.log("RUNNING"));
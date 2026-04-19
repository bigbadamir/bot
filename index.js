const express = require('express');
const fs = require('fs');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

/* =========================
   ⚠️ لینک واقعی سرور
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
  let db = { users:{telegram:{},bale:{}}, missionsList:[] };

  if(fs.existsSync(DB_FILE)){
    db = JSON.parse(fs.readFileSync(DB_FILE));
  }

  if(!db.users) db.users = { telegram:{}, bale:{} };
  if(!db.missionsList) db.missionsList = [];

  return db;
}

function saveDB(db){
  fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2));
}

/* =========================
   USER
========================= */
function initUser(db,p,id){
  if(!db.users[p][id]){
    db.users[p][id]={
      points:0,
      completed:[],
      started:[]
    };
  }
}

/* =========================
   BUTTONS
========================= */
const BUTTONS = {
"🚀 بازکردن برنامه":"https://click.adtrace.io/u2p3usf",
"💳 کارت به کارت":"https://click.adtrace.io/lhntx66"
};

function menu(){
  return [
    ["🎯 ماموریت روزانه"],
    ["👤 پروفایل شما"],
    ...Object.keys(BUTTONS).map(x=>[x])
  ];
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
   HANDLER
========================= */
async function handle(p,id,text){
  let db = loadDB();
  initUser(db,p,id);
  saveDB(db);

  let user = db.users[p][id];

  if(text==="/start"){
    return send(p,id,"🏠 منو:",{
      reply_markup:{ keyboard:menu(), resize_keyboard:true }
    });
  }

  if(text==="👤 پروفایل شما"){
    return send(p,id,`💰 امتیاز شما: ${user.points}`);
  }

  if(text==="🎯 ماموریت روزانه"){
    let missions = db.missionsList.filter(m =>
      m.status==="active" &&
      !user.completed.includes(m.id)
    );

    if(!missions.length)
      return send(p,id,"⏳ ماموریت جدید نداری");

    for(let m of missions){
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
        inline_keyboard:[[{
          text:"باز کن",
          url:BUTTONS[text]
        }]]
      }
    });
  }

  send(p,id,"🏠 منو:",{
    reply_markup:{ keyboard:menu(), resize_keyboard:true }
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
    let updates=await baleBot.getUpdates(offset);
    for(let u of updates){
      offset=u.update_id+1;
      if(u.message)
        handle("bale",u.message.chat.id,u.message.text);
    }
  }catch(e){}
  setTimeout(listen,1000);
}
listen();

/* =========================
   START
========================= */
app.get('/start/:p/:id/:mid',(req,res)=>{
  let {p,id,mid}=req.params;

  let db=loadDB();
  initUser(db,p,id);

  let user=db.users[p][id];

  if(!user.started.includes(mid)){
    user.started.push(mid);
    saveDB(db);
  }

  res.send("✅ ثبت شد، برگرد داخل بات");
});

/* =========================
   CLAIM (ضد تقلب + امتیاز)
========================= */
app.get('/claim/:p/:id/:mid',(req,res)=>{
  let {p,id,mid}=req.params;

  let db=loadDB();
  initUser(db,p,id);

  let user=db.users[p][id];
  let mission=db.missionsList.find(m=>m.id==mid);

  if(!mission) return res.send("❌ ماموریت نیست");

  if(user.completed.includes(mid))
    return res.send("❌ قبلاً گرفتی");

  if(!user.started.includes(mid))
    return res.send("❌ اول شروع کن!");

  user.points += Number(mission.points);
  user.completed.push(mid);

  saveDB(db);

  send(p,id,
`🎉 انجام شد!
🪙 +${mission.points}
💰 مجموع: ${user.points}`
  );

  res.send("✅ امتیاز ثبت شد");
});

/* =========================
   ADMIN ساده
========================= */
app.post('/admin/add-mission',(req,res)=>{
  let db=loadDB();

  db.missionsList.push({
    id:Date.now(),
    title:req.body.title,
    desc:req.body.desc,
    link:req.body.link,
    points:req.body.points,
    status:"active"
  });

  saveDB(db);
  res.json({ok:true});
});

/* =========================
   RUN
========================= */
app.listen(3000,()=>console.log("RUNNING"));
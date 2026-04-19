const express = require('express');
const fs = require('fs');
const axios = require('axios');
const multer = require('multer');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

/* =========================
   RENDER FIX ⭐ مهم
========================= */
app.get("/", (req, res) => {
  res.send("✅ Bot Server is Running");
});

/* اگر admin داری */
app.get("/admin", (req, res) => {
  res.sendFile(__dirname + "/public/admin.html");
});

app.use(express.static('public'));

/* =========================
   CONFIG
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
  let db = JSON.parse(fs.readFileSync(DB_FILE));
  if(!db.users) db.users = { telegram:{}, bale:{} };
  if(!db.missionsList) db.missionsList = [];
  return db;
}

function saveDB(db){
  fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2));
}

/* =========================
   BUTTONS
========================= */
const BUTTONS = {
"🚀 بازکردن برنامه":"https://click.adtrace.io/u2p3usf",
"💳 کارت به کارت":"https://click.adtrace.io/lhntx66",
"💰 خدمات مالی":"https://click.adtrace.io/l3062zv"
};

/* =========================
   MENU
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
async function send(p,id,text,options={}){
  return p==="telegram"
    ? telegramBot.sendMessage(id,text,options)
    : baleBot.sendMessage(id,text,options);
}

/* =========================
   USER INIT
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
   HANDLER
========================= */
async function handle(p,id,text){
  let db = loadDB();
  initUser(db,p,id);
  saveDB(db);

  let user = db.users[p][id];

  if(text==="/start"){
    return send(p,id,"🏠 منو:",{
      reply_markup:{ keyboard:buildMenu(), resize_keyboard:true }
    });
  }

  if(text==="👤 پروفایل شما"){
    return send(p,id,`👤 پروفایل

💰 امتیاز: ${user.points}`);
  }

  if(text==="🎯 ماموریت روزانه"){
    let active = db.missionsList.filter(m => m.status==="active");

    if(active.length===0){
      return send(p,id,"⏳ ماموریتی نیست");
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

  send(p,id,"🏠 منو:",{
    reply_markup:{ keyboard:buildMenu(), resize_keyboard:true }
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
   CLAIM
========================= */
app.get('/claim/:p/:id/:mid',(req,res)=>{
  let db=loadDB();
  let {p,id,mid}=req.params;

  let user=db.users[p][id];
  let m=db.missionsList.find(x=>x.id==mid);

  if(!m) return res.send("❌ not found");

  if(user.completed.includes(mid))
    return res.send("❌ done");

  user.points += Number(m.points);
  user.completed.push(mid);

  saveDB(db);

  send(p,id,`🎉 +${m.points}`);

  res.send("OK");
});

/* =========================
   START
========================= */
app.get('/start/:p/:id/:mid',(req,res)=>{
  let db=loadDB();
  let {p,id,mid}=req.params;

  initUser(db,p,id);
  db.users[p][id].started.push(mid);

  saveDB(db);

  res.send("OK");
});

/* =========================
   ADMIN
========================= */
app.post('/admin/add-mission',(req,res)=>{
  let db=loadDB();

  db.missionsList.push({
    id:Date.now().toString(),
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
   START SERVER
========================= */
app.listen(process.env.PORT || 3000, ()=>{
  console.log("Server Running");
});
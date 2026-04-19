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
"👥 دعوت از دوستان":"https://click.adtrace.io/px12hz6",
"🌍 گردشگری":"https://click.adtrace.io/rer2tvj",
"🚗 خدمات خودرو":"https://click.adtrace.io/wmz46ex",
"🎫 بلیت و گردشگری":"https://click.adtrace.io/yvhn9xo",
"💰 خدمات مالی":"https://click.adtrace.io/l3062zv"
};

/* =========================
   MENU
========================= */
function buildMenu(){
  const keys = Object.keys(BUTTONS);
  let keyboard = [];
  for(let i=0;i<keys.length;i+=2){
    keyboard.push(keys.slice(i,i+2));
  }
  return [["🎯 ماموریت روزانه"], ...keyboard];
}

async function send(platform,id,text,options={}){
  if(platform==="telegram"){
    return telegramBot.sendMessage(id,text,options);
  }else{
    return baleBot.sendMessage(id,text,options);
  }
}

async function sendPhoto(platform,id,file,options={}){
  if(platform==="telegram"){
    return telegramBot.sendPhoto(id,file,options);
  }else{
    return baleBot.sendPhoto(id,file,options);
  }
}

async function mainMenu(platform,id){
  await send(platform,id,"🏠 منو:",{
    reply_markup:{
      keyboard:buildMenu(),
      resize_keyboard:true
    }
  });
}

/* =========================
   HANDLER مشترک
========================= */
async function handle(platform,id,text){
  let db = loadDB();

  if(!db.users[platform][id]){
    db.users[platform][id]={points:0};
    saveDB(db);
  }

  if(text==="/start"){
    return mainMenu(platform,id);
  }

  if(text==="🎯 ماموریت روزانه"){
    let active = db.missionsList.filter(m=>m.status==="active");

    if(active.length===0)
      return send(platform,id,"⏳ ماموریت فعالی نیست");

    for(let m of active){
      await send(platform,id,
`${m.title}\n${m.desc}\n🪙 ${m.points}`,{
        reply_markup:{
          inline_keyboard:[[
            { text:"🚀 شروع", url:m.link }
          ]]
        }
      });
    }
    return;
  }

  if(BUTTONS[text]){
    return send(platform,id,"👇 ورود",{
      reply_markup:{
        inline_keyboard:[[
          { text:"🚀 باز کردن", url:BUTTONS[text] }
        ]]
      }
    });
  }

  mainMenu(platform,id);
}

/* =========================
   TELEGRAM
========================= */
telegramBot.on('message', msg=>{
  if(!msg.text) return;
  handle("telegram", msg.chat.id, msg.text);
});

/* =========================
   BALE
========================= */
let offset = 0;
async function listenBale(){
  try{
    let updates = await baleBot.getUpdates(offset);

    for(let u of updates){
      offset = u.update_id + 1;
      if(!u.message) continue;

      handle("bale", u.message.chat.id, u.message.text);
    }
  }catch(e){}

  setTimeout(listenBale,1000);
}
listenBale();

/* =========================
   PANEL API (بدون حذف هیچ فیچر)
========================= */

app.post('/upload', upload.single('file'), (req,res)=>{
  res.json({ path: req.file.path });
});

app.get('/admin/missions',(req,res)=>{
  res.json(loadDB().missionsList);
});

app.post('/admin/add-mission',(req,res)=>{
  let db = loadDB();
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

app.post('/admin/delete-mission',(req,res)=>{
  let db = loadDB();
  db.missionsList = db.missionsList.filter(m=>m.id!=req.body.id);
  saveDB(db);
  res.json({ok:true});
});

app.post('/admin/mission/toggle',(req,res)=>{
  let db = loadDB();
  let m = db.missionsList.find(x=>x.id==req.body.id);

  if(m.type==="main" && req.body.status==="active"){
    db.missionsList.forEach(x=>{
      if(x.type==="main") x.status="inactive";
    });
  }

  m.status = req.body.status;
  saveDB(db);

  /* ارسال به هر دو بات */
  for(let id of Object.keys(db.users.telegram)){
    send("telegram",id,
      m.status==="active"
      ? `🎯 شروع شد: ${m.title}`
      : `⛔ پایان یافت: ${m.title}`
    );
  }

  for(let id of Object.keys(db.users.bale)){
    send("bale",id,
      m.status==="active"
      ? `🎯 شروع شد: ${m.title}`
      : `⛔ پایان یافت: ${m.title}`
    );
  }

  res.json({ok:true});
});

app.get('/admin/users',(req,res)=>{
  res.json(loadDB().users);
});

app.get('/admin/messages',(req,res)=>{
  res.json(loadDB().messages);
});

app.post('/admin/broadcast', async (req,res)=>{
  let db = loadDB();

  let record={
    id:Date.now(),
    text:req.body.text,
    file:req.body.file,
    button:req.body.button,
    telegramIds:[],
    baleIds:[]
  };

  /* TELEGRAM */
  for(let id of Object.keys(db.users.telegram)){
    try{
      let options={ parse_mode:"HTML" };

      if(record.button?.text){
        options.reply_markup={
          inline_keyboard:[[{
            text:record.button.text,
            url:record.button.url
          }]]
        };
      }

      let sent = record.file
        ? await sendPhoto("telegram",id,record.file,{caption:record.text,...options})
        : await send("telegram",id,record.text,options);

      record.telegramIds.push({chatId:id,messageId:sent.message_id});
    }catch(e){}
  }

  /* BALE */
  for(let id of Object.keys(db.users.bale)){
    try{
      let options={};

      if(record.button?.text){
        options.reply_markup={
          inline_keyboard:[[{
            text:record.button.text,
            url:record.button.url
          }]]
        };
      }

      let sent = record.file
        ? await sendPhoto("bale",id,record.file,{caption:record.text,...options})
        : await send("bale",id,record.text,options);

      record.baleIds.push({chatId:id,messageId:sent.message_id});
    }catch(e){}
  }

  db.messages.push(record);
  saveDB(db);

  res.json({ok:true});
});

/* حذف پیام (تلگرام فقط) */
app.post('/admin/delete-message', async (req,res)=>{
  let db = loadDB();
  let msg = db.messages.find(m=>m.id==req.body.id);

  for(let t of msg.telegramIds||[]){
    try{
      await telegramBot.deleteMessage(t.chatId,t.messageId);
    }catch(e){}
  }

  db.messages = db.messages.filter(m=>m.id!=req.body.id);
  saveDB(db);

  res.json({ok:true});
});

/* ادیت پیام (تلگرام فقط) */
app.post('/admin/edit-message', async (req,res)=>{
  let db = loadDB();
  let msg = db.messages.find(m=>m.id==req.body.id);

  for(let t of msg.telegramIds||[]){
    try{
      await telegramBot.editMessageText(req.body.text,{
        chat_id:t.chatId,
        message_id:t.messageId
      });
    }catch(e){}
  }

  msg.text=req.body.text;
  saveDB(db);

  res.json({ok:true});
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on", PORT);
});

app.get("/", (req, res) => {
  res.send("OK BOT IS RUNNING");
});
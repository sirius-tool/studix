import webpush from 'web-push';

const cors = {
  'Access-Control-Allow-Origin': 'https://sirius-tool.github.io',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Device-Id,X-Device-Token',
  'Access-Control-Max-Age': '86400'
};
const json = (body, status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json; charset=utf-8',...cors}});
const jstDateTime = (date=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).reduce((o,p)=>(o[p.type]=p.value,o),{});
const jstYmd = (date=new Date()) => {const p=jstDateTime(date);return `${p.year}-${p.month}-${p.day}`};
const jstHm = (date=new Date()) => {const p=jstDateTime(date);return `${p.hour}:${p.minute}`};
const dateDiff = (a,b) => Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);
function configurePush(env){webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY)}
async function readBody(req){try{return await req.json()}catch{return null}}
async function authorized(req,env){const id=req.headers.get('X-Device-Id')||'',token=req.headers.get('X-Device-Token')||'';if(!/^[a-f0-9-]{20,80}$/i.test(id)||token.length<32)return null;const row=await env.DB.prepare('SELECT * FROM devices WHERE id=?').bind(id).first();if(!row||row.token!==token)return null;return row}
function validString(x,max=200){return typeof x==='string'&&x.length>0&&x.length<=max}
async function updateDevice(req,env,body,creating=false){
 const id=req.headers.get('X-Device-Id')||'',token=req.headers.get('X-Device-Token')||'';
 if(!/^[a-f0-9-]{20,80}$/i.test(id)||token.length<32)throw new Error('端末IDが不正です');
 const subscription=body.subscription?JSON.stringify(body.subscription):null;
 if(creating&&(!body.subscription?.endpoint||!body.subscription?.keys?.p256dh||!body.subscription?.keys?.auth))throw new Error('購読情報がありません');
 const settings=body.settings||{};const tasks=Array.isArray(body.tasks)?body.tasks:[];const schedules=Array.isArray(body.schedules)?body.schedules:[];
 if(tasks.length>500||schedules.length>200)throw new Error('登録件数が上限を超えています');
 const current=await env.DB.prepare('SELECT * FROM devices WHERE id=?').bind(id).first();
 if(current&&current.token!==token)throw new Error('端末認証に失敗しました');
 if(!current&&!creating)throw new Error('通知登録が見つかりません。通知を再度有効にしてください');
 const record={id,token,subscription:subscription||current?.subscription||null,settings:JSON.stringify(settings),tasks:JSON.stringify(tasks.filter(t=>validString(t.id,100)&&validString(t.title,200)&&/^\d{4}-\d{2}-\d{2}$/.test(t.due))),schedules:JSON.stringify(schedules.filter(s=>validString(s.id,100)&&validString(s.title,200)&&/^\d{4}-\d{2}-\d{2}$/.test(s.date))),timezone:'Asia/Tokyo',updated_at:new Date().toISOString()};
 await env.DB.prepare(`INSERT INTO devices(id,token,subscription,settings,tasks,schedules,timezone,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,settings=excluded.settings,tasks=excluded.tasks,schedules=excluded.schedules,timezone=excluded.timezone,updated_at=excluded.updated_at`).bind(record.id,record.token,record.subscription,record.settings,record.tasks,record.schedules,record.timezone,record.updated_at).run();
 return record;
}
async function send(row,env,payload){
 if(!row.subscription)return false;configurePush(env);
 try{await webpush.sendNotification(JSON.parse(row.subscription),JSON.stringify(payload),{TTL:60*60,urgency:'normal'});return true}
 catch(e){const status=Number(e.statusCode||e.status||0);if(status===404||status===410)await env.DB.prepare('UPDATE devices SET subscription=NULL WHERE id=?').bind(row.id).run();console.error('push failed',status,String(e.message||e));return false}
}
async function sendOnce(row,env,type,recordId,targetDate,payload){
 const key=`${type}:${recordId}:${targetDate}`;
 const existing=await env.DB.prepare('SELECT id FROM sent_notifications WHERE device_id=? AND notification_key=?').bind(row.id,key).first();if(existing)return false;
 const ok=await send(row,env,payload);if(ok)await env.DB.prepare('INSERT OR IGNORE INTO sent_notifications(device_id,notification_key,sent_at) VALUES(?,?,?)').bind(row.id,key,new Date().toISOString()).run();return ok;
}
async function scheduleNotifications(env){
 const now=new Date(),today=jstYmd(now),hm=jstHm(now),parts=jstDateTime(now),weekday=new Date(`${today}T00:00:00+09:00`).getDay();
 // Cloudflare Cron runs on UTC; run hourly at minute 0. Reminders are hour-based in Japan time.
 if(parts.minute!=='00')return;
 const {results=[]}=await env.DB.prepare('SELECT * FROM devices WHERE subscription IS NOT NULL').all();
 for(const row of results){
  let settings={},tasks=[],schedules=[];try{settings=JSON.parse(row.settings||'{}');tasks=JSON.parse(row.tasks||'[]');schedules=JSON.parse(row.schedules||'[]')}catch{continue}
  if(settings.dailyEnabled&&settings.dailyTime===hm&&(settings.weekdays||[1,2,3,4,5]).map(Number).includes(weekday)){
   await sendOnce(row,env,'daily','daily',today,{title:'STUDIX｜今日の勉強',body:String(settings.dailyMessage||'今日も少しずつ勉強しよう！').slice(0,120),url:'./',tag:`studix-daily-${today}`});
  }
  if(settings.deadlineEnabled!==false){
   const daysBefore=Number(settings.deadlineDays??1),allowed=daysBefore===0?[0]:daysBefore===1?[1,0]:[3,1,0];
   for(const task of tasks){const d=dateDiff(task.due,today);if(allowed.includes(d)){await sendOnce(row,env,'task',task.id,task.due,{title:d===0?'STUDIX｜課題の締切は今日！':'STUDIX｜課題の締切が近いよ',body:`${task.title}（${d===0?'今日が締切':d+'日後が締切'}）`,url:'./',tag:`studix-task-${task.id}-${task.due}`})}}
   for(const exam of schedules){const d=dateDiff(exam.date,today);if(allowed.includes(d)){await sendOnce(row,env,'exam',exam.id,exam.date,{title:d===0?'STUDIX｜テストは今日！':'STUDIX｜テスト日程のお知らせ',body:`${exam.title}（${d===0?'今日':d+'日後'}）`,url:'./',tag:`studix-exam-${exam.id}-${exam.date}`})}}
  }
 }
}
export default {
 async fetch(request,env){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const url=new URL(request.url),path=url.pathname;
  try{
   if(request.method==='GET'&&path==='/vapid-public-key')return json({publicKey:env.VAPID_PUBLIC_KEY});
   if(request.method==='POST'&&path==='/subscribe'){const body=await readBody(request);if(!body)return json({error:'JSONが不正です'},400);await updateDevice(request,env,body,true);return json({ok:true})}
   if(request.method==='POST'&&path==='/sync'){const row=await authorized(request,env);if(!row)return json({error:'端末認証に失敗しました。通知を再度有効にしてください'},401);const body=await readBody(request);if(!body)return json({error:'JSONが不正です'},400);await updateDevice(request,env,body,false);return json({ok:true})}
   if(request.method==='POST'&&path==='/settings'){const row=await authorized(request,env);if(!row)return json({error:'端末認証に失敗しました'},401);const body=await readBody(request);await env.DB.prepare('UPDATE devices SET settings=?,updated_at=? WHERE id=?').bind(JSON.stringify(body?.settings||{}),new Date().toISOString(),row.id).run();return json({ok:true})}
   if(request.method==='POST'&&path==='/test'){const row=await authorized(request,env);if(!row)return json({error:'端末認証に失敗しました'},401);const ok=await send(row,env,{title:'STUDIX｜テスト通知',body:'通知が正しく設定できているよ！',url:'./',tag:'studix-test'});return ok?json({ok:true}):json({error:'通知を送信できませんでした'},502)}
   if(request.method==='POST'&&path==='/unsubscribe'){const row=await authorized(request,env);if(!row)return json({error:'端末認証に失敗しました'},401);await env.DB.prepare('DELETE FROM devices WHERE id=?').bind(row.id).run();return json({ok:true})}
   return json({error:'Not found'},404);
  }catch(e){console.error(e);return json({error:e.message||'サーバーエラー'},400)}
 },
 async scheduled(controller,env,ctx){ctx.waitUntil(scheduleNotifications(env))}
};

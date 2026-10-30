import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {conversationScope} from './conversation-scope.mjs';
import {ProactiveAvailability} from './proactive-availability.mjs';
const local=ms=>{const s=new Date(ms+8*3600000).toISOString();return {day:s.slice(0,10),hour:Number(s.slice(11,13))};};
export function groupRhythm(db,scope,current,{now=Date.now(),botId,peerBots=[]}={}){
 if(scope.kind!=='group'||current.transport.attention!=='open'||(current.segments??[]).some(s=>s.type==='reply'&&s.reference?.sender_id===current.transport.sender_id))return {yield:false};
 const rows=db.prepare("SELECT event,text,at FROM turns WHERE peer=? AND role='user' AND at>? ORDER BY at DESC,rowid DESC LIMIT 12").all(scope.address,now-90000);
 const evidence=[],speakers=new Set();let latest=0;
 for(const row of rows){try{const t=JSON.parse(row.text).transport;if(t?.event_kind||!t?.sender_id||[botId,...peerBots].map(String).includes(t.sender_id))continue;speakers.add(t.sender_id);evidence.push(row.event);latest=Math.max(latest,row.at);}catch{}}
 speakers.add(current.transport.sender_id);
 return {yield:speakers.size>=2&&now-latest<15000,evidence:evidence.slice(0,6)};
}
// Local only: these already-public card fields never enter a new external model request.
export function publicTopics(workspace){
 try{const card=JSON.parse(readFileSync(workspace+'/projects/home/card.json','utf8'));return ['interests','wish'].flatMap(field=>(Array.isArray(card[field])?card[field]:[card[field]]).filter(s=>typeof s==='string'&&s.trim()).map(s=>({field,text:s.trim().slice(0,200)})));}catch{return [];}
}
export class SocialRhythm{
 constructor({path,service,world,policy,topics,budgetAvailable=()=>false,clock=()=>Date.now(),config={}}){
  mkdirSync(dirname(path),{recursive:true});Object.assign(this,{service,world,policy,topics,budgetAvailable,clock});
  this.config={enabled:true,dailyMax:null,cooldownMs:300000,checkMs:300000,...config};if(this.config.dailyMax!==null)this.config.dailyMax=Math.max(0,Math.floor(Number(this.config.dailyMax)||0));this.config.cooldownMs=Math.max(0,Number(this.config.cooldownMs)||0);this.config.checkMs=Math.max(300000,Number(this.config.checkMs)||300000);this.paused=true;this.closed=false;
  this.db=new DatabaseSync(path);this.db.exec("PRAGMA busy_timeout=3000;CREATE TABLE IF NOT EXISTS social_inbound(scope TEXT PRIMARY KEY,at INTEGER);CREATE TABLE IF NOT EXISTS social_attempts(event TEXT PRIMARY KEY,scope TEXT,topic TEXT UNIQUE,day TEXT,at INTEGER,state TEXT);CREATE TABLE IF NOT EXISTS social_observations(scope TEXT,kind TEXT,event TEXT,evidence TEXT,at INTEGER,PRIMARY KEY(scope,kind,event));UPDATE social_attempts SET state='uncertain' WHERE state IN ('reserved','sending');");
  this.availability=new ProactiveAvailability(this.db,{guardianIds:[policy.father_id,policy.mother_id].filter(Boolean),clock});
 }
 noteInbound(message){this.availability.observe(message);if([this.policy.bot_id,...(this.policy.peer_bot_ids??[])].map(String).includes(String(message.user_id)))return;const s=conversationScope(message.message_type,message.message_type==='group'?message.group_id:message.user_id);this.db.prepare('INSERT OR REPLACE INTO social_inbound VALUES(?,?)').run(s.address,this.clock());}
 observe(scope,event,evidence){this.db.prepare("INSERT OR IGNORE INTO social_observations VALUES(?,'yield-multi-human',?,?,?)").run(scope.address,event,JSON.stringify(evidence),this.clock());this.db.prepare('DELETE FROM social_observations WHERE at<?').run(this.clock()-30*86400000);}
 observations(scope){return this.db.prepare('SELECT kind,event,evidence,at FROM social_observations WHERE scope=? ORDER BY at DESC LIMIT 12').all(scope.address);}
 forget(scope,event){return this.db.prepare('DELETE FROM social_observations WHERE scope=? AND event=?').run(scope.address,event).changes;}
 eligible(scope,now){
  if(this.paused||this.closed||this.service.paused||this.service.closed||!this.config.enabled||this.config.dailyMax===0||!this.budgetAvailable())return false;
  const {day,hour}=local(now);if(hour<7)return false;
  if(this.config.dailyMax!==null&&this.db.prepare('SELECT count(*) n FROM social_attempts WHERE day=?').get(day).n>=this.config.dailyMax)return false;
  const last=this.db.prepare('SELECT * FROM social_attempts ORDER BY at DESC LIMIT 1').get();if(last&&now-last.at<this.config.cooldownMs)return false;
  const incoming=this.inbound(scope.address);if(now-incoming<600000||this.service.engine.queues.has(scope.address))return false;
  if(last&&['sent','uncertain','sending'].includes(last.state)&&this.inbound(last.scope)<=last.at)return false;
  return true;
 }
 inbound(address){
  let at=this.db.prepare('SELECT at FROM social_inbound WHERE scope=?').get(address)?.at??0;
  const bots=[this.policy.bot_id,...(this.policy.peer_bot_ids??[])].map(String);
  for(const row of this.service.engine.db.prepare("SELECT text,at FROM turns WHERE peer=? AND role='user' AND event NOT LIKE 'notice:%' ORDER BY at DESC LIMIT 24").all(address)){try{const t=JSON.parse(row.text).transport;if(t?.sender_id&&!bots.includes(t.sender_id)&&!t.event_kind)at=Math.max(at,row.at);}catch{}}
  return at;
 }
 tick(){if(this.job)return this.job;const job=this.run();this.job=job;job.finally(()=>{if(this.job===job)this.job=null;}).catch(()=>{});return job;}
 async run(){
  if(this.life)return this.life.tick();
  const scope=conversationScope('group',String(this.policy.group_id)),now=this.clock();if(!this.eligible(scope,now)||!this.world.getWatched().groups.map(String).includes(scope.id))return {status:'ineligible'};
  const candidate=(await this.topics()).filter(t=>['interests','wish'].includes(t.field)&&typeof t.text==='string'&&t.text.length>0&&t.text.length<=200).map(t=>({...t,hash:createHash('sha256').update(t.text.replace(/\s+/g,'').toLowerCase()).digest('hex')})).find(t=>!this.db.prepare('SELECT 1 FROM social_attempts WHERE topic=?').get(t.hash));
  if(!candidate||!this.eligible(scope,this.clock()))return {status:'no-new-topic'};
  const event='proactive:'+randomUUID(),day=local(now).day;
  this.db.prepare("INSERT INTO social_attempts VALUES(?,?,?,?,?,'reserved')").run(event,scope.address,candidate.hash,day,now);
  this.controller=new AbortController();const signal=this.controller.signal,version=this.service.engine.revisions.get(scope.address);
  try{
   // A modest first edition: quote her public card honestly; no fabricated experiences or chase question.
   const text=candidate.field==='interests'?'小窝里又翻到我感兴趣的一样：'+candidate.text:'想和家里分享一个我写在小窝里的小愿望：'+candidate.text;
   signal.throwIfAborted();this.state(event,'sending');await this.service.initiate(scope,event,text,{signal,version,send:args=>{if(this.paused||this.closed||local(this.clock()).hour<7||!this.budgetAvailable())throw Error('Initiation exit denied');return this.world.sendToTarget(args.target,{text:args.text});}});this.state(event,'sent');return {status:'sent'};
  }catch{this.state(event,'uncertain');return {status:'failed-no-retry'};}finally{this.controller=null;}
 }
 state(event,state){this.db.prepare('UPDATE social_attempts SET state=? WHERE event=?').run(state,event);}
 resume(){if(this.closed)return;this.paused=false;this.life?.resume();if(!this.timer){this.timer=setInterval(()=>void this.tick().catch(()=>{}),this.config.checkMs);this.timer.unref();}}
 async pause(){this.paused=true;clearInterval(this.timer);this.timer=null;this.controller?.abort();await this.life?.pause();await this.job?.catch(()=>{});}
 async close(){if(this.closed)return;this.closed=true;await this.pause();await this.life?.close();this.db.close();}
}

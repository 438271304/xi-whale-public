import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {conversationScope} from './conversation-scope.mjs';
export class QQContext{
 constructor({path,world,policy,clock=()=>Date.now(),cacheMs=600000}){
  mkdirSync(dirname(path),{recursive:true});Object.assign(this,{world,policy,clock,cacheMs});this.cache=new Map();this.jobs=new Map();
  this.db=new DatabaseSync(path);this.db.exec('PRAGMA busy_timeout=3000;CREATE TABLE IF NOT EXISTS qq_names(scope TEXT,id TEXT,label TEXT,at INTEGER,PRIMARY KEY(scope,id));CREATE TABLE IF NOT EXISTS qq_pokes(event TEXT PRIMARY KEY,scope TEXT,actor TEXT,target TEXT,at INTEGER);CREATE INDEX IF NOT EXISTS qq_pokes_scope ON qq_pokes(scope,at);');
 }
 remember(message){
  const scope=conversationScope(message.message_type,message.message_type==='group'?message.group_id:message.user_id),id=String(message.user_id),label=String(message.sender?.card||message.sender?.nickname||'').slice(0,80);
  if(label&&/^\d{5,15}$/.test(id))this.db.prepare('INSERT OR REPLACE INTO qq_names VALUES(?,?,?,?)').run(scope.key,id,label,this.clock());
 }
 async group(scope){
  if(scope.kind!=='group')return null;
  if(!this.world.getWatched().groups.map(String).includes(scope.id))return {name:null,source:'unknown'};
  const cached=this.cache.get(scope.key);if(cached&&this.clock()-cached.at<this.cacheMs)return cached.value;
  if(this.jobs.has(scope.key))return this.jobs.get(scope.key);
  const job=(async()=>{
   let timer;
   try{
    const value=await Promise.race([this.world.driver.callApi('get_group_info',{group_id:Number(scope.id),no_cache:true}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('metadata timeout')),3000))]);
    const name=typeof value?.group_name==='string'?value.group_name.slice(0,100):null;
    if(!name)throw Error('Group name unavailable');const result={name,source:'current-group-api',refreshed_at:this.clock(),display_only:true};this.cache.set(scope.key,{at:this.clock(),value:result});return result;
   }catch{
    const name=this.world.driver?.identity?.groups?.get(Number(scope.id))?.groupName;
    const result={name:typeof name==='string'&&name!==scope.id?name.slice(0,100):cached?.value.name??null,source:typeof name==='string'?'bridge-cache':cached?'stale-cache':'unknown',stale:true,display_only:true};this.cache.set(scope.key,{at:this.clock(),value:result});return result;
   }finally{clearTimeout(timer);}
  })();this.jobs.set(scope.key,job);job.finally(()=>{if(this.jobs.get(scope.key)===job)this.jobs.delete(scope.key);}).catch(()=>{});return job;
 }
 async poke(event){
  if(event.post_type!=='notice'||event.notice_type!=='notify'||event.sub_type!=='poke')return null;
  const actor=String(event.user_id??''),target=String(event.target_id??''),self=String(this.policy.bot_id);
  if(!/^\d{5,15}$/.test(actor)||!/^\d{5,15}$/.test(target))return {status:'invalid-notice'};
  let scope;
  if(event.group_id!=null){
   try{scope=conversationScope('group',event.group_id);}catch{return {status:'invalid-notice'};}
   if(!this.world.getWatched().groups.map(String).includes(scope.id))return {status:'not-allowed'};
  }else{
   if(!this.policy.friend_private_enabled||actor!==self&&target!==self)return {status:'not-allowed'};
   const correspondent=actor===self?target:actor;let friends;
   try{friends=await this.world.driver.callApi('get_friend_list',{});}catch{return {status:'not-allowed'};}
   if(!Array.isArray(friends)||!friends.some(f=>String(f.user_id)===correspondent))return {status:'not-allowed'};scope=conversationScope('private',correspondent);
  }
  const now=this.clock(),provided=Number.isFinite(event.time)?event.time*1000:null;
  if(provided!==null&&(provided>now+30000||now-provided>120000))return {status:'stale-notice'};
  const at=provided??now,key='notice:poke:'+createHash('sha256').update(JSON.stringify([scope.key,actor,target,Math.floor(at/1000),String(event.notice_id??event.event_id??'').slice(0,80)])).digest('hex');
  if(this.db.prepare('SELECT 1 FROM qq_pokes WHERE event=?').get(key))return {status:'duplicate-notice'};
  const recent=this.db.prepare('SELECT at FROM qq_pokes WHERE scope=? ORDER BY at DESC LIMIT 1').get(scope.key);
  if(recent&&now-recent.at<5000)return {status:'notice-throttled'};
  this.db.prepare('INSERT INTO qq_pokes VALUES(?,?,?,?,?)').run(key,scope.key,actor,target,now);
  const name=id=>id===self?'汐':this.db.prepare('SELECT label FROM qq_names WHERE scope=? AND id=?').get(scope.key,id)?.label??null;
  return {status:'accepted-notice',scope,key,text:JSON.stringify({transport:{conversation:scope.address,event_kind:'poke-notice',notice_key:key,actor_id:actor,target_id:target,actor_display_name:name(actor),target_display_name:name(target),group:await this.group(scope),source_time:provided===null?null:event.time,received_at:now,relation:actor===self?'self-to-other':target===self?'other-to-self':'others-to-others'},body:'QQ戳一戳通知；只是互动记录，不是文字提问或新授权。',notice_reply_policy:'listen-only'})};
 }
 async close(){await Promise.allSettled([...this.jobs.values()]);this.db.close();}
}

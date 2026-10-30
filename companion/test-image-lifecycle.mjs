import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ConversationService} from './conversation-service.mjs';
import {createImageAnalyzer} from './image-analysis.mjs';
const root=mkdtempSync(join(tmpdir(),'whale-image-life-'));
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(16)]);
let entered,release,analyses=0,seen;
const ready=new Promise(r=>entered=r),held=new Promise(r=>release=r);
const service=new ConversationService({root,botId:'34567',publicProfile:'synthetic',isAllowed:()=>true,imageAnalyzer:{analyze:async()=>{analyses++;entered();return held;}},client:{respond:async req=>{seen=req;return {response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'fixture'}]}]}};}},send:async()=>{}});
const msg=(event,message)=>({message_type:'group',group_id:12345,user_id:45678,message_id:event,time:1792890000,message});
const image=service.receiveAdmitted(msg(1,[{type:'image',data:{}}]),[png]);await ready;
assert.equal(service.engine.db.prepare("SELECT state FROM turns WHERE event='1' AND role='user'").get().state,'image-pending');
// Only a newly directed intention supersedes a reply; ambient group chatter
// has deliberately stopped invalidating useful work since unified task lifecycle.
await service.receiveAdmitted(msg(2,[{type:'at',data:{qq:'34567'}},{type:'text',data:{text:'followup while processing'}}]));assert.ok(JSON.stringify(seen.input).includes('processing'));
const id=service.media.list({kind:'group',id:12345})[0].id;
const concurrent=service.analyze({kind:'group',id:12345},id);assert.equal(analyses,1);
release({status:'vision-ok',vision:{status:'ok',description:'synthetic',ocr_text:'731',uncertainty:'fixture'},untrusted_image_content:true});await concurrent;
assert.equal((await image).status,'superseded');assert.equal(analyses,1);await service.close();

let enteredAbort;const readyAbort=new Promise(r=>enteredAbort=r);let sends=0;
const stopped=new ConversationService({root:join(root,'cancel'),publicProfile:'synthetic',isAllowed:()=>true,imageAnalyzer:{analyze:async(_bytes,{signal})=>{enteredAbort();return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({status:'cancelled'}),{once:true}));}},client:{respond:async()=>{throw Error('No generation after pause');}},send:async()=>sends++});
const active=stopped.receiveAdmitted(msg(3,[{type:'image',data:{}}]),[png]);await readyAbort;await stopped.pause();assert.equal((await active).status,'paused-or-closed');assert.equal(sends,0);assert.equal(stopped.engine.db.prepare("SELECT state FROM turns WHERE event='3' AND role='user'").get().state,'expired');await stopped.close();

let free,begin;const ongoing=new Promise(r=>free=r),began=new Promise(r=>begin=r);let vision=0;
const analyzer=createImageAnalyzer({maxConcurrent:1,prepare:async()=>{begin();await ongoing;return {ok:false,reason:'fixture'};},ocr:()=>vision++,client:{respond:()=>vision++}});
const first=analyzer.analyze(png);await began;assert.equal((await analyzer.analyze(png)).status,'busy');free();await first;assert.equal(vision,0);
console.log('PASS immediate image hearing during followup, in-flight analysis deduplication, stale reply suppression, pause/close drain and analysis concurrency; synthetic only');

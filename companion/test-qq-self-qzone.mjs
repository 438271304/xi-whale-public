import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {QQSelfQZone} from './qq-self-qzone.mjs';

const SELF=900000004;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fake(){
 const calls=[],posts=[],state={identity:SELF,allowed:true,loginFail:false,readFail:false,mode:'normal',serverTime:1793230000,sendGate:null,sendStarted:null};let sequence=0;
 const driver={callApi:async(action,params)=>{
  calls.push({action,params:structuredClone(params)});
  if(action==='get_login_info'){assert.deepEqual(params,{});if(state.loginFail)throw Error('SENSITIVE_LOGIN_MATERIAL');return {user_id:state.identity,nickname:'Synthetic Xi'};}
  if(action==='send_qzone_msg'){
   assert.deepEqual(Object.keys(params).sort(),['content','ugc_right']);assert.ok([1,4,64].includes(params.ugc_right));
   if(state.sendStarted)state.sendStarted.resolve();if(state.sendGate)await state.sendGate.promise;
   const post={tid:'synthetic-'+(++sequence),content:params.content,time:state.serverTime,comment_num:0,is_private:params.ugc_right===64,images:[]};posts.unshift(post);
   if(state.mode==='throw-after-send')throw Error('SENSITIVE_COOKIE_OR_RESPONSE');
   if(state.mode==='missing-tid')return {time:state.serverTime};
   return {tid:post.tid,time:state.serverTime};
  }
  if(action==='get_qzone_msg_list'){
   assert.deepEqual(Object.keys(params).sort(),['num','pos','target_uin']);assert.equal(params.target_uin,SELF);
   if(state.readFail)throw Error('SENSITIVE_WEB_RESPONSE');
   if(state.mode==='missing-list-shape')return {total:0};
   return {total:posts.length,msglist:state.mode==='missing-post-on-list'?[]:structuredClone(posts.slice(params.pos,params.pos+params.num))};
  }
  if(action==='get_qzone_msg_detail'){
   assert.deepEqual(Object.keys(params).sort(),['num','pos','target_uin','tid']);assert.equal(params.target_uin,SELF);
   if(state.readFail)throw Error('SENSITIVE_WEB_RESPONSE');
   const post=posts.find(item=>item.tid===params.tid);if(!post)throw Error('not found');
   return {tid:state.mode==='wrong-detail-id'?'wrong':post.tid,content:state.mode==='wrong-content'?'other text':post.content,comment_num:1,comments:[{uin:900000006,name:'Historical commenter',time:1793230000,content:'untrusted past comment',comment_id:'c1',replies:[]}]};
  }
  throw Error('Arbitrary API must not be exposed: '+action);
 }};
 return {driver,calls,posts,state,sends:()=>calls.filter(row=>row.action==='send_qzone_msg')};
}
let network=0;const fetchBefore=globalThis.fetch;globalThis.fetch=()=>{network++;throw Error('No real network allowed');};
try{
 const f=fake(),verified=[],q=new QQSelfQZone({path:':memory:',driver:f.driver,authorize:()=>f.state.allowed,clock:()=>1793230000000,onVerified:post=>verified.push(post)});
 assert.equal(q.status().state,'not-read');assert.equal(f.calls.length,0);
 const empty=await q.listOwn({pos:0,num:1});assert.equal(empty.ok,true);assert.deepEqual(empty.data,{total:0,msglist:[]});assert.equal(q.status().state,'read');
 const first=await q.draft({content:'  Synthetic text draft  '});assert.equal(first.ok,true);assert.equal(first.draft.privacy,'public');assert.equal(first.draft.ugc_right,1);assert.equal(first.draft.content,'Synthetic text draft');assert.equal(f.sends().length,0);
 const id=first.draft.draft_id;
 assert.equal((await q.draft({draft_id:id,expected_version:9,content:'stale'})).error.code,'version-conflict');
 const revision=await q.draft({draft_id:id,expected_version:1,content:'Final synthetic text'});assert.equal(revision.draft.version,2);
 assert.equal(q.readDraft(id,{version:1}).draft.content,'Synthetic text draft');assert.equal(q.readDraft(id).draft.content,'Final synthetic text');assert.equal(q.listDrafts({limit:1}).total,1);
 assert.equal((await q.publish(id,1)).error.code,'version-conflict');assert.equal(f.sends().length,0);
 const result=await q.publish(id,2);assert.equal(result.ok,true);assert.equal(result.state,'verified');assert.equal(result.receipt.content,'Final synthetic text');assert.equal(result.receipt.self_id,String(SELF));assert.equal(result.receipt.privacy_verified,false);assert.equal(result.receipt.verification.detail_content,true);assert.equal(result.receipt.verification.list_content,true);assert.equal(verified.length,1);
 assert.equal(f.sends().length,1);assert.deepEqual(f.sends()[0].params,{content:'Final synthetic text',ugc_right:1});
 assert.equal(q.readDraft(id).attempts[0].receipt.tid,result.receipt.tid);assert.equal(q.readDraft(id).attempts[0].state,'verified');assert.equal(q.readDraft(id).draft.published,true);assert.equal(q.readDraft(id).draft.local_only,false);
 const sendAt=f.calls.findIndex(row=>row.action==='send_qzone_msg');assert.equal(f.calls[sendAt-1].action,'get_login_info');
 const detailAt=f.calls.findIndex((row,index)=>index>sendAt&&row.action==='get_qzone_msg_detail');assert.equal(f.calls[detailAt-1].action,'get_login_info');
 assert.equal((await q.publish(id,2)).ok,false);assert.equal(f.sends().length,1);
 const duplicate=await q.draft({content:'Final synthetic text'});assert.equal((await q.publish(duplicate.draft.draft_id,1)).error.code,'duplicate-publication');assert.equal(f.sends().length,1);
 for(const [privacy,value] of [['friends',4],['self',64]]){const draft=await q.draft({content:'privacy '+privacy,privacy});const post=await q.publish(draft.draft.draft_id,1);assert.equal(post.ok,true);assert.equal(f.sends().at(-1).params.ugc_right,value);}
 const privateDraft=await q.draft({content:'private draft before edit',privacy:'self'}),privateEdit=await q.draft({draft_id:privateDraft.draft.draft_id,expected_version:1,content:'private draft after edit'});assert.equal(privateEdit.draft.privacy,'self');assert.equal(privateEdit.draft.ugc_right,64);
 f.state.serverTime=0;const timeDraft=await q.draft({content:'No reported server time',privacy:'self'}),timePost=await q.publish(timeDraft.draft.draft_id,1);assert.equal(timePost.receipt.server_time,0);assert.equal(timePost.receipt.server_time_known,false);
 assert.equal((await q.draft({draft_id:id,expected_version:2,content:'must not rewrite a sent draft'})).error.code,'draft-locked');
 for(const privacy of [1,4,64,'1','4','64','private',null,{}])assert.equal((await q.draft({content:'invalid privacy',privacy})).ok,false);
 for(const key of ['user_id','target_uin','target_uins','images','url','action']){assert.equal((await q.draft({content:'blocked extra', [key]:'forbidden'})).ok,false);}
 const callsBeforeInput=f.calls.length;assert.equal((await q.readOwn({target_uin:12345})).ok,false);assert.equal((await q.readOwn({num:101})).ok,false);assert.equal(f.calls.length,callsBeforeInput);
 const tools=Object.fromEntries(q.tools().map(tool=>[tool.name,tool]));assert.equal(tools.qzone_draft.mutation,true);assert.equal(tools.qzone_publish.mutation,true);assert.equal(tools.qzone_read.mutation,false);
 assert.equal(JSON.parse(await tools.qzone_publish.handler({draft_id:id,expected_version:2,action:'delete_qzone_msg'})).ok,false);assert.equal(f.sends().length,4);
 const denied=Object.fromEntries(q.tools({authorize:()=>false}).map(tool=>[tool.name,tool]));assert.equal(JSON.parse(await denied.qzone_publish.handler({draft_id:id,expected_version:2})).error.code,'context-denied');
 const own=await q.readOwn({tid:result.receipt.tid,num:1});assert.equal(own.data.comments[0].uin,900000006);assert.equal(own.source.self_id,String(SELF));assert.equal(own.source.actions_authorized,false);
 await q.pause();const paused=await q.draft({content:'paused'});assert.equal(paused.ok,false);assert.equal(paused.error.code,'paused');q.resume();
 await q.close();assert.equal(q.status().state,'closed');

 // Wrong account / failed login never reaches the publication action. A failed
 // pre-send draft may be edited into a new immutable version after recovery.
 const wrong=fake(),blocked=new QQSelfQZone({path:':memory:',driver:wrong.driver});
 const draft=await blocked.draft({content:'fixed identity only'});wrong.state.identity=900000001;
 const rejected=await blocked.publish(draft.draft.draft_id,1);assert.equal(rejected.state,'failed-before-send');assert.equal(rejected.error.code,'identity-mismatch');assert.equal(wrong.sends().length,0);assert.equal(blocked.status().login.state,'identity-mismatch');
 wrong.state.identity=SELF;const revised=await blocked.draft({draft_id:draft.draft.draft_id,expected_version:1,content:'safe new version'});assert.equal(revised.draft.version,2);assert.equal((await blocked.publish(draft.draft.draft_id,2)).ok,true);
 wrong.state.loginFail=true;const login=await blocked.listOwn();assert.equal(login.state,'login-error');assert.equal(blocked.status().read.state,'login-error');assert.ok(!JSON.stringify(login).includes('SENSITIVE'));
 wrong.state.loginFail=false;wrong.state.readFail=true;const readError=await blocked.listOwn();assert.equal(readError.ok,false);assert.equal(readError.not_an_empty_page,true);assert.equal(blocked.status().read.state,'api-failed');assert.ok(!JSON.stringify(readError).includes('SENSITIVE'));
 await blocked.close();

 // No second send follows a missing receipt, mismatching readback or a network
 // error that may have happened after the server accepted the post.
 for(const mode of ['throw-after-send','missing-tid','wrong-detail-id','wrong-content','missing-post-on-list']){
  const uncertain=fake();uncertain.state.mode=mode;const service=new QQSelfQZone({path:':memory:',driver:uncertain.driver,onVerified:()=>{throw Error('Unconfirmed must not invoke callback');}});
  const d=await service.draft({content:'uncertain '+mode}),r=await service.publish(d.draft.draft_id,1);assert.equal(r.ok,false);assert.equal(r.state,'uncertain');assert.equal(r.may_have_published,true);assert.equal(uncertain.sends().length,1);assert.ok(!JSON.stringify(r).includes('SENSITIVE'));
  const again=await service.draft({content:'uncertain '+mode});assert.equal((await service.publish(again.draft.draft_id,1)).error.code,'duplicate-publication');assert.equal(uncertain.sends().length,1);assert.equal(service.readDraft(d.draft.draft_id).attempts[0].state,'uncertain');assert.equal(service.readDraft(d.draft.draft_id).draft.published,null);assert.equal((await service.draft({draft_id:d.draft.draft_id,expected_version:1,content:'hide uncertain'})).error.code,'draft-locked');await service.close();
 }

 // Pausing while a send is in flight drains it, retains any returned tid, and
 // refuses to fake confirmation while current permission is paused.
 const inflight=fake();inflight.state.sendGate=deferred();inflight.state.sendStarted=deferred();const pausedService=new QQSelfQZone({path:':memory:',driver:inflight.driver});
 const pd=await pausedService.draft({content:'pause in flight'}),publishing=pausedService.publish(pd.draft.draft_id,1);await inflight.state.sendStarted.promise;
 let pauseDone=false;const pausing=pausedService.pause().then(()=>pauseDone=true);await Promise.resolve();assert.equal(pauseDone,false);inflight.state.sendGate.resolve();const held=await publishing;await pausing;assert.equal(held.state,'uncertain');assert.ok(held.tid);assert.equal(inflight.sends().length,1);await pausedService.close();

 // Verified publication survives a failure in the local memory postprocessor.
 const hook=fake(),hookService=new QQSelfQZone({path:':memory:',driver:hook.driver,onVerified:()=>{throw Error('synthetic memory hook failure');}}),hd=await hookService.draft({content:'preserve verified result'}),hr=await hookService.publish(hd.draft.draft_id,1);
 assert.equal(hr.state,'verified');assert.equal(hr.receipt.postprocessing,'failed-result-preserved');assert.equal(hookService.status().publication.state,'verified');await hookService.close();

 // Restart recovery is a local state transition, never a new login or send.
 const dir=mkdtempSync(join(tmpdir(),'whale-qzone-restart-')),path=join(dir,'qzone.sqlite3'),restart=fake();let reopened=new QQSelfQZone({path,driver:restart.driver});const rd=await reopened.draft({content:'reserved before restart'});await reopened.close();
 const db=new DatabaseSync(path);db.prepare("UPDATE qzone_drafts SET state='sending' WHERE id=?").run(rd.draft.draft_id);db.prepare("INSERT INTO qzone_operations VALUES(?,?,?,?,?,'sending',NULL,NULL,NULL,1,1)").run('interrupted',rd.draft.draft_id,1,rd.draft.digest,'public');db.close();
 const previousCalls=restart.calls.length;reopened=new QQSelfQZone({path,driver:restart.driver});assert.equal(restart.calls.length,previousCalls);assert.equal(reopened.readDraft(rd.draft.draft_id).draft.state,'uncertain');assert.equal(reopened.status().publication.state,'uncertain');
 const same=await reopened.draft({content:'reserved before restart'});assert.equal((await reopened.publish(same.draft.draft_id,1)).error.code,'duplicate-publication');assert.equal(restart.sends().length,0);await reopened.close();
 assert.equal(network,0);
 console.log('PASS fixed-self identity/parameter allowlists, three exact privacy values, local immutable drafts/CAS, send-detail-list verified receipt, no fake empty/readback success, digest dedupe, restart no resend, pause/drain, preserved callback-failure result; fake QQ only, no network/model/publication');
}finally{globalThis.fetch=fetchBefore;}

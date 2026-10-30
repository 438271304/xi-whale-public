// Real autonomous loop, profile service and temporary SQLite stores; synthetic
// model/QQ fixtures only. No provider, real account change or outgoing message.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {ConversationService} from './conversation-service.mjs';
import {CuriosityLife} from './curiosity-life.mjs';
import {QQSelfProfile} from './qq-self-profile.mjs';

// Existing profile service has a compiled fixed-self identity. Fake responses
// use that pin; no login or access to that real account is performed.
const SELF='900000004',FATHER='910480002',MOTHER='910480003',GROUP='910480004';
const NOW=Date.parse('2046-10-18T12:00:00+08:00'),OLD='Synthetic old signature',NEXT='今天想把一小块蓝色留在身边。';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const returned=req=>{const raw=req.input.filter(item=>item.type==='function_call_output').at(-1)?.output;return raw===undefined?null:JSON.parse(raw);};
function fixture(t,{mode='change',afterVerifiedFailure=false}={}) {
 const root=mkdtempSync(join(tmpdir(),'whale-life-profile-integration-'));
 let service,life,profile,now=NOW,signature=mode==='unchanged'?NEXT:OLD,sequence=0,driverHook=null,version=null,evidence=null,diary=null,reflection=null,updateResult=null;
 const calls=[],requests=[],selected=[],messages=[],results=[];
 const policy={bot_id:SELF,father_id:FATHER,mother_id:MOTHER,group_id:GROUP,group_ids:[GROUP],friend_private_enabled:true};
 const social={inbound:()=>0,availability:{status:()=>({active:false})}};
 const reply=(name,args)=>{selected.push(name);return {response:{id:'synthetic-profile-'+(++sequence),status:'completed',output:[
  {type:'function_call',name,call_id:'synthetic-call-'+sequence,arguments:JSON.stringify(args)}]},attempts:[]};};
 const client={canInitiate:()=>true,generationSettings:()=>({model:'deepseek-flash',thinking:true,reasoningEffort:'high',maxTokens:8192}),respond:async req=>{
  requests.push(req);const round=requests.length,context=JSON.parse(req.input.find(item=>item.role==='user').content);
  assert.equal(context.purpose,'self-directed opportunity, not a human command');
  assert.equal(context.pending_discoveries.length,0);assert.ok(req.tools.some(tool=>tool.name==='open_own_profile'));
  if(round===1){assert.ok(!req.tools.some(tool=>tool.name==='self_profile_update'));return reply('open_own_profile',{reason:'I want to keep a little blue thought in my own signature.'});}
  const prior=returned(req);results.push(prior);
  if(round===2){assert.equal(prior.status,'own-profile-opened');assert.equal(prior.external_write_performed,false);return reply('self_profile_read',{});}
  if(round===3){version=prior.version;assert.equal(prior.self_id,SELF);assert.equal(typeof version,'string');return reply('self_profile_update',{expected_version:version,signature:NEXT});}
  if(round===4){
   updateResult=prior;
   if(mode==='unknown'){
    assert.equal(prior.state,'readback-uncertain');assert.equal(prior.automatic_retry,false);assert.equal(prior.memory.status,'not-recorded');
    return reply('self_profile_history',{});
   }
   assert.equal(prior.state,'verified');assert.equal(prior.memory.status,'recorded');
   evidence={id:prior.memory.evidence_id,revision:prior.memory.revision};
   if(afterVerifiedFailure)throw Error('Synthetic generation interruption after a durable verified operation');
   if(mode==='unchanged'){assert.deepEqual(prior.changed,[]);assert.ok(['unchanged','partially-observed-unchanged'].includes(prior.effect));return reply('keep_quiet',{});}
   return reply('write_life_journal',{kind:'activity',evidence_ids:[evidence.id],interpretation:{feeling:'I like seeing my own small phrase beside my name.',association:'I want to keep room for small self-written thoughts.'},public_text:'A little blue thought can stay beside my name today.'});
  }
  if(round===5){
   if(mode==='unknown'){assert.equal(prior.operations.length,1);assert.equal(prior.operations[0].state,'readback-uncertain');return reply('keep_quiet',{});}
   diary=prior;assert.equal(diary.status,'saved');assert.equal(diary.facts.evidence[0].revision,evidence.revision);
   return reply('reflect_life_state',{kind:'interest',key:'small-own-phrases',operation:'record',expected_revision:0,
    value:'I want to keep changing my own short phrases when real experiences give me something to say.',reason:'This verified own-profile result made me notice that preference.',evidence_refs:[evidence]});
  }
  assert.equal(round,6);reflection=prior;assert.equal(reflection.status,'saved');return reply('keep_quiet',{});
 }};
 service=new ConversationService({root:join(root,'conversation'),client,publicProfile:'Synthetic independent companion.',botId:SELF,guardianIds:[FATHER,MOTHER],
  isAllowed:()=>true,wait:async()=>{},send:async value=>{messages.push(value);throw Error('Profile expression must not send a QQ message');},
  stickerOptions:{request:async()=>{throw Error('No download allowed');},prepare:async()=>{throw Error('No image operation allowed');}}});
 service.cognition.store.clock=()=>now;service.social=social;
 profile=new QQSelfProfile({path:join(root,'profile.sqlite3'),clock:()=>now,authorize:()=>!service.paused&&!service.closed,
  driver:{callApi:async(name,args)=>{
   calls.push({name,args});await driverHook?.(name,args);
   if(name==='get_login_info')return {user_id:SELF,nickname:'Synthetic whale'};
   if(name==='get_stranger_info'){assert.equal(args.user_id,Number(SELF));return {user_id:SELF,nickname:'Synthetic whale',long_nick:signature};}
   if(name==='set_self_longnick'){assert.deepEqual(args,{longNick:NEXT});if(mode!=='unknown')signature=args.longNick;return {};}
   throw Error('Unexpected profile fixture API: '+name);
  }}});
 service.selfProfile=profile;
 life=new CuriosityLife({path:join(root,'life.sqlite3'),service,social,world:{getWatched:()=>({groups:[Number(GROUP)],users:[]}),sendToTarget:async()=>{throw Error('No outgoing QQ');}},
  policy,client,tools:[],topics:()=>[],clock:()=>now});life.resume();
 t.after(async()=>{await life.close();await service.close();assert.equal(messages.length,0);const target=realpathSync(root);assert.ok(target.startsWith(realpathSync(tmpdir())+sep));rmSync(target,{recursive:true,force:true});});
 return {root,service,life,profile,calls,requests,selected,results,messages,
  get evidence(){return evidence;},get diary(){return diary;},get reflection(){return reflection;},get updateResult(){return updateResult;},get signature(){return signature;},
  hook:fn=>{driverHook=fn;},writes:()=>calls.filter(row=>row.name.startsWith('set_')),
  evidenceRows:()=>service.cognition.store.db.prepare("SELECT id FROM experiences WHERE event LIKE 'own-profile:%'").all(),
  advance:()=>{now+=31*60000;}};
}

test('one autonomous signature choice reads fixed-self, verifies one update and saves own experience, journal and reflection',async t=>{
 const f=fixture(t),result=await f.life.tick();
 assert.equal(result.status,'life-reflection-saved');assert.equal(f.requests.length,6);assert.equal(f.signature,NEXT);
 assert.deepEqual(f.selected,['open_own_profile','self_profile_read','self_profile_update','write_life_journal','reflect_life_state','keep_quiet']);
 assert.equal(f.writes().length,1);assert.equal(f.writes()[0].name,'set_self_longnick');
 const operations=f.profile.history().operations;assert.equal(operations.length,1);assert.equal(operations[0].state,'verified');
 assert.deepEqual(operations[0].actions,['signature']);assert.deepEqual(operations[0].interpretation.observed_changes,['signature']);
 const evidence=f.service.cognition.store.get(f.evidence),payload=JSON.parse(evidence.text);
 assert.equal(evidence.author.id,SELF);assert.equal(evidence.author.kind,'self');assert.equal(evidence.scope,'unknown');assert.equal(evidence.role,'self');
 assert.deepEqual(evidence.sources.map(row=>row.source),['verified-own-profile-result']);
 assert.equal(payload.receipt.operation_id,operations[0].id);assert.equal(payload.after.signature,NEXT);assert.equal(payload.before_version,f.updateResult.before_version);
 assert.equal(payload.after.version,f.updateResult.after.version);assert.equal(payload.after.avatar_sha,null);
 assert.equal(f.diary.published,false);assert.equal(f.diary.interpretation_is_not_source_fact,true);assert.equal(f.diary.facts.evidence[0].revision,f.evidence.revision);
 assert.equal(f.reflection.source_refs[0].author.id,SELF);assert.equal(f.reflection.source_refs[0].revision,f.evidence.revision);
 assert.equal(f.reflection.interpretation_is_not_source_fact,true);
 assert.equal(f.life.db.prepare('SELECT count(*) n FROM discoveries').get().n,0);
 assert.equal(f.life.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,0);
 assert.equal(f.life.db.prepare('SELECT count(*) n FROM life_corner_posts').get().n,0);
 assert.equal(f.life.db.prepare('SELECT state FROM life_heartbeats').get().state,'finished');
 // Reload retained evidence independently after the real services close.
 const journalId=f.diary.id;await f.life.close();await f.service.close();
 const {ExperienceMemory}=await import('./experience-memory.mjs');
 const {LifeJournal}=await import('./life-journal.mjs');
 const store=new ExperienceMemory({path:join(f.root,'conversation','experience.sqlite3'),botId:SELF,clock:()=>NOW});
 try{assert.equal(store.get(f.evidence).found,true);assert.equal(new LifeJournal({store,clock:()=>NOW}).get(journalId).facts.evidence[0].revision,f.evidence.revision);
  assert.equal(store.getState({kind:'interest',key:f.reflection.key})[0].revision,f.reflection.current_revision);
 }finally{store.close();}
});

test('same signature is a verified observation without a setter or invented new change',async t=>{
 const f=fixture(t,{mode:'unchanged'}),result=await f.life.tick();
 assert.equal(result.status,'own-profile-result-saved');assert.equal(f.writes().length,0);assert.equal(f.evidenceRows().length,1);
 const receipt=f.profile.history().operations[0].interpretation;
 assert.deepEqual(receipt.observed_changes,[]);assert.deepEqual(receipt.executed_actions,[]);
 assert.ok(['unchanged','partially-observed-unchanged'].includes(receipt.effect));assert.equal(f.requests.length,4);
});

test('unconfirmed readback stays unknown with one attempt, readable history and no success experience',async t=>{
 const f=fixture(t,{mode:'unknown'}),result=await f.life.tick();
 assert.equal(result.status,'own-profile-read');assert.equal(f.writes().length,1);assert.equal(f.signature,OLD);
 assert.equal(f.profile.history().operations[0].state,'readback-uncertain');assert.equal(f.evidenceRows().length,0);
 assert.deepEqual(f.selected,['open_own_profile','self_profile_read','self_profile_update','self_profile_history','keep_quiet']);
 assert.equal(f.updateResult.automatic_retry,false);assert.equal(f.life.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,0);
});

test('generation ending after verified update preserves durable progress instead of losing or repeating the operation',async t=>{
 const f=fixture(t,{afterVerifiedFailure:true}),result=await f.life.tick();
 assert.equal(result.status,'partial-progress-saved');assert.ok(result.saved_progress.reflections.includes('own-profile-result-saved'));
 assert.equal(f.writes().length,1);assert.equal(f.evidenceRows().length,1);assert.equal(f.profile.history().operations[0].state,'verified');
 assert.equal(f.life.db.prepare('SELECT state FROM activities').get().state,'unfinished');
});

test('service and life pause drain an in-flight prewrite lookup; no new change occurs or old work revives',async t=>{
 const f=fixture(t),entered=deferred(),release=deferred();let logins=0;
 // The first lookup is the explicit read, second is update's baseline read,
 // and third is the identity check immediately preceding its external write.
 f.hook(async name=>{if(name==='get_login_info'&&++logins===3){entered.resolve();await release.promise;}});
 const running=f.life.tick();await entered.promise;
 let drained=false;const stopping=Promise.all([f.service.pause(),f.life.pause()]).then(()=>{drained=true;});
 try{await turn();assert.equal(drained,false);assert.equal(f.profile.paused,true);assert.equal(f.writes().length,0);}finally{release.resolve();}
 await stopping;const result=await running;assert.equal(result.status,'interrupted');assert.equal(f.writes().length,0);assert.equal(f.signature,OLD);
 assert.equal(f.profile.history().operations[0].state,'failed-before-send');assert.equal(f.evidenceRows().length,0);
 const calls=f.calls.length;assert.equal((await f.life.tick()).status,'ineligible-or-not-due');
 await assert.rejects(f.profile.tools().find(tool=>tool.name==='self_profile_update').handler({expected_version:'unused',signature:NEXT}),/paused/);
 assert.equal(f.calls.length,calls);assert.equal(f.profile.pending.size,0);
 f.service.resume();f.life.resume();f.hook(null);
 assert.equal((await f.profile.read()).signature,OLD);assert.equal(f.writes().length,0,'resume does not replay the interrupted choice');
});

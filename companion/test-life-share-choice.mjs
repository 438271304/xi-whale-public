import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {UnifiedCognition} from './cognition-tools.mjs';
import {CuriosityLife} from './curiosity-life.mjs';

// Real life orchestration/stores, scripted model and in-memory source responses.
// A busy synthetic recipient defers every intention before any delivery call.
const BOT='930010001',FATHER='930010002',GROUP='930020001';
const DAY=Date.parse('2036-10-18T12:00:00+08:00');
const initial=req=>JSON.parse(req.input.find(item=>item.role==='user').content);
const last=req=>{const value=req.input.filter(item=>item.type==='function_call_output').at(-1)?.output;try{return JSON.parse(value);}catch{return value;}};
const names=req=>req.tools.map(tool=>tool.name);
const choose={name:'choose_activity',args:{topic:'A synthetic seaside pattern',why:'I want to understand this small observation.'}};
const save={name:'save_discovery',args:{summary:'The returned synthetic source describes a small pattern.'}};
const quiet={name:'keep_quiet',args:{}};
const share={name:'share_discovery',args:{recipient:'father',recipient_reason:'This small observation reminded me of him.',text:'合成分享：我刚弄明白一个小变化。'}};
function fixture(t){
 let now=DAY,steps=[],sequence=0,transportAttempts=0,rosterReads=0;
 const root=mkdtempSync(join(tmpdir(),'whale-share-choice-'));
 const cognition=new UnifiedCognition(root,{botId:BOT,guardianIds:[FATHER],clock:()=>now});
 const conversationDb=new DatabaseSync(':memory:');conversationDb.exec('CREATE TABLE turns(peer TEXT,event TEXT,role TEXT,text TEXT,at INTEGER,state TEXT)');
 const service={cognition,paused:false,closed:false,engine:{db:conversationDb,queues:new Map(),revisions:new Map(),profile:'Synthetic persona'},
  initiate:async()=>{transportAttempts++;throw Error('No delivery is allowed in this fixture');}};
 const client={canInitiate:()=>true,respond:async req=>{
  const context=initial(req);assert.equal(context.contact_roster.friend_state,'available');
  assert.ok(context.sharing_audiences.some(target=>target.recipient==='father'&&target.target_kind==='private'&&target.target_id===FATHER));
  assert.ok(steps.length,'No unplanned model call');const step=steps.shift(),action=typeof step==='function'?step(req):step;
  return {response:{id:'synthetic-'+(++sequence),status:'completed',output:[{type:'function_call',call_id:'call-'+sequence,name:action.name,arguments:JSON.stringify(action.args)}]}};
 }};
 const readers=['public_search','public_fetch','bilibili_read'].map(name=>({name,description:'Return a synthetic source without a network.',
  parameters:{type:'object',properties:{query:{type:'string'}},required:[],additionalProperties:false},handler:()=>JSON.stringify({status:'ok',
   ...(name==='bilibili_read'?{content:{metadata_read:true,subtitle_read:false}}:{}),
   sources:[{url:'https://example.org/'+name,title:'Synthetic source',excerpt:'A bounded, actually returned fixture observation.'}]})}));
 // Match the current bridge contract: a configured family alias alone is not
 // a verified private recipient. This fake supplies only a synthetic roster.
 const world={getWatched:()=>({groups:[GROUP]}),driver:{identity:{selfId:Number(BOT)},callApi:async(name,args)=>{
  assert.equal(name,'get_friend_list');assert.deepEqual(args,{});rosterReads++;return [{user_id:Number(FATHER),nickname:'Synthetic father'}];
 }}};
 const life=new CuriosityLife({path:join(root,'life.sqlite3'),service,client,world,
  policy:{bot_id:BOT,group_id:GROUP,father_id:FATHER,friend_private_enabled:true},social:{inbound:()=>now},tools:readers,clock:()=>now});
 life.resume();t.after(async()=>{await life.close();cognition.close();conversationDb.close();});
 return {life,cognition,get now(){return now;},get transportAttempts(){return transportAttempts;},plan(...next){steps=next;},
  done(){assert.equal(steps.length,0,'Every expected decision was exercised');assert.equal(transportAttempts,0);assert.ok(rosterReads>0,'Current private roster was checked');},advance(){now+=31*60000;},
  intents:()=>life.db.prepare('SELECT * FROM life_share_intents ORDER BY created').all(),
  own:()=>cognition.store.recordMessage({scope:'private:'+BOT,event:'synthetic-own-result',role:'self',at:now-60000,source:'verified-workshop-result',
   text:'A stored synthetic experiment result changed my earlier expectation.',metadata:{execution_verified:true,job_id:'synthetic-job',project_id:'synthetic-project',version:2}})};
}
function ordinaryOptions(req){
 assert.ok(!names(req).includes('share_discovery'));
 for(const name of ['reach_out_from_life','reconsider_discovery','leave_in_my_corner','keep_quiet','take_a_break'])assert.ok(names(req).includes(name),name);
}

test('an existing work can become a journal and personal sharing wish without pretending to save new public research',async t=>{
 const f=fixture(t),own=f.own();let journal;
 f.plan(req=>{ordinaryOptions(req);return {name:'read_life_experience',args:{id:own.id}};},
  req=>{ordinaryOptions(req);assert.equal(last(req).id,own.id);return {name:'write_life_journal',args:{kind:'activity',evidence_ids:[own.id],interpretation:{feeling:'这个结果让我重新想了一下。',share:{audience:'father',reason:'想把这个小变化讲给他。'}}}};},
  req=>{ordinaryOptions(req);journal=last(req);assert.equal(journal.status,'saved');return {name:'reach_out_from_life',args:{recipient:'father',reason:'My actual work changed my mind.',evidence_ids:journal.facts.evidence.map(ref=>ref.id),text:'合成分享：刚才自己的结果让我改口了。'}};});
 const result=await f.life.tick();f.done();assert.equal(result.status,'saved-share-deferred');
 assert.equal(f.intents().length,1);assert.equal(f.intents()[0].state,'queued');assert.equal(f.intents()[0].target_id,FATHER);assert.equal(f.intents()[0].reason,'not-timely-for-recipient');
 const refs=JSON.parse(f.life.db.prepare('SELECT refs FROM life_contact_sources').get().refs);assert.equal(refs[0].id,own.id);
 assert.equal(f.life.db.prepare('SELECT count(*) n FROM discoveries').get().n,0);assert.equal(journal.public_text,null);
 const log=f.life.opportunityLog.read(result.activity);assert.ok(log.durable_kinds.includes('journal-saved'));assert.equal(log.tool_failed_count,0);
});

test('search-only rejection offers usable recovery and can rest without creating a discovery or sharing intent',async t=>{
 const f=fixture(t);
 f.plan(choose,{name:'public_search',args:{}},save,req=>{
  ordinaryOptions(req);const refusal=last(req);assert.equal(refusal.status,'rejected');assert.equal(refusal.saved,false);assert.equal(refusal.shared,false);
  assert.equal(refusal.reason,'actual-reading-required');assert.ok(refusal.next_options.includes('public_fetch'));assert.ok(refusal.next_options.includes('take_a_break'));
  return {name:'take_a_break',args:{reason:'先留着这个线索，稍后再想。',minutes:45}};
 });
 const result=await f.life.tick();f.done();assert.equal(result.status,'resting');assert.equal(f.intents().length,0);assert.equal(f.cognition.store.counts().messages,0);
 assert.equal(f.life.db.prepare('SELECT level FROM life_reading_evidence').get().level,'search-lead');
 assert.equal(f.life.opportunityLog.read(result.activity).tool_rejected_count,1);
});

for(const [reader,level] of [['public_fetch','page-text'],['bilibili_read','metadata-only']])test(reader+' opens new-discovery sharing only after saving, and the next opportunity still uses pending reconsideration',async t=>{
 const f=fixture(t);let evidence;
 f.plan(req=>{ordinaryOptions(req);return choose;},req=>{ordinaryOptions(req);return {name:reader,args:{}};},req=>{ordinaryOptions(req);return save;},
  req=>{const result=last(req);assert.equal(result.saved,true);evidence=result.evidence_id;assert.equal(names(req).filter(n=>n==='share_discovery').length,1);return share;});
 const result=await f.life.tick();f.done();assert.equal(result.status,'saved-share-deferred');
 const intent=f.intents()[0];assert.equal(intent.evidence,evidence);assert.equal(intent.state,'queued');assert.equal(intent.target_id,FATHER);assert.equal(intent.reason,'not-timely-for-recipient');assert.equal(f.life.continuity.sources(intent.activity)[0].level,level);
 const tool=f.life.opportunityLog.read(intent.activity).events.find(event=>event.kind==='tool'&&event.name==='share_discovery');assert.ok(tool);assert.equal(tool.invocation_ok,true);
 f.advance();f.plan(req=>{ordinaryOptions(req);assert.equal(initial(req).pending_discoveries[0].id,intent.id);return {name:'reconsider_discovery',args:{id:intent.id,decision:'share',reason:'I still want to share this saved observation when it is timely.'}};});
 const next=await f.life.tick();f.done();assert.equal(next.status,'saved-share-deferred');assert.equal(f.intents().length,1);assert.equal(f.intents()[0].id,intent.id);assert.equal(f.intents()[0].reason,'not-timely-for-recipient');
 assert.equal(f.life.db.prepare('SELECT count(*) n FROM discoveries').get().n,1);
});

test('a source-store failure after reading does not expose sharing or leak its exception into recovery',async t=>{
 const f=fixture(t),record=f.cognition.store.recordMessage.bind(f.cognition.store),secret='SYNTHETIC-PRIVATE-FAILURE-SENTINEL';
 f.cognition.store.recordMessage=args=>{if(args.source==='public-exploration')throw Error(secret);return record(args);};
 f.plan(choose,{name:'public_fetch',args:{}},save,req=>{ordinaryOptions(req);assert.equal(typeof last(req),'string');assert.match(last(req),/rejected|failed/);assert.ok(!last(req).includes(secret));return quiet;});
 const result=await f.life.tick();f.done();assert.equal(result.status,'kept-private-or-quiet');assert.equal(f.intents().length,0);assert.equal(f.cognition.store.counts().messages,0);
 assert.equal(f.life.opportunityLog.read(result.activity).tool_failed_count,1);
});

test('saving before any exploration gives the existing-work route without starting research or ending the opportunity',async t=>{
 const f=fixture(t);
 f.plan(save,req=>{ordinaryOptions(req);const refusal=last(req);assert.equal(refusal.saved,false);assert.equal(refusal.status,'rejected');assert.ok(refusal.next_options.includes('reach_out_from_life'));assert.ok(refusal.next_options.includes('choose_activity'));return quiet;});
 const result=await f.life.tick();f.done();assert.equal(result.status,'kept-private-or-quiet');assert.equal(f.life.db.prepare('SELECT count(*) n FROM discoveries').get().n,0);
 assert.equal(f.intents().length,0);assert.equal(f.cognition.store.counts().messages,0);
});

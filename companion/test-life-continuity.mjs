import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CuriosityLife} from './curiosity-life.mjs';
import {UnifiedCognition} from './cognition-tools.mjs';
import {guardQQWorld} from './qq-event-policy.mjs';

// Real life handlers/stores, scripted provider and transport. No live QQ, network,
// credentials or model calls. Every SQLite file is inside a fresh temp directory.
const GROUP='900000002',HUMAN='900000001';
const choose=(source_state)=>({name:'choose_activity',args:{topic:'Tides',why:'Continue a sourced question',...(source_state?{source_state}:{})}});
const read={name:'public_fetch',args:{url:'https://example.org/tides'}};
const save={name:'save_discovery',args:{summary:'The source explains a tidal pattern.'}};
const share={name:'share_discovery',args:{text:'今天读到潮汐变化的一条具体解释。',recipient:'family',recipient_reason:'This specific public observation seems worth sharing together.'}};
const quiet={name:'keep_quiet',args:{}};
const stateRef=row=>({kind:row.kind,key:row.key,revision:row.revision});
const initial=req=>JSON.parse(req.input.find(x=>x.role==='user').content);
const lastOutput=req=>{
 const value=req.input.filter(x=>x.type==='function_call_output').at(-1)?.output;
 try{return JSON.parse(value);}catch{return value;}
};

function fixture(t,{busy=false,failSend=false}={}){
 const root=mkdtempSync(join(tmpdir(),'whale-life-continuity-'));
 let now=Date.parse('2036-10-16T12:00:00+08:00'),steps=[],callId=0,readingHook=null;
 const cognition=new UnifiedCognition(root),requests=[],attempts=[],sent=[];
 const conversationDb=new DatabaseSync(':memory:');conversationDb.exec('CREATE TABLE turns(peer TEXT,event TEXT,role TEXT,text TEXT,at INTEGER,state TEXT,PRIMARY KEY(peer,event,role))');
 const engine={db:conversationDb,queues:new Map(),revisions:new Map(),profile:'Synthetic identity; no real conversation'};
 const service={paused:false,closed:false,cognition,engine,listening:{status:()=>({active:false})},
  initiate:async(scope,event,text,{send,signal})=>{signal?.throwIfAborted();return send({target:{kind:scope.kind,id:scope.id},text});}};
 let watched={groups:[GROUP],users:[]};
 const world={handleEvent:async()=>({accepted:true}),getWatched:()=>watched,setWatched:(groups,users)=>{watched={groups,users};},sendToTarget:async(target,value)=>{
  attempts.push({target,...value});if(failSend)throw Error('Synthetic uncertain transport');
  const receipt={message_id:1000+sent.length};sent.push({target,...value,receipt});return receipt;
 }};
 guardQQWorld(world,{bot_id:'910710001',group_id:GROUP,follow_configured_groups:true},()=>new Date(now));
 const client={canInitiate:()=>true,generationSettings:()=>({model:'deepseek-flash',reasoningEffort:'high',maxTokens:8192}),respond:async req=>{
  if(req.tools.some(tool=>tool.name==='finish_life_share'))return {response:{id:'fixture-share-'+(++callId),status:'completed',output:[{type:'function_call',name:'finish_life_share',call_id:'share-'+callId,arguments:JSON.stringify({decision:'share',text:initial(req).draft,reason:'Preserve the fixture draft for transport assertions.'})}]},attempts:[]};
  requests.push(structuredClone(req));assert.ok(steps.length,'Scripted provider ran out of expected decisions');
  const next=steps.shift(),action=typeof next==='function'?await next(req):next;
  return {response:{id:'fixture-'+(++callId),status:'completed',output:[{type:'function_call',name:action.name,call_id:'call-'+callId,arguments:JSON.stringify(action.args)}]},attempts:[]};
 }};
 const tool=(name,handler)=>({name,description:'Synthetic public reader',parameters:{type:'object',properties:{url:{type:'string'},query:{type:'string'}},additionalProperties:false},handler});
 const source={url:'https://example.org/tides',title:'Tides',excerpt:'A bounded, actually returned explanation of tidal patterns.'};
 const tools=[tool('public_fetch',async()=>{if(readingHook)await readingHook();return JSON.stringify({status:'ok',sources:[source],retrieved_at:new Date(now).toISOString()});}),
  tool('public_search',()=>JSON.stringify({status:'ok',sources:[source],notice:'Search leads only, no page was read.'}))];
 const config={path:join(root,'life.sqlite3'),service,social:{inbound:()=>busy?now:0},world,policy:{bot_id:'910710001',group_id:GROUP},client,topics:()=>[],clock:()=>now,tools};
 let life=new CuriosityLife(config);life.resume();
 const lives=[life];t.after(async()=>{for(const item of lives)await item.close();cognition.close();conversationDb.close();});
 return {root,cognition,service,requests,attempts,sent,
  get life(){return life;},setBusy(value){busy=value;},setFailSend(value){failSend=value;},
  onRead(handler){readingHook=handler;},advance(){now+=31*60000;},
  plan(...items){steps=[...items];},assertConsumed(){assert.equal(steps.length,0,'Every scripted decision must be exercised');},
  async restart(){await life.close();life=new CuriosityLife(config);lives.push(life);life.resume();return life;},
  addState({key='reflection:tides',active=true,value='I want to understand tidal patterns.',kind='interest'}={}){
   const evidence=cognition.store.recordMessage({scope:'unknown',event:'seed:'+key+':'+now,role:'self',text:'Synthetic public observation',at:now,source:'public-exploration'});
   cognition.store.setState({kind,key,value:{interpretation:value,active},evidence:[{type:'message',id:evidence.id}],at:now,source:'test-fixture'});
   return cognition.store.getState({kind,key,limit:1})[0];
  }
 };
}

async function deferredDiscovery(t){
 const f=fixture(t,{busy:true});f.plan(choose(),read,save,share);
 const result=await f.life.tick();f.assertConsumed();
 assert.equal(result.status,'saved-share-deferred');assert.equal(f.sent.length,0);
 const intent=f.life.continuity.get(result.share_intent);assert.equal(intent.state,'queued');
 return {f,result,intent};
}

test('busy family chat permits real exploration, links exact state revision, and persists the deferred share',async t=>{
 const f=fixture(t,{busy:true}),state=f.addState();
 f.service.engine.queues.set('group:'+GROUP,Promise.resolve());
 f.plan(choose(stateRef(state)),read,save,share);
 const result=await f.life.tick();f.assertConsumed();
 assert.equal(result.status,'saved-share-deferred');assert.equal(f.sent.length,0);
 assert.equal(f.life.recent()[0].state,'completed');
 const intention=f.life.continuity.intention(result.activity);
 assert.equal(intention.basis.type,'continuing-own-interest');
 assert.deepEqual(stateRef(intention.basis.source_state),stateRef(state));
 const pending=f.life.continuity.get(result.share_intent);
 assert.equal(pending.state,'queued');assert.equal(pending.activity,result.activity);
 const evidence=f.cognition.store.get({id:pending.evidence});assert.equal(evidence.found,true);
 assert.deepEqual(stateRef(JSON.parse(evidence.text).intention.basis.source_state),stateRef(state));
 assert.deepEqual(f.life.continuity.sources(result.activity).map(x=>x.level),['page-text']);
 await f.restart();f.advance();
 f.plan(req=>{assert.equal(initial(req).pending_discoveries[0].id,pending.id);return {name:'reconsider_discovery',args:{id:pending.id,decision:'later',reason:'The group is still talking'}};});
 assert.equal((await f.life.tick()).status,'kept-private-or-quiet');
 assert.equal(f.life.continuity.get(pending.id).state,'queued');assert.equal(f.sent.length,0);f.assertConsumed();
});

for(const decision of ['share','discard'])test('restart lets the model '+decision+' a saved discovery without replaying terminal deliveries',async t=>{
 const {f,intent}=await deferredDiscovery(t);f.setBusy(false);f.advance();await f.restart();
 f.plan(req=>{assert.equal(initial(req).pending_discoveries[0].id,intent.id);return {name:'reconsider_discovery',args:{id:intent.id,decision,reason:'A fresh decision based on current relevance'}};});
 const result=await f.life.tick();f.assertConsumed();
 assert.equal(result.status,decision==='share'?'sent':'kept-private-or-quiet');
 assert.equal(f.life.continuity.get(intent.id).state,decision==='share'?'sent':'discarded');
 assert.equal(f.sent.length,decision==='share'?1:0);
 if(decision==='share')assert.equal(JSON.parse(f.life.continuity.get(intent.id).receipt).message_id,1000);
 f.advance();await f.restart();f.plan(req=>{assert.equal(initial(req).pending_discoveries.length,0);return quiet;});
 await f.life.tick();f.assertConsumed();assert.equal(f.attempts.length,decision==='share'?1:0);
});

test('a transport attempt with uncertain delivery remains uncertain across restart and is never offered again',async t=>{
 const {f,intent}=await deferredDiscovery(t);f.setBusy(false);f.setFailSend(true);f.advance();await f.restart();
 f.plan({name:'reconsider_discovery',args:{id:intent.id,decision:'share',reason:'It is timely now'}});
 assert.equal((await f.life.tick()).status,'uncertain-no-retry');assert.equal(f.attempts.length,1);
 assert.equal(f.life.continuity.get(intent.id).state,'uncertain');
 f.advance();await f.restart();f.setFailSend(false);
 f.plan(req=>{assert.equal(initial(req).pending_discoveries.length,0);return quiet;});
 await f.life.tick();f.assertConsumed();assert.equal(f.attempts.length,1);assert.equal(f.sent.length,0);
 assert.equal(f.life.continuity.get(intent.id).state,'uncertain');
});

test('a crash during sending becomes uncertain and does not become a pending draft again',async t=>{
 const {f,intent}=await deferredDiscovery(t);
 f.life.continuity.begin(intent.id,'synthetic-crash-attempt');await f.restart();
 assert.equal(f.life.continuity.get(intent.id).state,'uncertain');
 f.advance();f.plan(req=>{assert.equal(initial(req).pending_discoveries.length,0);return quiet;});
 await f.life.tick();f.assertConsumed();assert.equal(f.attempts.length,0);
});

test('choosing quiet before exploration does not claim or interrupt a queued human follow-up',async t=>{
 const f=fixture(t),followup=f.life.followups.enqueue({topic:'Tides',question:'How do tides vary?',scope:'group:'+GROUP,event:'123456789',senderId:HUMAN});
 f.plan(req=>{assert.equal(initial(req).queued_public_followup.id,followup.id);return quiet;});
 assert.equal((await f.life.tick()).status,'kept-private-or-quiet');f.assertConsumed();
 const current=f.life.followups.get(followup.id);assert.equal(current.state,'queued');assert.equal(current.activity_id,null);
 assert.equal(f.life.db.prepare('SELECT count(*) n FROM life_intentions').get().n,0);assert.equal(f.sent.length,0);
});

test('search summaries cannot complete a discovery or create a share intent',async t=>{
 const f=fixture(t);let saveRejected=false,shareRejected=false;
 f.plan(choose(),{name:'public_search',args:{query:'Tides'}},save,
  req=>{const result=lastOutput(req);saveRejected=result.status==='rejected'&&result.saved===false;return share;},
  req=>{shareRejected=lastOutput(req).error?.code==='TOOL_UNAVAILABLE';return quiet;});
 await f.life.tick();f.assertConsumed();assert.ok(saveRejected);assert.ok(shareRejected);
 assert.equal(f.life.db.prepare('SELECT count(*) n FROM discoveries').get().n,1,'A search lead is retained without being promoted to reading');
 assert.equal(f.life.db.prepare('SELECT level FROM life_reading_evidence').get().level,'search-lead');
 assert.equal(f.life.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,0);
 assert.equal(f.cognition.store.counts().messages,0);assert.equal(f.sent.length,0);
});

test('retired interests are not offered and an old revision cannot be selected',async t=>{
 const f=fixture(t),old=f.addState(),current=f.addState({value:'A revised current question'}),retired=f.addState({key:'reflection:retired',active:false});let rejected=0;
 f.plan(req=>{const offered=initial(req).active_interests;assert.ok(offered.some(x=>x.key===current.key&&x.revision===current.revision));assert.ok(!offered.some(x=>x.key===retired.key));return choose(stateRef(old));},
  req=>{if(lastOutput(req).error?.code==='TOOL_FAILURE_UNCLASSIFIED')rejected++;return choose(stateRef(retired));},
  req=>{if(lastOutput(req).error?.code==='TOOL_FAILURE_UNCLASSIFIED')rejected++;return quiet;});
 await f.life.tick();f.assertConsumed();assert.equal(rejected,2);
 assert.equal(f.life.db.prepare('SELECT count(*) n FROM life_intentions').get().n,0);assert.equal(f.sent.length,0);
});

test('an interest retired while the provider is choosing cannot be selected from its stale snapshot',async t=>{
 const f=fixture(t),old=f.addState();let rejected=false;
 f.plan(req=>{assert.ok(initial(req).active_interests.some(x=>x.key===old.key));f.addState({active:false,value:'I put this question aside while the opportunity was being considered'});return choose(stateRef(old));},
  req=>{rejected=lastOutput(req).error?.code==='TOOL_FAILURE_UNCLASSIFIED';return quiet;});
 await f.life.tick();f.assertConsumed();assert.ok(rejected,'The offered snapshot must be revalidated against the current state at selection');
 assert.equal(f.life.db.prepare('SELECT count(*) n FROM life_intentions').get().n,0);
});

test('a concurrent state revision rejects stale reflection even when the model guesses the newer revision',async t=>{
 const f=fixture(t),original=f.addState();let concurrent,reflectionResult;
 f.onRead(()=>{concurrent=f.addState({value:'Newer interpretation from a concurrent synthetic conversation'});});
 f.plan(choose(stateRef(original)),read,{name:'save_discovery',args:{...save.args,reflection:{kind:'interest',key:'tides',value:'An older activity interpretation must not overwrite the newer one',reason:'This activity read the source',operation:'correct',expected_revision:2}}},
  req=>{reflectionResult=lastOutput(req);return quiet;});
 const result=await f.life.tick();f.assertConsumed();assert.equal(result.status,'kept-private-or-quiet');
 assert.equal(reflectionResult.saved,true);assert.equal(reflectionResult.reflection.reason,'reflection-version-conflict');
 const latest=f.cognition.store.getState({kind:'interest',key:original.key,limit:1})[0];
 assert.equal(latest.revision,concurrent.revision);assert.equal(latest.value.interpretation,concurrent.value.interpretation);
 assert.equal(f.life.recent()[0].state,'completed');assert.equal(f.cognition.store.get({id:reflectionResult.evidence_id}).found,true);
 assert.equal(f.sent.length,0);
});

// Seven real queued rows expose starvation which a one-intent fixture cannot.
function sevenSharingCandidates(f) {
 const now=f.life.clock(),items=[];
 for(let i=0;i<7;i++){
  const activity='fixture-rotation-'+i;
  f.life.db.prepare('INSERT INTO activities(id,topic,motivation,state,summary,created,updated) VALUES(?,?,?,?,?,?,?)')
   .run(activity,'Synthetic sourced topic '+i,'A saved curiosity','completed','A retained synthetic source summary '+i,now-7000+i,now-7000+i);
  const evidence=f.cognition.store.recordMessage({scope:'unknown',event:'activity:'+activity,role:'self',
   text:JSON.stringify({summary:'Synthetic public discovery '+i,sources:[{url:'https://example.org/tides/'+i,title:'Tides fixture'}]}),
   source:'public-exploration',metadata:{activity_id:activity},at:now-7000+i});
  const intent=f.life.continuity.queue(activity,evidence.id,'Saved draft '+i,{recipient:'family',target_kind:'group',target_id:GROUP,recipient_reason:'This is one family sharing candidate.'});
  f.life.db.prepare('UPDATE life_share_intents SET created=?,updated=?,next_review=? WHERE id=?').run(now-7000+i,now-7000+i,now-7000+i,intent.id);
  items.push(f.life.continuity.get(intent.id));
 }
 return items;
}
const withoutReview=row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='next_review'));

test('inspection is read-only and rotating seven unchosen candidates exposes the previously hidden sixth and seventh',async t=>{
 const f=fixture(t),items=sevenSharingCandidates(f),before=items.map(row=>({...row})),now=f.life.clock();
 const changes=f.life.db.prepare('SELECT total_changes() n').get().n;
 assert.deepEqual(f.life.continuity.pending().map(row=>row.id),items.slice(0,5).map(row=>row.id));
 assert.deepEqual(f.life.continuity.pending({rotate:false}).map(row=>row.id),items.slice(0,5).map(row=>row.id));
 assert.equal(f.life.db.prepare('SELECT total_changes() n').get().n,changes);
 const first=f.life.continuity.pending({rotate:true});assert.equal(first.length,5);
 for(let i=0;i<items.length;i++){
  const current=f.life.continuity.get(items[i].id);assert.deepEqual(withoutReview(current),withoutReview(before[i]));
  assert.equal(current.next_review,i<5?now+1800000:before[i].next_review);
 }
 assert.deepEqual(f.life.continuity.pending().map(row=>row.id),items.slice(5).map(row=>row.id));
 f.advance();const second=f.life.continuity.pending({rotate:true});
 assert.deepEqual(second.slice(0,2).map(row=>row.id),items.slice(5).map(row=>row.id));
 assert.equal(new Set(second.map(row=>row.id)).size,5);
 assert.equal(f.attempts.length,0);assert.equal(f.sent.length,0);
});

test('rotation excludes not-due and terminal intents, and a selected offered item can still defer or settle uncertain',async t=>{
 const f=fixture(t),items=sevenSharingCandidates(f),now=f.life.clock();
 f.life.db.prepare('UPDATE life_share_intents SET next_review=? WHERE id=?').run(now+3600000,items[6].id);
 f.life.continuity.begin(items[5].id,'fixture-terminal');f.life.continuity.settle(items[5].id,'sent',{message_id:1});
 f.life.continuity.begin(items[4].id,'fixture-uncertain');f.life.continuity.settle(items[4].id,'uncertain');
 const excluded=[4,5,6].map(i=>f.life.continuity.get(items[i].id));
 const offered=f.life.continuity.pending({rotate:true});assert.deepEqual(offered.map(row=>row.id),items.slice(0,4).map(row=>row.id));
 assert.deepEqual([4,5,6].map(i=>f.life.continuity.get(items[i].id)),excluded);
 const deferred=f.life.continuity.reconsider(offered[0].id,{decision:'later',reason:'Not worth saying right now'},offered);
 assert.equal(deferred.state,'queued');assert.equal(deferred.next_review,now+1800000);
 f.life.continuity.begin(offered[1].id,'fixture-attempt');f.life.continuity.settle(offered[1].id,'uncertain');
 f.advance();assert.ok(!f.life.continuity.pending().some(row=>row.id===offered[1].id));
 assert.equal(f.attempts.length,0);assert.equal(f.sent.length,0);
});

test('rotation rolls back every lease when one update fails and respects an outer transaction',async t=>{
 const f=fixture(t),items=sevenSharingCandidates(f),snapshot=()=>items.map(row=>f.life.continuity.get(row.id)),before=snapshot();
 const blocked=items[2].id;assert.match(blocked,/^[a-f0-9-]+$/);
 f.life.db.exec("CREATE TEMP TRIGGER reject_rotation BEFORE UPDATE OF next_review ON life_share_intents WHEN OLD.id='"+blocked+"' BEGIN SELECT RAISE(ABORT,'fixture lease failure'); END");
 assert.throws(()=>f.life.continuity.pending({rotate:true}),/fixture lease failure/);assert.deepEqual(snapshot(),before);
 f.life.db.exec('DROP TRIGGER reject_rotation; BEGIN');
 assert.equal(f.life.continuity.pending({rotate:true}).length,5);
 f.life.db.exec('ROLLBACK');assert.deepEqual(snapshot(),before);
 // Materialization also has to succeed before leases become visible.
 const sources=f.life.continuity.sources.bind(f.life.continuity);
 f.life.continuity.sources=activity=>{if(activity===items[2].activity)throw Error('fixture source read failure');return sources(activity);};
 assert.throws(()=>f.life.continuity.pending({rotate:true}),/fixture source read failure/);assert.deepEqual(snapshot(),before);
});

test('real quiet life opportunities rotate offers even when the scripted model chooses none',async t=>{
 const f=fixture(t),items=sevenSharingCandidates(f),before=items.map(withoutReview);let first,second;
 f.plan(req=>{first=initial(req).pending_discoveries.map(row=>row.id);return quiet;});
 const initialResult=await f.life.tick();f.assertConsumed();assert.equal(initialResult.status,'kept-private-or-quiet');
 assert.deepEqual(first,items.slice(0,5).map(row=>row.id));
 f.advance();f.plan(req=>{second=initial(req).pending_discoveries.map(row=>row.id);return quiet;});
 await f.life.tick();f.assertConsumed();assert.deepEqual(second.slice(0,2),items.slice(5).map(row=>row.id));
 assert.deepEqual(items.map(row=>withoutReview(f.life.continuity.get(row.id))),before);
 assert.ok(items.every(row=>f.life.continuity.get(row.id).state==='queued'));
 assert.equal(f.attempts.length,0);assert.equal(f.sent.length,0);
});

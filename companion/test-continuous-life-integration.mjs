import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {UnifiedCognition} from './cognition-tools.mjs';
import {LifeHeartbeat} from './life-heartbeat.mjs';
import {CuriosityLife} from './curiosity-life.mjs';

const A='91111',B='92222',BOT='95555',GROUP='97777';
function setup(t){
 let now=Date.parse('2036-10-17T20:00:00+08:00');
 const cognition=new UnifiedCognition(mkdtempSync(join(tmpdir(),'whale-continuous-integration-')),{botId:BOT,guardianIds:[A],clock:()=>now});
 t.after(()=>cognition.close());
 const message=(id,event,body,where='group:'+GROUP)=>{
  const text=JSON.stringify({transport:{conversation:where,message_id:event,sender_id:id,time:now/1000,display_name:'same-label'},body,segments:[]});
  return {text,...cognition.store.recordMessage({scope:where,event,role:'user',senderId:id,at:now,source:'live-transport',text})};
 };
 return {cognition,message,get now(){return now;},advance:ms=>now+=ms};
}

test('person-bound understanding crosses chats for the same author without flooding another person or displacing mood/interest',t=>{
 const f=setup(t),c=f.cognition,source=f.message(A,'one','Private synthetic body.');
 const args={person_id:A,key:'banter',operation:'record',expected_revision:0,interpretation:'轻松闲聊时似乎喜欢短一点的接梗。',type:'interaction',reason:'从真实交流形成的理解，仍可纠正。',evidence_ids:[source.id]};
 assert.equal(c.personImpressions.write(args).status,'saved');
 c.store.setState({kind:'mood',key:'inner-life',value:'平静',evidence:[],source:'test'});
 c.store.setState({kind:'interest',key:'tide',value:'潮汐',evidence:[],source:'test'});
 const before=c.store.counts(),changes=c.store.db.prepare('SELECT total_changes() n').get().n;
 const current=id=>({event:'now',text:JSON.stringify({transport:{conversation:'private:'+id,sender_id:id,message_id:'now',time:f.now/1000,display_name:'same-label'},body:'来啦',segments:[]})});
 const own=JSON.parse(c.context({kind:'private',id:A},current(A)).split('\n')[2]);
 assert.equal(own.person_understanding.entries[0].person_id,A);assert.equal(own.person_understanding.entries[0].source_refs[0].author.id,A);
 assert.ok(own.state.some(r=>r.kind==='mood'));assert.ok(own.state.some(r=>r.kind==='interest'));assert.ok(JSON.stringify(own).length<=7000);
 const other=JSON.parse(c.context({kind:'private',id:B},current(B)).split('\n')[2]);
 assert.equal(other.person_understanding,undefined);assert.ok(other.state.every(r=>r.source!=='person-impressions'));
 assert.deepEqual(c.store.counts(),before);assert.equal(c.store.db.prepare('SELECT total_changes() n').get().n,changes);
 const denied=JSON.parse(c.tools({kind:'private',id:A},'now').find(t=>t.name==='self_state').handler({kind:'relationship',key:'person:'+A+':banter',value:'overwrite'}));
 assert.equal(denied.status,'use-person-impression-tool');assert.equal(c.personImpressions.read({person_id:A}).entries[0].revision,1);
});

test('autonomous reflection uses the same person store, records a real outcome and survives a new heartbeat without inventing overnight events',async t=>{
 const f=setup(t),db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE life_settings(key TEXT PRIMARY KEY,value TEXT)');
 const source=f.message(A,'two','我现在更喜欢海獭。'),h=new LifeHeartbeat({db,store:f.cognition.store,clock:()=>f.now});
 h.start('opportunity');let outcome;const controller=new AbortController();
 const tools=h.tools({id:'opportunity',signal:controller.signal,canAct:()=>true,onOutcome:value=>outcome=value});
 const result=JSON.parse(await tools.find(t=>t.name==='reflect_person_impression').handler({person_id:A,key:'sea-animals',operation:'record',expected_revision:0,interpretation:'这次他说更喜欢海獭。',type:'preference',reason:'明确的当次表达。',evidence_ids:[source.id]}));
 assert.equal(result.status,'saved');assert.equal(outcome.status,'person-understanding-saved');
 h.finish('opportunity',{...outcome,activity:'opportunity'});f.advance(15*3600000);
 const next=new LifeHeartbeat({db,store:f.cognition.store,clock:()=>f.now});next.start('today');
 const day=next.context().day_continuity;assert.equal(day.beijing_date,'2036-10-18');
 assert.ok(JSON.stringify(day).includes('opportunity'));assert.equal(f.cognition.personImpressions.read({person_id:A}).entries.length,1);
 controller.abort();await assert.rejects(()=>tools.find(t=>t.name==='read_person_impressions').handler({person_id:A}));
});

function lifeFixture(t,f,respond,{homeTools=[]}={}){
 const conversationDb=new DatabaseSync(':memory:');conversationDb.exec('CREATE TABLE turns(peer TEXT,event TEXT,role TEXT,text TEXT,at INTEGER,state TEXT)');
 const service={botId:BOT,cognition:f.cognition,paused:false,closed:false,engine:{db:conversationDb,queues:new Map(),revisions:new Map(),profile:'Synthetic'},listening:{status:()=>({active:false})}};
 const life=new CuriosityLife({path:join(mkdtempSync(join(tmpdir(),'whale-continuous-life-')),'life.sqlite3'),service,social:{inbound:()=>f.now},world:{getWatched:()=>({groups:[GROUP]})},policy:{bot_id:BOT,group_id:GROUP},client:{canInitiate:()=>true,respond},tools:[],homeTools,clock:()=>f.now});
 t.after(async()=>{await life.close();conversationDb.close();});life.resume();return life;
}
const call=(name,args,n)=>({response:{status:'completed',output:[{type:'function_call',name,arguments:JSON.stringify(args),call_id:'call-'+n}]}});

test('autonomous own-home reading is reachable without pretending to start public research and remains no-send',async t=>{
 const f=setup(t);let round=0,reads=0;
 const life=lifeFixture(t,f,async(req,options)=>{
  assert.equal(typeof options.onEvent,'function');round++;
  if(round===1){assert.ok(req.tools.some(t=>t.name==='open_own_corner'));assert.ok(!req.tools.some(t=>t.name==='own_home_read'));return call('open_own_corner',{reason:'看看自己的角落。'},round);}
  if(round===2){assert.ok(req.tools.some(t=>t.name==='own_home_read'));return call('own_home_read',{},round);}
  return call('keep_quiet',{},round);
 },{homeTools:[{name:'home_read',handler:()=>{reads++;return JSON.stringify({status:'read',home:{name:'Synthetic'}});}}]});
 const result=await life.tick();assert.equal(result.status,'own-corner-read');assert.equal(reads,1);
 assert.equal(life.db.prepare('SELECT count(*) n FROM discoveries').get().n,0);assert.equal(life.db.prepare('SELECT count(*) n FROM activity_shares').get().n,0);
 assert.equal(life.opportunityLog.read(result.activity).generation_count,3);
});

test('a provider timeout after a real reflection keeps saved progress, truthful failure and a next-opportunity continuation',async t=>{
 const f=setup(t),source=f.message(A,'timeout-source','我喜欢海边。');let round=0,next=false;
 const life=lifeFixture(t,f,async(req)=>{
  if(next){const input=JSON.parse(req.input[0].content);assert.ok(input.recent_unfinished_opportunities.recent_unfinished.some(r=>r.status==='partial-progress-saved'));return call('keep_quiet',{},'next');}
  if(++round===1)return call('reflect_person_impression',{person_id:A,key:'shore',operation:'record',expected_revision:0,interpretation:'他说喜欢海边。',reason:'直接合成来话。',evidence_ids:[source.id]},round);
  throw Object.assign(Error('synthetic timeout'),{name:'TimeoutError'});
 });
 const result=await life.tick();assert.equal(result.status,'partial-progress-saved');assert.equal(result.failure.category,'generation-timeout');
 assert.equal(f.cognition.personImpressions.read({person_id:A}).entries.length,1);assert.equal(life.recent()[0].state,'unfinished');
 const log=life.opportunityLog.read(result.activity);assert.ok(log.durable_kinds.includes('person-impression-saved'));assert.equal(log.failure.category,'generation-timeout');
 next=true;f.advance(31*60000);assert.notEqual((await life.tick()).status,'failed');
});

test('tool-round ending preserves a real diary and offers explicit remaining-step guidance',async t=>{
 const f=setup(t),source=f.message(A,'bounded-source','我喜欢海边。');let round=0,sawClosing=false;
 const life=lifeFixture(t,f,async(req)=>{
  round++;if(round>=10)sawClosing ||= req.instructions.includes('这次机会还剩');
  return round===1?call('write_life_journal',{kind:'activity',evidence_ids:[source.id],interpretation:{feeling:'海边的话题让我想起了一个小问题。'}},round):call('read_life_experience',{id:source.id},round);
 });
 const result=await life.tick();assert.equal(result.status,'partial-progress-saved');assert.equal(result.failure.category,'tool-round-limit');assert.ok(sawClosing);
 assert.ok(life.opportunityLog.read(result.activity).durable_kinds.includes('journal-saved'));assert.ok(life.opportunityLog.read(result.activity).events.filter(e=>e.kind==='step').every((e,i)=>e.round===i+1));
});

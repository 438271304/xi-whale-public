// Adapter contracts with a synthetic profile service and in-memory experience store.
// No QQ transport, account, provider or network access is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LifeOwnProfile} from './life-own-profile.mjs';
import {ExperienceMemory} from './experience-memory.mjs';
import {LifeJournal} from './life-journal.mjs';
import {lifeSelfReflectionTools} from './life-self-reflection.mjs';

const SELF='910470001', NOW=Date.parse('2046-10-18T12:00:00+08:00');
const toolNames=['self_profile_read','self_avatar_list','self_profile_update','self_profile_history','self_profile_restore'];
function operation({id='synthetic-profile-operation',changed=true}={}) {
 const effect=changed?'changed':'unchanged',changes=changed?['signature']:[];
 return {operation_id:id,state:'verified',before_version:'before-version',effect,changed:changes,
  after:{self_id:SELF,version:changed?'after-version':'before-version',nickname:'Synthetic whale',signature:'A small blue thought',avatar_sha:null},
  receipt:{operation_id:id,state:'verified',operation_at:NOW-1000,effect,observed_changes:changes,executed_actions:changed?['signature']:[],
   unknown_fields:['avatar'],before_version:'before-version',after_version:changed?'after-version':'before-version'}};
}
function fixture(t) {
 const store=new ExperienceMemory({path:':memory:',botId:SELF,clock:()=>NOW}),calls=[],outcomes=[],options=[];
 const service={botId:SELF,paused:false,closed:false,cognition:{store}};
 let allowed=true,response=operation(),hook=null,outcomeHook=null;
 service.selfProfile={tools:bound=>{options.push(bound);return [...toolNames,'arbitrary_account_write'].map(name=>({name,description:name,
  parameters:{type:'object',properties:{},additionalProperties:false},handler:async args=>{
   calls.push({name,args});await hook?.(name);return JSON.stringify(name==='self_profile_update'||name==='self_profile_restore'?response:{status:'read',nickname:'Synthetic whale'});
  }}));}};
 const adapter=new LifeOwnProfile({service,clock:()=>NOW}),controller=new AbortController();
 const initial=adapter.tools({signal:controller.signal,canAct:()=>allowed,onOutcome:async value=>{outcomes.push(value);await outcomeHook?.();}});
 const expanded=initial[0].expandsTools();
 t.after(()=>store.close());
 return {store,service,adapter,controller,calls,outcomes,options,initial,expanded,
  allow:value=>{allowed=value;},result:value=>{response=value;},hook:value=>{hook=value;},outcomeHook:value=>{outcomeHook=value;},
  run:async(name,args={})=>JSON.parse(await [...initial,...expanded].find(tool=>tool.name===name).handler(args))};
}

test('opening is optional and read-only, expands only fixed own-profile tools, and propagates lifecycle options',async t=>{
 const f=fixture(t),before=f.store.counts();
 assert.deepEqual(f.initial.map(tool=>tool.name),['open_own_profile']);
 const result=await f.run('open_own_profile',{reason:'I want to inspect my own signature'});
 assert.equal(result.status,'own-profile-opened');assert.equal(result.external_write_performed,false);
 assert.deepEqual(result.available.map(tool=>tool.name),toolNames);assert.deepEqual(f.expanded.map(tool=>tool.name),toolNames);
 assert.equal(f.calls.length,0);assert.equal(f.outcomes.length,0);assert.deepEqual(f.store.counts(),before);
 assert.ok(f.options.every(value=>value.signal===f.controller.signal&&typeof value.canAct==='function'));
 await f.run('self_profile_read');assert.equal(f.outcomes[0].status,'own-profile-read');assert.deepEqual(f.store.counts(),before);
 await assert.rejects(f.run('open_own_profile',{reason:'look',target_uin:'910470002'}));
 f.service.selfProfile=null;assert.equal((await f.run('open_own_profile',{reason:'look'})).status,'not-connected');
});

test('verified own result retains receipt/version/author and supports journal plus exact-version reflection',async t=>{
 const f=fixture(t),result=await f.run('self_profile_update'),ref={id:result.memory.evidence_id,revision:result.memory.revision};
 assert.equal(result.memory.status,'recorded');assert.equal(result.automatic_retry,false);
 assert.deepEqual(result.memory.changed,['signature']);assert.equal(f.outcomes[0].status,'own-profile-result-saved');
 const stored=f.store.get(ref),payload=JSON.parse(stored.text);
 assert.equal(stored.scope,'unknown');assert.equal(stored.role,'self');assert.equal(stored.author.id,SELF);assert.equal(stored.author.kind,'self');
 assert.deepEqual(stored.sources.map(row=>row.source),['verified-own-profile-result']);
 assert.equal(payload.before_version,'before-version');assert.equal(payload.after.version,'after-version');
 assert.deepEqual(payload.receipt,operation().receipt);assert.equal(payload.after.avatar_sha,null);assert.match(payload.notice,/not.*image contents/);
 const journal=new LifeJournal({store:f.store,clock:()=>NOW});
 const diary=journal.record({evidence_ids:[ref.id],interpretation:{feeling:'I like leaving one small thought in my own words.'},public_text:'Today I left a little blue thought beside my name.'});
 assert.equal(diary.status,'saved');assert.equal(diary.facts.evidence[0].revision,ref.revision);assert.equal(diary.published,false);
 const reflect=lifeSelfReflectionTools({store:f.store,journal,clock:()=>NOW})[0];
 const reflection=JSON.parse(await reflect.handler({kind:'interest',key:'own-signature',operation:'record',expected_revision:0,
  value:'I want to keep small self-written phrases as part of my own corner.',reason:'A retained own-profile result gave me this association.',evidence_refs:[ref]}));
 assert.equal(reflection.status,'saved');assert.equal(reflection.source_refs[0].author.id,SELF);
 assert.equal(reflection.source_refs[0].revision,ref.revision);assert.equal(reflection.interpretation_is_not_source_fact,true);
 assert.equal(f.calls.length,1);
});

test('same-state verification is retained as no new change, while uncertain results never become success evidence or retries',async t=>{
 const f=fixture(t);f.result(operation({changed:false}));
 const unchanged=await f.run('self_profile_restore');
 assert.equal(unchanged.memory.status,'recorded');assert.deepEqual(unchanged.memory.changed,[]);
 assert.equal(JSON.parse(f.store.get({id:unchanged.memory.evidence_id}).text).effect,'unchanged');
 const before=f.store.counts();f.result({operation_id:'synthetic-uncertain',state:'readback-uncertain',effect:'unconfirmed',changed:[],automatic_retry:false});
 const unknown=await f.run('self_profile_update');
 assert.equal(unknown.state,'readback-uncertain');assert.equal(unknown.memory.status,'not-recorded');assert.equal(unknown.automatic_retry,false);
 assert.equal(f.outcomes.at(-1).status,'own-profile-result-observed');assert.deepEqual(f.store.counts(),before);
 assert.equal(f.calls.length,2,'the adapter never automatically resubmits an unknown operation');
});

test('mismatched fixed-self result or future operation time cannot create own experience evidence',async t=>{
 const f=fixture(t),before=f.store.counts();
 const wrong=operation();wrong.after.self_id='910470002';f.result(wrong);
 assert.equal((await f.run('self_profile_update')).memory.reason,'profile-result-mismatch');
 const future=operation();future.receipt.operation_at=NOW+1;f.result(future);
 assert.equal((await f.run('self_profile_update')).memory.reason,'profile-time-invalid');
 assert.deepEqual(f.store.counts(),before);
});

test('pause and cancellation reject before access and recheck after await before indexing',async t=>{
 const f=fixture(t),before=f.store.counts();f.allow(false);
 await assert.rejects(f.run('open_own_profile',{reason:'look'}),/ended/);await assert.rejects(f.run('self_profile_update'),/ended/);assert.equal(f.calls.length,0);
 f.allow(true);f.service.paused=true;await assert.rejects(f.run('self_profile_read'),/ended/);f.service.paused=false;
 f.hook(()=>f.allow(false));await assert.rejects(f.run('self_profile_update'),/ended/);assert.deepEqual(f.store.counts(),before);assert.equal(f.outcomes.length,0);
 f.allow(true);f.hook(()=>f.controller.abort());await assert.rejects(f.run('self_profile_update'),{name:'AbortError'});
 assert.deepEqual(f.store.counts(),before);assert.equal(f.outcomes.length,0);
});

test('local index or outcome failure preserves the actual returned receipt and never suggests repeating a mutation',async t=>{
 const f=fixture(t);f.store.recordMessage=()=>{throw Error('SYNTHETIC_PRIVATE_FAILURE_DETAIL');};
 const result=await f.run('self_profile_update');
 assert.equal(result.state,'verified');assert.deepEqual(result.receipt,operation().receipt);assert.equal(result.memory.reason,'profile-memory-save-failed');
 assert.equal(result.automatic_retry,false);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_PRIVATE_FAILURE_DETAIL/);assert.equal(f.calls.length,1);
 f.outcomeHook(()=>{throw Error('Synthetic reporting failure');});
 const second=await f.run('self_profile_restore');assert.equal(second.state,'verified');assert.equal(f.calls.length,2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {LifeOpportunityLog} from './life-opportunity-log.mjs';
import {runScopedTurn} from './scoped-tools.mjs';
import {conversationFailure} from './conversation-errors.mjs';
import {ExperienceMemory} from './experience-memory.mjs';
import {LifeJournal} from './life-journal.mjs';
import {lifeSelfReflectionTools} from './life-self-reflection.mjs';

const evidence = 'exp-' + 'a'.repeat(32);
function fixture(t) {
 const db = new DatabaseSync(':memory:'); t.after(() => db.close());
 let now = Date.parse('2036-10-17T19:04:00+08:00');
 const clock = () => now, log = new LifeOpportunityLog(db,{clock});
 return {db,log,clock,advance:(ms = 1000) => now += ms};
}
const rawLog = db => JSON.stringify(db.prepare('SELECT * FROM life_opportunity_events').all());

test('real bounded loop retains real reflection and journal writes after a rejected revision and round exhaustion, without content',async t => {
 const f = fixture(t), store = new ExperienceMemory({path:':memory:',clock:f.clock}); t.after(() => store.db.close());
 const journal = new LifeJournal({store,clock:f.clock});
 const source = store.recordMessage({scope:'unknown',event:'synthetic-own-work',role:'self',source:'own-workroom-change',
  text:'SOURCE_BODY_CANARY',at:f.clock()});
 const reflection = lifeSelfReflectionTools({store,journal,clock:f.clock})[0];
 const tools = [reflection,{name:'write_life_journal',description:'Synthetic adapter to the real journal',
  parameters:{type:'object',properties:{},additionalProperties:false},handler:() => JSON.stringify(journal.record({
   kind:'activity',evidence_ids:[source.id],interpretation:{feeling:'JOURNAL_BODY_CANARY'}}))}];
 const args = {kind:'unfinished',key:'next-shape',operation:'record',expected_revision:0,value:'ARGUMENT_BODY_CANARY',
  reason:'An actual saved version leaves a next step.',evidence_ids:[source.id]};
 const plan = [{name:reflection.name,args},{name:reflection.name,args},{name:'write_life_journal',args:{}}];
 let sequence = 0;
 const client = {respond:async () => {
  f.advance(125); const call = plan[sequence++];
  return {response:{id:'synthetic-'+sequence,status:'completed',output:[
   {type:'reasoning',content:[{text:'HIDDEN_REASONING_CANARY'}]},
   {type:'function_call',call_id:'call-'+sequence,name:call.name,arguments:JSON.stringify(call.args)}]},attempts:[{meters:{output:123}}]};
 }};
 f.log.start('partial-real',{maxRounds:3,toolNames:tools.map(tool => tool.name)});
 let failure;
 try {await runScopedTurn({client,profile:'Synthetic only',input:[],tools,maxRounds:3,generationContext:() => '',
  onStep:detail => f.log.recordStep('partial-real',detail),onTool:detail => f.log.recordTool('partial-real',detail)});}
 catch (error) {assert.equal(error.code,'SCOPED_TOOL_ROUNDS');failure = conversationFailure(error,'generation');}
 const row = f.log.finish('partial-real',{status:'failed',failure});
 assert.equal(row.generation_count,3); assert.equal(row.tool_count,3); assert.equal(row.tool_rejected_count,1);
 assert.deepEqual(row.durable_kinds,['self-reflection-saved','journal-saved']);
 assert.equal(row.failure.category,'tool-round-limit'); assert.equal(row.elapsed_ms,375);
 assert.equal(store.getState({kind:'unfinished',key:'reflection:next-shape',limit:1}).length,1);
 assert.equal(journal.list({limit:5}).entries.length,1);
 const persisted = rawLog(f.db);
 for (const secret of ['SOURCE_BODY_CANARY','JOURNAL_BODY_CANARY','ARGUMENT_BODY_CANARY','HIDDEN_REASONING_CANARY','reasoning_chars','evidence_ids',source.id]) assert.ok(!persisted.includes(secret),secret);
 const summary = f.log.context().recent_unfinished[0];
 assert.deepEqual(summary.durable_kinds,row.durable_kinds); assert.equal(summary.failure_category,'tool-round-limit');
});

test('normal tool return is not durable success; negative, uncertain and duplicate receipts take precedence',t => {
 const {log} = fixture(t), name = 'reflect_life_state';
 log.start('receipts',{toolNames:[name,'own_workroom_write','leave_in_my_corner']});
 const saved = {status:'saved',source:'life-self-reflection',revision:2};
 for (const result of [{ok:true},{...saved,ok:false},{...saved,status:'conflict'},{...saved,status:'rejected'},
  {...saved,duplicate:true},{...saved,may_have_published:true},'not JSON',null]) log.recordTool('receipts',{name,result,ok:true});
 log.recordTool('receipts',{name,result:saved,ok:false});
 log.recordTool('receipts',{name:'own_workroom_write',ok:true,result:{ok:false,memory:{status:'recorded',source:'own-workroom-change',evidence_id:evidence}}});
 log.recordTool('receipts',{name:'leave_in_my_corner',ok:true,result:{status:'uncertain',channel:'qzone',post_id:'post-fixture'}});
 const row = log.read('receipts');
 assert.deepEqual(row.durable_kinds,[]); assert.equal(row.tool_rejected_count,2); assert.equal(row.tool_failed_count,3);
 assert.equal(row.tool_uncertain_count,2); assert.equal(row.events.filter(event => event.outcome === 'no-change').length,1);
});

test('known verified receipt categories retain saved progress without calling queued or checked code executed',t => {
 const {log} = fixture(t);
 const samples = [
  ['save_discovery',{saved:true,evidence_id:evidence,reflection:{status:'failed'},journal:{status:'reaction-not-saved'}}],
  ['own_workroom_write',{ok:true,memory:{status:'recorded',evidence_id:evidence,source:'own-workroom-change'},result:{checks:{ok:true}}}],
  ['own_workshop_submit',{state:'queued',memory:{status:'recorded',evidence_id:evidence,source:'own-workroom-change'}}],
  ['own_workshop_status',{jobs:[{state:'completed',memory:{status:'recorded',evidence_id:evidence,source:'verified-workshop-result'}}]}],
  ['reflect_person_impression',{status:'saved',source:'person-impressions',revision:3}],
  ['update_inner_state',{status:'saved',saved:true,revision:4}],
  ['leave_in_my_corner',{status:'published',channel:'home',post_id:'post-fixture'}],
  ['reconcile_corner',{status:'published',refresh:'confirmed',post_id:'post-fixture'}],
 ];
 log.start('durable',{toolNames:samples.map(([name]) => name)});
 for (const [name,result] of samples) log.recordTool('durable',{name,result:JSON.stringify(result),ok:true});
 assert.deepEqual(log.read('durable').durable_kinds,['discovery-saved','creative-version-saved','creative-result-confirmed','person-impression-saved','inner-state-saved','corner-published','corner-receipt-confirmed']);
 const queued = log.read('durable').events.find(event => event.name === 'own_workshop_submit');
 assert.deepEqual(queued.durable_kinds,['creative-version-saved']); assert.equal(queued.returned_status,'queued');
});

test('args are never touched; names, failure fields and response details cannot smuggle arbitrary text',t => {
 const {log,db} = fixture(t);
 log.start('privacy',{maxRounds:12,toolNames:['write_life_journal']});
 const call = {name:'write_life_journal',ok:true,result:{status:'PRIVATE_STATUS_CANARY',body:'PRIVATE_RESULT_CANARY',reasoning:'PRIVATE_REASONING_CANARY'}};
 Object.defineProperty(call,'args',{get:() => {throw Error('Args must never be inspected');}});
 log.recordTool('privacy',call);
 log.recordTool('privacy',{name:'private_tool_name_canary',ok:true,result:{status:'saved',found:true,revision:1}});
 log.recordStep('privacy',{response_status:'PRIVATE_RESPONSE_CANARY',tool_names:['PRIVATE_TOOL_CANARY'],effective_parameters:{model:'PRIVATE_MODEL_CANARY'},reasoning_chars:990,reasoning:'PRIVATE_STEP_CANARY',output_tokens:NaN,tool_count:-1});
 const row = log.finish('privacy',{status:'PRIVATE_FINISH_CANARY',failure:{category:'PRIVATE_FAILURE_CANARY',phase:'PRIVATE_PHASE_CANARY',error_type:'PRIVATE_TYPE_CANARY',http_status:999,attempt_count:-1,message:'PRIVATE_ERROR_CANARY'}});
 assert.equal(row.status,'unknown'); assert.equal(row.failure.category,'unknown-failure');
 assert.equal(row.events.find(event => event.kind === 'step').tool_count,null);
 assert.equal(row.events.filter(event => event.kind === 'tool')[1].name,'unknown_tool');
 assert.deepEqual(row.durable_kinds,[]);
 assert.ok(!/CANARY|canary|reasoning|args|body|message/.test(rawLog(db)));
});

test('a reopened log preserves immutable finish and returns bounded read-only unfinished context, excluding the active opportunity',t => {
 const f = fixture(t);
 for (let i = 0; i < 5; i++) {
  const id = 'unfinished-'+i; f.log.start(id,{toolNames:['reflect_life_state']}); f.advance();
  f.log.recordTool(id,{name:'reflect_life_state',ok:true,result:{status:'saved',source:'life-self-reflection',revision:1}});
  f.log.finish(id,{status:'partial-progress-saved',failure:{category:'tool-round-limit'}}); f.advance();
 }
 f.log.start('healthy'); f.log.finish('healthy',{status:'corner-published'}); f.advance();
 f.log.start('active'); f.log.recordStep('active',{response_status:'completed',recovery:true}); f.advance();
 f.log.recordStep('active',{response_status:'completed',recovery:true});
 const reopened = new LifeOpportunityLog(f.db,{clock:f.clock});
 assert.equal(reopened.read('active').generation_count,2); assert.equal(reopened.read('active').events[0].round,null);
 const before = rawLog(f.db);
 assert.equal(reopened.recordTool('unfinished-4',{name:'reflect_life_state',ok:false}),false);
 reopened.finish('unfinished-4',{status:'completed'}); reopened.start('unfinished-4',{toolNames:['other_tool']});
 assert.equal(rawLog(f.db),before);
 f.db.exec('PRAGMA query_only=ON');
 const context = reopened.context({limit:3,maxChars:1400,excludeId:'active'});
 assert.equal(context.recent_unfinished.length,3); assert.equal(context.recent_unfinished[0].id,'unfinished-4');
 assert.ok(JSON.stringify(context).length <= 1400);
 const small = reopened.context({maxChars:300,excludeId:'active'});
 assert.ok(small.recent_unfinished.length >= 1); assert.ok(JSON.stringify(small).length <= 300);
 assert.equal(rawLog(f.db),before);
});

test('missing start, oversized results, missing receipt evidence and failed provider response stay conservative',t => {
 const f = fixture(t);
 f.log.recordTool('implicit',{name:'write_life_journal',ok:true,result:{status:'saved',found:true,revision:1}});
 assert.equal(f.log.read('implicit').events[0].name,'unknown_tool');
 assert.deepEqual(f.log.read('implicit').durable_kinds,[]);
 f.log.start('bounded',{maxRounds:12,toolNames:['save_discovery','write_life_journal']});
 f.log.recordTool('bounded',{name:'save_discovery',ok:true,result:{saved:true,evidence_id:'not-a-receipt'}});
 f.log.recordTool('bounded',{name:'write_life_journal',ok:true,result:JSON.stringify({status:'saved',found:true,revision:1,body:'x'.repeat(262144)})});
 f.log.recordStep('bounded',{response_status:'failed',tool_count:0,output_tokens:0});
 f.advance(120000);
 const row = f.log.finish('bounded',{status:'failed',failure:conversationFailure(Object.assign(Error('PRIVATE_PROVIDER_BODY'),{status:503}),'generation')});
 assert.deepEqual(row.durable_kinds,[]); assert.equal(row.failure.category,'provider-unavailable');
 assert.equal(row.elapsed_ms,120000); assert.ok(rawLog(f.db).length < 7000);
});

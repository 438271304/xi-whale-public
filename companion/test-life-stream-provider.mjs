import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {runScopedTurn} from './scoped-tools.mjs';
import {SpendingBook,guardedClient} from './guarded-client.mjs';
import {LifeOpportunityLog} from './life-opportunity-log.mjs';

// Actual installed Responses transport/assembly; every fetch is replaced below.
// Run with the installed tsx loader. All books/stores are in-memory, no credentials.
const app = process.env.XI_VENDOR_APP_ROOT;
if (!app) throw Error('Set XI_VENDOR_APP_ROOT to an independently installed provider runtime');
await import(pathToFileURL(app+'/build/cortico/src/extensions/runtime.ts').href);
const {VendorResponses} = await import(pathToFileURL(app+'/node_modules/cortico-provider-coo/src/responses.ts').href);
const usage = {input_tokens:1000,output_tokens:100,total_tokens:1100,input_tokens_details:{cached_tokens:900},output_tokens_details:{reasoning_tokens:20}};
const secret = 'SYNTHETIC_REASONING_MUST_NOT_BE_PERSISTED';
const deferred = () => {let resolve;const promise = new Promise(done => resolve = done);return {promise,resolve};};

function packets(id) {
 let sequence = 0;
 const output = [], event = value => ({...value,sequence_number:sequence++});
 const response = (status,extra = {}) => ({id,model:'deepseek-flash',status,output:structuredClone(output),...extra});
 return {
  begin:() => event({type:'response.created',response:response('in_progress')}),
  reasoning:() => {
   const index = output.length, item = {type:'reasoning',id:id+'-reason',summary:[],content:[]};
   const part = {type:'reasoning_text',text:''}, complete = {...part,text:secret};
   const events = [event({type:'response.output_item.added',output_index:index,item:structuredClone(item)}),
    event({type:'response.content_part.added',output_index:index,item_id:item.id,content_index:0,part}),
    event({type:'response.reasoning.delta',output_index:index,item_id:item.id,content_index:0,delta:secret}),
    event({type:'response.content_part.done',output_index:index,item_id:item.id,content_index:0,part:complete})];
   item.content = [complete]; output.push(item);
   return [...events,event({type:'response.output_item.done',output_index:index,item:structuredClone(item)})];
  },
  call:(suffix,value = 'synthetic value') => {
   const index = output.length, args = JSON.stringify({value});
   const item = {type:'function_call',id:id+'-item-'+suffix,call_id:id+'-call-'+suffix,name:'commit_fixture',arguments:'',status:'in_progress'};
   output.push(item);
   const first = args.slice(0,9), rest = args.slice(9);
   const prefix = [event({type:'response.output_item.added',output_index:index,item:structuredClone(item)}),
    event({type:'response.function_call_arguments.delta',output_index:index,item_id:item.id,delta:first})];
   item.arguments = args;
   const argumentsDone = () => [event({type:'response.function_call_arguments.delta',output_index:index,item_id:item.id,delta:rest}),
    event({type:'response.function_call_arguments.done',output_index:index,item_id:item.id,arguments:args})];
   return {prefix,argumentsDone,done:() => {item.status = 'completed';return event({type:'response.output_item.done',output_index:index,item:structuredClone(item)});}};
  },
  end:(status = 'completed',extra = {}) => event({type:'response.'+status,response:response(status,{usage,...extra})}),
 };
}

function controlledSSE(signal) {
 let controller,closed = false;
 const encoder = new TextEncoder();
 const abort = () => {if(!closed){closed=true;controller.error(signal.reason ?? new DOMException('Synthetic cancellation','AbortError'));}};
 const detach = () => signal?.removeEventListener('abort',abort);
 const stream = new ReadableStream({start(value){controller=value;signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();},cancel(){closed=true;detach();}});
 return {
  append(events) {assert.equal(closed,false);controller.enqueue(encoder.encode(events.map(event => 'data: '+JSON.stringify(event)+'\n\n').join('')));},
  close() {if(!closed){closed=true;controller.close();detach();}},
  response:new Response(stream,{status:200,headers:{'content-type':'text/event-stream'}}),
 };
}

function fixture(t,fetcher) {
 const savedFetch = globalThis.fetch, book = new SpendingBook(':memory:',null,{maxOutput:8192}), db = new DatabaseSync(':memory:');
 const log = new LifeOpportunityLog(db), requests = [], options = [];
 t.after(() => {globalThis.fetch=savedFetch;book.close();db.close();});
 globalThis.fetch = async (url,init) => {
  assert.equal(String(url),'https://api.deepseek.com/responses','Any accidental network destination is rejected');
  const body = JSON.parse(init.body); requests.push(body);
  assert.equal(body.model,'deepseek-flash');assert.equal(body.stream,true);assert.equal(body.store,false);
  assert.deepEqual(body.reasoning,{effort:'high'});assert.equal(body.max_output_tokens,8192);
  return fetcher({body,signal:init.signal,index:requests.length});
 };
 const vendor = new VendorResponses({baseUrl:'https://api.deepseek.com',apiKey:'synthetic-not-a-secret',reasoningReplay:'plaintext',sendSyntheticReasoning:true},{});
 const guarded = guardedClient(() => ({respond(request,settings){
  assert.equal(typeof settings.onEvent,'function');assert.equal(settings.diagnostic,true);assert.ok(Array.isArray(settings.context));
  options.push(settings);return vendor.respond(request,settings);
 }}),book,{maxOutput:8192});
 const client = {generationSettings:() => ({model:'deepseek-flash',thinking:true,reasoningEffort:'high',maxTokens:8192}),respond:(...args) => guarded.respond(...args)};
 return {book,db,log,client,requests,options};
}
function run(f,{id='synthetic-opportunity',signal,endsTurn=false,onCommit=()=>{}} = {}) {
 f.log.start(id,{maxRounds:3,toolNames:['commit_fixture']});
 return runScopedTurn({client:f.client,profile:'Synthetic local stream acceptance',input:[{role:'user',content:'A local fixture only.'}],
  streamResponses:true,maxRounds:3,signal,generationContext:() => '',onStep:detail => f.log.recordStep(id,detail),onTool:detail => f.log.recordTool(id,detail),
  tools:[{name:'commit_fixture',description:'Local synthetic write counter',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},
   handler:args => {onCommit(args);return 'SYNTHETIC_TOOL_RESULT_MUST_NOT_BE_PERSISTED';},endsTurn}]});
}
function storedMetadata(f) {
 return JSON.stringify({events:f.db.prepare('SELECT * FROM life_opportunity_events').all(),diagnostics:f.book.db.prepare('SELECT * FROM provider_diagnostics').all()});
}

test('installed Responses buffers fragments and item.done, executes only after complete response, and settles real usage',async t => {
 const ready = deferred();let wire,writes = 0;
 const f = fixture(t,({signal,index}) => {assert.equal(index,1);wire=controlledSSE(signal);ready.resolve();return wire.response;});
 const pending = run(f,{endsTurn:true,onCommit:args => {writes++;assert.equal(args.value,'ARGUMENT_BODY_CANARY');}});
 await ready.promise;
 const p = packets('complete'), begin = p.begin(), reasoning = p.reasoning(), call = p.call('one','ARGUMENT_BODY_CANARY');
 wire.append([begin,...reasoning,...call.prefix]);await nextTurn();
 assert.equal(writes,0);assert.equal(f.log.read('synthetic-opportunity').generation_count,0);
 wire.append([...call.argumentsDone(),call.done()]);await nextTurn();
 assert.equal(writes,0,'A closed streamed tool item is still not permission to execute');
 wire.append([p.end()]);wire.close();await pending;
 assert.equal(writes,1);assert.equal(f.requests.length,1);assert.equal(f.log.read('synthetic-opportunity').tool_count,1);
 const callRow = f.book.db.prepare('SELECT * FROM calls').get(), receipt = f.book.db.prepare('SELECT * FROM usage_receipts').get();
 assert.equal(callRow.state,'settled');assert.equal(callRow.actual,1036);assert.equal(receipt.input,1000);
 assert.equal(receipt.cached_input,900);assert.equal(receipt.output,100);assert.equal(receipt.ceiling,1036);
 for(const canary of [secret,'ARGUMENT_BODY_CANARY','SYNTHETIC_TOOL_RESULT_MUST_NOT_BE_PERSISTED','reasoning_chars']) assert.ok(!storedMetadata(f).includes(canary));
});

test('incomplete terminal, unfinished call in a completed batch, and missing terminal never execute any tools',async t => {
 for(const kind of ['content-filter','unfinished-call','missing-terminal']) await t.test(kind,async t => {
  let writes = 0;
  const f = fixture(t,({signal,index}) => {
   assert.equal(index,1,'No transport or turn replay');
   const wire = controlledSSE(signal), p = packets(kind), frames = [p.begin()], first = p.call('first');
   frames.push(...first.prefix,...first.argumentsDone(),first.done());
   if(kind==='unfinished-call') {const second=p.call('second');frames.push(...second.prefix,...second.argumentsDone(),p.end());}
   else if(kind==='content-filter') frames.push(p.end('incomplete',{incomplete_details:{reason:'content_filter'}}));
   wire.append(frames);wire.close();return wire.response;
  });
  await assert.rejects(run(f,{onCommit:() => writes++}),error => {
   if(kind==='missing-terminal') assert.equal(error.name,'GenerationError');
   else assert.equal(error.code,'SCOPED_RESPONSE_INCOMPLETE');
   return true;
  });
  assert.equal(writes,0,'Whole batch is rejected before its first complete call can run');assert.equal(f.requests.length,1);
  const row = f.book.db.prepare('SELECT state FROM calls').get();
  assert.equal(row.state,kind==='missing-terminal'?'pending':'settled','Known received usage remains billed even if its content cannot be executed');
 });
});

test('abort after one saved step does not replay it or execute current partial output; unknown usage stays reserved',async t => {
 const ready = deferred(), controller = new AbortController();let wire,writes = 0;
 const f = fixture(t,({signal,index,body}) => {
  assert.ok(index<=2,'No retry after an aborted stream');
  const current = controlledSSE(signal), p = packets('turn-'+index), frames = [p.begin(),...p.reasoning()], call = p.call('write');
  frames.push(...call.prefix,...call.argumentsDone(),call.done());current.append(frames);
  if(index===1) {current.append([p.end()]);current.close();}
  else {
   assert.ok(body.input.some(item => item.type==='function_call_output'&&item.call_id==='turn-1-call-write'));
   wire=current;ready.resolve();
  }
  return current.response;
 });
 const pending = run(f,{signal:controller.signal,onCommit:() => writes++});
 await ready.promise;await nextTurn();assert.equal(writes,1);
 controller.abort(new DOMException('Synthetic lifecycle cancellation','AbortError'));
 await assert.rejects(pending,error => {assert.equal(error.name,'GenerationError');assert.equal(error.attempts.length,1);return true;});
 assert.equal(writes,1);assert.equal(f.requests.length,2);
 const states = f.book.db.prepare('SELECT state,actual,reserved FROM calls ORDER BY rowid').all();
 assert.equal(states[0].state,'settled');assert.equal(states[0].actual,1036);
 assert.equal(states[1].state,'pending');assert.equal(states[1].actual,null);assert.ok(states[1].reserved>0);
 assert.equal(f.book.db.prepare('SELECT COUNT(*) n FROM usage_receipts').get().n,1);
 assert.equal(f.book.db.prepare('SELECT COUNT(*) n FROM provider_failures').get().n,1);
 assert.equal(f.log.read('synthetic-opportunity').tool_count,1);
 assert.ok(!storedMetadata(f).includes(secret));assert.ok(!storedMetadata(f).includes('SYNTHETIC_TOOL_RESULT_MUST_NOT_BE_PERSISTED'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {generationOptions} from './generation-options.mjs';
import {SpendingBook,guardedClient,boundedReservation} from './guarded-client.mjs';

// Actual option/accounting implementations, synthetic provider usage receipts,
// and in-memory books only. No provider SDK, credentials or network is used.
const spec={model:'deepseek-flash',thinking:true,reasoningEffort:'high'};
const request=maxTokens=>({...generationOptions({...spec,...(maxTokens===undefined?{}:{maxTokens})}),input:[{role:'user',content:'A synthetic creative-output budget probe.'}]});
const complete=(id,output)=>({response:{id,status:'completed',output:[]},attempts:[{id,meters:{input:2000,cachedInput:1500,output}}]});

test('creative output changes only the explicit output ceiling; ordinary model/reasoning/default remain intact',()=>{
 const ordinary=generationOptions(spec),creative=generationOptions({...spec,maxTokens:32768});
 assert.deepEqual(ordinary,{model:'deepseek-flash',reasoning:{effort:'high'},max_output_tokens:8192});
 assert.deepEqual(creative,{...ordinary,max_output_tokens:32768});
 assert.equal(generationOptions().max_output_tokens,8192);
 assert.deepEqual(generationOptions({...spec,thinking:false,maxTokens:32768}).reasoning,{effort:'none'});
 assert.throws(()=>generationOptions({...spec,model:'an-unvalidated-model',maxTokens:32768}),/model/);
 for(const maxTokens of [32769,0,-1,1.5,Infinity])assert.throws(()=>generationOptions({...spec,maxTokens}),/parameters/);
});

test('reservation and accounting accept 32768 as a boundary and reject unsupported output bounds',t=>{
 const book=new SpendingBook(':memory:',null,{maxOutput:32768});t.after(()=>book.close());
 assert.equal(book.maxOutput,32768);
 const ordinary=boundedReservation(request(),{},8192),creative=boundedReservation(request(),{},32768);
 assert.equal(creative.maxOutput,32768);assert.equal(ordinary.maxOutput,8192);
 assert.equal(creative.inputUpper,ordinary.inputUpper);
 assert.equal(creative.amount-ordinary.amount,196608,'Only the extra 24576 output tokens change this otherwise identical reservation');
 for(const maxOutput of [32769,0,-1,1.5,Infinity]){
  assert.throws(()=>new SpendingBook(':memory:',null,{maxOutput}),/output bound/);
  assert.throws(()=>boundedReservation(request(),{},maxOutput),/output bound/);
 }
});

test('one creative-capable guard reserves each requested ceiling and settles measured cached usage rather than the reservation',async t=>{
 const book=new SpendingBook(':memory:',null,{maxOutput:32768});t.after(()=>book.close());
 const observed=[];
 const client=guardedClient(()=>({respond:async(req,options)=>{
  const pending=book.db.prepare("SELECT c.id,c.reserved,c.actual,c.state,b.max_output FROM calls c JOIN reservation_bounds b ON b.call_id=c.id WHERE c.state='pending'").all();
  assert.equal(pending.length,1);assert.equal(pending[0].actual,null);
  observed.push({request:structuredClone(req),native:structuredClone(options.nativeSpec),reservation:pending[0]});
  assert.equal(req.model,spec.model);assert.deepEqual(req.reasoning,{effort:'high'});
  assert.equal(options.nativeSpec.maxTokens,req.max_output_tokens);assert.equal(options.diagnostic,true);
  return complete('synthetic-'+observed.length,req.max_output_tokens===32768?32768:512);
 }}),book,{maxOutput:32768});
 await client.respond(request(),{nativeSpec:{model:spec.model,reasoningEffort:'high',maxTokens:32768}});
 await client.respond(request(32768),{nativeSpec:{model:spec.model,reasoningEffort:'high',maxTokens:32768}});
 assert.deepEqual(observed.map(row=>row.request.max_output_tokens),[8192,32768]);
 assert.deepEqual(observed.map(row=>row.reservation.max_output),[8192,32768]);
 assert.deepEqual(observed.map(row=>row.native.reasoningEffort),['high','high']);
 assert.ok(observed[1].reservation.reserved>observed[0].reservation.reserved);
 const rows=book.db.prepare('SELECT c.id,c.reserved,c.actual,c.state,u.input,u.cached_input,u.output,u.ceiling FROM calls c JOIN usage_receipts u ON u.call_id=c.id').all();
 assert.equal(rows.length,2);
 const ordinary=rows.find(row=>row.id===observed[0].reservation.id),creative=rows.find(row=>row.id===observed[1].reservation.id);
 assert.equal(ordinary.state,'settled');assert.equal(ordinary.output,512);assert.equal(ordinary.actual,5156);
 assert.equal(creative.state,'settled');assert.equal(creative.output,32768);assert.equal(creative.actual,263204);
 for(const row of rows){assert.equal(row.input,2000);assert.equal(row.cached_input,1500);assert.equal(row.actual,row.ceiling);assert.ok(row.actual<row.reserved);}
});

test('usage above 32768 is rejected and its reservation stays pending without an invented settled receipt',async t=>{
 const book=new SpendingBook(':memory:',null,{maxOutput:32768});t.after(()=>book.close());let calls=0;
 const client=guardedClient(()=>({respond:async()=>{calls++;return complete('synthetic-over-bound',32769);}}),book,{maxOutput:32768});
 await assert.rejects(()=>client.respond(request(32768)),/usage exceeds validated bounds/);
 assert.equal(calls,1);assert.equal(book.db.prepare('SELECT count(*) n FROM usage_receipts').get().n,0);
 const row=book.db.prepare('SELECT state,actual,reserved FROM calls').get();assert.equal(row.state,'pending');assert.equal(row.actual,null);assert.ok(row.reserved>0);
 assert.equal(book.db.prepare('SELECT count(*) n FROM provider_failures').get().n,1);
});

test('larger creative reservation still meets the existing spending gate before a fake provider is invoked',async t=>{
 const book=new SpendingBook(':memory:',120000,{maxOutput:32768});t.after(()=>book.close());let calls=0;
 const client=guardedClient(()=>({respond:async()=>{calls++;return complete('synthetic-within-budget',512);}}),book,{maxOutput:32768});
 await client.respond(request());assert.equal(calls,1);
 await assert.rejects(()=>client.respond(request(32768)),/spending allowance exhausted/);
 assert.equal(calls,1,'A refused creative reservation never reaches even the fake provider');
 assert.equal(book.db.prepare('SELECT count(*) n FROM calls').get().n,1);
});

test('a creative-capable guard does not enlarge ordinary callers that omit the output limit',async t=>{
 const book=new SpendingBook(':memory:',null,{maxOutput:32768});t.after(()=>book.close());
 const client=guardedClient(()=>({respond:async(req,options)=>{assert.equal(req.max_output_tokens,8192);assert.equal(options.nativeSpec.maxTokens,8192);return complete('synthetic-default',100);}}),book,{maxOutput:32768});
 await client.respond({model:'deepseek-flash',input:[]});
 assert.equal(book.db.prepare('SELECT max_output FROM reservation_bounds').get().max_output,8192);
});

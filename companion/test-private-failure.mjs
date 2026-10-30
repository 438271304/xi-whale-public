import assert from 'node:assert/strict';
import {SpendingBook,guardedClient,boundedReservation} from './guarded-client.mjs';
import {PrivateConversation} from './private-conversation.mjs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const book=new SpendingBook(':memory:');
for(let i=0;i<5;i++)book.reserve(2_200_000);
const previous=book.reserve(2_200_000);book.settleDeepSeek(previous,[{meters:{input:900000,output:3053}}]);
assert.throws(()=>book.reserve(2_200_000),/allowance/);
const request={model:'deepseek-flash',instructions:'Synthetic',input:[{type:'message',role:'user',content:'bounded request'}]};
const bound=boundedReservation(request,{},4096);assert.ok(bound.amount<2_200_000);assert.ok(bound.amount>=Math.ceil((bound.inputUpper*200+4096*800)/100));
let calls=0;await guardedClient(()=>({respond:async()=>{calls++;return {attempts:[{meters:{input:1000,output:20}}]};}}),book).respond(request);
assert.equal(calls,1);assert.equal(book.cap,15_000_000);assert.equal(book.db.prepare("SELECT count(*) n FROM calls WHERE state='pending'").get().n,5);
assert.equal(book.db.prepare('SELECT count(*) n FROM reservation_bounds').get().n,1);book.close();
assert.throws(()=>boundedReservation({...request,input:'x'.repeat(300000)},{},4096),/bound/);

let sends=0;const canary='PRIVATE_ERROR_BODY_API_KEY_CANARY';
const error=Object.assign(Error(canary),{name:'GenerationError',status:400,attempts:[{status:400}]});
let c=new PrivateConversation({path:':memory:',profile:'synthetic',isAllowed:()=>true,client:{respond:async()=>{throw error;}},send:async()=>sends++});
let result=await c.receive('private:12345','1','synthetic private request');assert.equal(result.failure.category,'provider-request-rejected');assert.equal(result.failure.http_status,400);assert.equal(sends,0);
const diagnostics=c.db.prepare('SELECT * FROM turn_failures').all();assert.ok(!JSON.stringify(diagnostics).includes(canary));assert.equal(diagnostics[0].phase,'generation');
assert.equal((await c.receive('private:12345','1','duplicate')).status,'duplicate');await c.close();
c=new PrivateConversation({path:':memory:',profile:'synthetic',isAllowed:()=>true,client:{respond:async()=>{throw Error('Daily spending allowance exhausted');}},send:async()=>sends++});
result=await c.receive('private:12345','2','synthetic');assert.equal(result.failure.category,'budget-blocked');await c.close();

// Installed provider, synthetic history shapes only; no historical chat replay.
const app=process.argv[2];
await import(pathToFileURL(join(app,'build/cortico/src/extensions/runtime.ts')).href);
const {VendorChat}=await import(pathToFileURL(join(app,'node_modules/cortico-provider-coo/src/chat.ts')).href);
const original=globalThis.fetch,providerBook=new SpendingBook(':memory:');let reject=false,networkCalls=0;
try{
 globalThis.fetch=async(_url,options)=>{
  networkCalls++;const body=JSON.parse(options.body);
  assert.deepEqual(body.messages.map(m=>m.role),['system','user','assistant','user','user']);
  assert.equal(body.messages[2].content,'synthetic acknowledged reply');
  if(reject)return new Response(JSON.stringify({error:{message:canary}}),{status:400,headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify({id:'fixture',model:'deepseek-flash',choices:[{index:0,message:{role:'assistant',content:'fixture reply'},finish_reason:'stop'}],usage:{prompt_tokens:1000,completion_tokens:20,total_tokens:1020}}),{status:200,headers:{'content-type':'application/json'}});
 };
 const client=guardedClient(()=>new VendorChat({baseUrl:'https://api.deepseek.com',apiKey:'synthetic-only'}),providerBook);
 const input=[['user','synthetic first request'],['assistant','synthetic acknowledged reply'],['user','synthetic followup'],['user','synthetic newer followup']].map(([role,content])=>({type:'message',role,content}));
 const response=await client.respond({model:'deepseek-flash',instructions:'synthetic',input});assert.ok(response.response.output.length);
 reject=true;await assert.rejects(client.respond({model:'deepseek-flash',instructions:'synthetic',input}));
 const failure=providerBook.db.prepare('SELECT category,http_status,attempt_count FROM provider_failures').get();assert.equal(failure.http_status,400);assert.equal(failure.attempt_count,1);assert.ok(!JSON.stringify(failure).includes(canary));assert.equal(networkCalls,2);
}finally{globalThis.fetch=original;providerBook.close();}
console.log('PASS preserved unknown reservations/cap, request-size bound restores headroom, preflight refusal, private failure phase/status without raw error, no retry, installed provider accepts synthetic history; mocked fetch only');

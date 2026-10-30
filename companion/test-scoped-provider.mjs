import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runScopedTurn} from './scoped-tools.mjs';
import {SpendingBook,guardedClient} from './guarded-client.mjs';
const app=process.argv[2];
await import(pathToFileURL(join(app,'build/cortico/src/extensions/runtime.ts')).href);
const {VendorChat}=await import(pathToFileURL(join(app,'node_modules/cortico-provider-coo/src/chat.ts')).href);
const savedFetch=globalThis.fetch,book=new SpendingBook(':memory:');let calls=0;
try{
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),'https://api.deepseek.com/chat/completions');
  const body=JSON.parse(options.body);calls++;assert.equal(body.max_tokens,4096);
  assert.equal(body.tools[0].function.name,'read_fixture');
  if(calls===2){
   assert.equal(body.messages.find(m=>m.role==='tool').content,'bound fixture');
   assert.equal(body.messages.find(m=>m.role==='tool').tool_call_id,'fixture-call');
  }
  const message=calls===1?{role:'assistant',content:null,tool_calls:[{id:'fixture-call',type:'function',function:{name:'read_fixture',arguments:'{}'}}]}:{role:'assistant',content:'fixture reply'};
  return new Response(JSON.stringify({id:'fixture-response',object:'chat.completion',created:1,model:'deepseek-flash',choices:[{index:0,message,finish_reason:calls===1?'tool_calls':'stop'}],usage:{prompt_tokens:30,completion_tokens:10,total_tokens:40}}),{status:200,headers:{'content-type':'application/json'}});
 };
 const client=guardedClient(()=>new VendorChat({baseUrl:'https://api.deepseek.com',apiKey:'synthetic-only'}),book);
 const reply=await runScopedTurn({client,profile:'Synthetic public fixture',input:[{role:'user',content:'Read fixture'}],tools:[{name:'read_fixture',description:'Fixture',parameters:{type:'object',properties:{},additionalProperties:false},handler:()=> 'bound fixture'}]});
 assert.equal(reply,'fixture reply');assert.equal(calls,2);
 assert.equal(book.db.prepare("SELECT COUNT(*) n FROM calls WHERE state='settled'").get().n,2);
 console.log('PASS installed VendorChat tool serialization/result roundtrip and guarded accounting; mocked fetch, zero external calls');
}finally{globalThis.fetch=savedFetch;book.close();}

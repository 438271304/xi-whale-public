import assert from 'node:assert/strict';import {createDeepSeekPublicSearch} from './deepseek-public-search.mjs';import {SpendingBook,guardedClient} from './guarded-client.mjs';
let calls=0;const search=createDeepSeekPublicSearch({credentials:()=>({baseUrl:'https://api.deepseek.com',apiKey:'SYNTHETIC_KEY'}),fetcher:async(url,opt)=>{calls++;assert.equal(url,'https://api.deepseek.com/v1/tools/search');assert.equal(opt.redirect,'error');assert.deepEqual(JSON.parse(opt.body),{query:'鹈鹕如何捕鱼',count:5,need_content:false});return new Response(JSON.stringify({results:[{url:'https://www.hko.gov.hk/',title:'Synthetic',snippet:'public snippet'}]}),{headers:{'content-type':'application/json'}});}});
const book=new SpendingBook(':memory:',null),client=guardedClient(()=>{throw Error('No model call');},book,{searchPublic:search});
assert.equal((await client.searchPublic({query:'鹈鹕如何捕鱼',count:5,need_content:false})).results.length,1);assert.equal(calls,1);
assert.equal(book.db.prepare('SELECT state FROM calls').get().state,'pending');assert.equal(book.db.prepare('SELECT status FROM external_tool_calls').get().status,'completed-cost-unknown');
await assert.rejects(()=>search({query:'私聊原文 900000001',count:5,need_content:false}));assert.equal(calls,1);
await assert.rejects(()=>search({query:'鹈鹕如何捕鱼',count:5,need_content:false,ori_question:'private'}));book.close();
console.log('PASS fixed authorized endpoint/payload, no chat context, obvious private-query rejection, separate unknown-cost ledger, no invented token charges');

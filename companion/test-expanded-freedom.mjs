import assert from 'node:assert/strict';
import {runScopedTurn} from './scoped-tools.mjs';
import {PrivateConversation} from './private-conversation.mjs';
let n=0;
const long='a'.repeat(9000);
assert.equal(await runScopedTurn({profile:'synthetic',input:[],tools:[{name:'read',description:'read',parameters:{type:'object',properties:{}},handler:()=> 'ok'}],client:{respond:async req=>{assert.equal(req.max_output_tokens,8192);n++;return {response:{status:'completed',output:n<=12?[{type:'function_call',name:'read',call_id:String(n),arguments:'{}'}]:[{type:'message',role:'assistant',content:[{type:'output_text',text:long}]}]}};}}}),long);
assert.equal(n,13);
const original=AbortSignal.timeout;
AbortSignal.timeout=()=>{throw Error('Conversation must not create a wall-clock deadline');};
const c=new PrivateConversation({path:':memory:',profile:'synthetic',isAllowed:async()=>true,client:{respond:async(_,opt)=>{assert.ok(opt.signal);return {response:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'ok'}]}]}};}},send:async()=>{}});
try{assert.equal((await c.receive('private:12345','1','x'.repeat(16000))).status,'sent');}finally{await c.close();AbortSignal.timeout=original;}
console.log('PASS 12 tool rounds, 9000-character reply, 16000-character input, full 8192 allowance, no whole-turn deadline; explicit abort signal retained');

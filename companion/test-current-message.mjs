import assert from 'node:assert/strict';
import {PrivateConversation} from './private-conversation.mjs';
let calls=0,toolSetups=0,sends=0;
const c=new PrivateConversation({path:':memory:',profile:'Synthetic profile',isAllowed:async()=>true,
 toolsFor:()=>{toolSetups++;return [{name:'workroom_create',description:'synthetic',parameters:{type:'object',properties:{}},handler:()=>{throw Error('Must not run');}}];},
 client:{respond:async(req)=>{calls++;assert.equal(req.reasoning.effort,'low');if(calls===1){assert.equal(req.tools.length,0);assert.match(req.instructions,/本条只有/);assert.match(req.input[0].content,/历史消息/);assert.match(req.input.at(-1).content,/address_only/);}else assert.equal(req.tools.length,1);return {response:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'在呢'}]}]}};}},send:async()=>{sends++;}});
c.db.prepare("INSERT INTO turns VALUES(?,?,'user',?,?,'failed')").run('group:12345','old','Build a huge project now',1);
assert.equal((await c.receive('group:12345','new',JSON.stringify({transport:{address_only:true},body:'@bot'}))).status,'sent');
assert.equal(toolSetups,0);assert.equal(sends,1);
assert.equal((await c.receive('group:12345','task','Please make a project')).status,'sent');
assert.equal(toolSetups,1);assert.equal(sends,2);await c.close();
console.log('PASS address-only has no task tools; failed history marked; explicit current task keeps tools; low effort from first step');

import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ConversationService} from './conversation-service.mjs';
const root=mkdtempSync(join(tmpdir(),'whale-service-')),requests=[],sent=[];let aImage,allow=true;
const textReply=text=>({response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]}});
const call=(name,args,id)=>({response:{output:[{type:'function_call',call_id:id,name,arguments:JSON.stringify(args)}]}});
const client={respond:async req=>{
 requests.push(structuredClone(req));const text=JSON.stringify(req.input);
 if(text.includes('A_SECRET')){
  if(!text.includes('function_call_output'))return call('list_images',{},'list');
  if(!text.includes('attach_image')){
   aImage=JSON.parse(req.input.find(x=>x.type==='function_call_output').output)[0].id;
   return call('attach_image',{id:aImage},'attach');
  }
  return textReply('第一条\n第二条');
 }
 if(text.includes('B_ONLY')&&!text.includes('function_call_output'))return call('attach_image',{id:aImage},'cross');
 return textReply('收到');
}};
const msg=(kind,id,event,text)=>({message_type:kind,user_id:id,group_id:id,message_id:event,time:1792880000,message:[{type:'text',data:{text}}]});
const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(16)]);
let service=new ConversationService({root,client,publicProfile:'Public identity only',isAllowed:()=>allow,send:async v=>sent.push(v),wait:async()=>{}});
assert.equal((await service.receiveAdmitted(msg('private',12345,1,'A_SECRET'),[image])).status,'sent');
assert.equal(sent.length,2);assert.deepEqual(sent[1].imageBytes,image);assert.equal(sent[0].imageBytes,undefined);
const begin=requests.length;
assert.equal((await service.receiveAdmitted(msg('private',23456,2,'B_ONLY'))).status,'sent');
assert.ok(!JSON.stringify(requests.slice(begin).map(r=>r.input)).includes('A_SECRET'));
assert.ok(!requests.at(-1).instructions.includes('A_SECRET'));assert.ok(service.cognition.store.search({query:'A_SECRET'}).records.length>0); // Unified cognition, separate live prompt/destination.
assert.ok(JSON.stringify(requests.at(-1)).includes('rejected or failed'));assert.equal(sent.at(-1).imageBytes,undefined);
assert.equal((await service.receiveAdmitted(msg('group',12345,3,'GROUP_ONLY'))).status,'sent');
assert.ok(!JSON.stringify(requests.at(-1).input).includes('A_SECRET'));assert.equal(sent.at(-1).target.kind,'group');
assert.equal((await service.receiveAdmitted(msg('private',12345,1,'A_SECRET'),[image])).status,'duplicate');
assert.equal(service.media.list({kind:'private',id:'12345'}).length,1);
await service.pause();assert.equal((await service.receiveAdmitted(msg('private',12345,4,'paused'))).status,'paused-or-closed');service.resume();
allow=false;const prior=sent.length;assert.equal((await service.receiveAdmitted(msg('private',12345,5,'blocked'))).status,'not-allowed');assert.equal(sent.length,prior);allow=true;
await service.close();
service=new ConversationService({root,client:{respond:async()=>textReply('restart')},publicProfile:'Public',isAllowed:()=>true,send:async v=>sent.push(v)});
assert.equal((await service.receiveAdmitted(msg('private',12345,1,'A_SECRET'))).status,'duplicate');
assert.equal(service.media.list({kind:'private',id:'12345'}).length,1);await service.close();
// Mid-batch pause must stop remaining bubbles and mark delivery uncertain, not retry.
let release,entered;const ready=new Promise(r=>entered=r);let count=0;
service=new ConversationService({root:mkdtempSync(join(tmpdir(),'whale-stop-')),client:{respond:async()=>textReply('一\n二')},publicProfile:'Public',isAllowed:()=>true,send:async()=>count++,wait:()=>{entered();return new Promise(r=>release=r);}});
const active=service.receiveAdmitted(msg('private',12345,9,'hello'));await ready;const paused=service.pause();release();await paused;
assert.equal((await active).status,'failed-no-retry');assert.equal(count,1);service.resume();assert.equal((await service.receiveAdmitted(msg('private',12345,9,'hello'))).status,'duplicate');await service.close();
console.log('PASS conversation module: unified memory/current prompt separation, no cross-chat image forwarding, correct destination, text/image bubbles, duplicate/restart, pause mid-send, permission recheck; no QQ network');

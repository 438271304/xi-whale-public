import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ConversationService} from './conversation-service.mjs';
import {SocialRhythm} from './social-rhythm.mjs';
import {conversationScope} from './conversation-scope.mjs';
const root=mkdtempSync(join(tmpdir(),'whale-social-')),sent=[],requests=[],scope=conversationScope('group','12345');let now=Date.parse('2026-10-25T10:00:00+08:00'),allowed=true,budget=true;
let toolSequence=0;const call=(name,args)=>({response:{output:[{type:'function_call',call_id:'synthetic-'+(++toolSequence),name,arguments:JSON.stringify(args)}]}});
const service=new ConversationService({root:join(root,'service'),botId:'34567',publicProfile:'synthetic',isAllowed:()=>allowed,send:async a=>sent.push(a),client:{respond:async req=>{requests.push(req);const current=req.input.findLast(item=>item.role==='user');if(JSON.parse(current.content).said.includes('sticker'))return req.tools.some(tool=>tool.name==='send_image_only')?call('send_image_only',{id:image}):call('discover_tools',{category:'images'});return {response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'合成回答'}]}]}};}}});
const policy={group_id:'12345',bot_id:'34567',peer_bot_ids:['67890']};let topics=[{field:'interests',text:'合成兴趣'}];
let social=new SocialRhythm({path:join(root,'social.sqlite3'),service,policy,world:{getWatched:()=>({groups:[12345]}),sendToTarget:async(target,value)=>sent.push({target,...value})},clock:()=>now,budgetAvailable:()=>budget,topics:()=>topics,config:{dailyMax:1,checkMs:10000000}});service.social=social;social.resume();
assert.equal((await social.tick()).status,'sent');assert.equal(sent.length,1);assert.equal(sent[0].target.id,'12345');assert.equal(requests.length,0);assert.equal((await social.tick()).status,'ineligible');
now+=86400000;topics=[{field:'interests',text:'另一个合成兴趣'}];assert.equal((await social.tick()).status,'ineligible'); // unanswered, no chase
social.noteInbound({message_type:'group',group_id:12345,user_id:67890});assert.equal((await social.tick()).status,'ineligible'); // fish cannot reopen
social.noteInbound({message_type:'group',group_id:12345,user_id:45678});now+=600001;budget=false;assert.equal((await social.tick()).status,'ineligible');budget=true;
social.observe(scope,'evidence-test',['1','2']);assert.equal(social.observations(scope).length,1);assert.equal(social.observations(conversationScope('private','12345')).length,0);assert.equal(social.forget(scope,'evidence-test'),1);
assert.equal((await social.tick()).status,'sent');assert.equal(sent.length,2);await social.close();
social=new SocialRhythm({path:join(root,'social.sqlite3'),service,policy,world:{getWatched:()=>({groups:[12345]}),sendToTarget:async(target,value)=>sent.push({target,...value})},clock:()=>now,budgetAvailable:()=>true,topics:()=>topics});social.resume();assert.equal((await social.tick()).status,'ineligible');
now++;social.noteInbound({message_type:'group',group_id:12345,user_id:45678});now+=600001;topics=[{field:'wish',text:'同日第三个主题'}];assert.equal((await social.tick()).status,'sent');assert.equal(sent.length,3);assert.equal(social.db.prepare('SELECT count(*) n FROM social_attempts WHERE day=?').get('2026-10-26').n,2); // no daily cap or 12-hour gate
now=Date.parse('2026-10-27T02:00:00+08:00');assert.equal((await social.tick()).status,'ineligible');await social.pause();now=Date.parse('2026-10-27T10:00:00+08:00');assert.equal((await social.tick()).status,'ineligible');await social.close();
service.social=null;
const m=(id,user,body,direct=false)=>({post_type:'message',message_type:'group',group_id:12345,user_id:user,message_id:id,time:Date.now()/1000,message:[...(direct?[{type:'at',data:{qq:'34567'}}]:[]),{type:'text',data:{text:body}}]});
await service.receiveAdmitted(m(1,45678,'先聊一个合成话题'));const before=requests.length;assert.equal((await service.receiveAdmitted(m(2,56789,'你觉得怎样？'))).status,'quiet');assert.equal(requests.length,before);const direct=await service.receiveAdmitted(m(3,56789,'请你回答',true));assert.equal(direct.status,'sent',JSON.stringify(direct));
const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(16)]),image=service.media.importApprovedSeed(bytes,'synthetic sticker').id;
assert.equal((await service.receiveAdmitted(m(4,45678,'sticker',true))).status,'sent');assert.equal(sent.at(-1).text,'');assert.deepEqual(sent.at(-1).imageBytes,bytes);assert.ok(service.engine.db.prepare("SELECT text FROM turns WHERE event='4' AND role='assistant'").get().text.length>0);
assert.throws(()=>service.engine.toolsFor(scope.address,'missing'));
let repeats=0;service.engine.client={respond:async req=>{if(!req.tools.some(tool=>tool.name==='send_image_only'))return call('discover_tools',{category:'images'});if(++repeats===1)return call('send_image_only',{id:image});assert.ok(JSON.stringify(req.input).includes('rejected or failed'));return {response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'改用文字'}]}]}};}};
assert.equal((await service.receiveAdmitted(m(5,45678,'sticker',true))).status,'sent');assert.equal(sent.at(-1).imageBytes,undefined);
await service.pause();allowed=false;const n=sent.length;await assert.rejects(service.initiate(scope,'proactive:blocked','不得发送',{version:service.engine.revisions.get(scope.address),send:async()=>sent.push('wrong')}));assert.equal(sent.length,n);await service.close();
console.log('PASS social: family-only local initiation/no model export, daily/cooldown/quiet/night/stop/restart/no-chase/bot/budget, multi-human question restraint/direct responsiveness, standalone sticker and nonempty history; synthetic only');


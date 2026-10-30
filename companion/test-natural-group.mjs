import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ConversationService} from './conversation-service.mjs';
import {isolatedQQRoute} from './isolated-qq-route.mjs';
import {EventLedger} from './event-ledger.mjs';
const reply=text=>({response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]}});
const text=value=>({type:'text',data:{text:value}}),at=id=>({type:'at',data:{qq:String(id)}}),quote=id=>({type:'reply',data:{id:String(id)}});
const message=(id,segments,group=12345)=>({post_type:'message',message_type:'group',group_id:group,user_id:45678,message_id:id,time:1792890000,message:segments,sender:{card:'展示名'}});
const requests=[],sent=[];
let service=new ConversationService({root:mkdtempSync(join(tmpdir(),'whale-natural-')),botId:'34567',publicProfile:'synthetic',isAllowed:()=>true,send:async v=>sent.push(v),client:{respond:async req=>{requests.push(req);return reply('好');}}});
assert.equal((await service.receiveAdmitted(message(1,[at(56789),text('你那边好了么')]))).status,'quiet');
assert.equal(requests.length,0);
await service.receiveAdmitted(message(2,[at(34567),quote(1),text('听见了吗')]));
let current=JSON.parse(requests.at(-1).input.at(-1).content);
assert.equal(current.transport.attention,'direct');assert.equal(current.segments[0].target,'34567');
assert.equal(current.segments[1].reference.sender_id,'45678');
assert.equal(current.transport.display_name,'展示名');
// A quote ID from a different conversation cannot resolve here.
await service.receiveAdmitted(message(3,[quote(1),text('另一个群')],23456));
current=JSON.parse(requests.at(-1).input.at(-1).content);assert.equal(current.segments[0].reference,null);
service.history.importEvent({type:'qq.self',source:'qq',origin:'external',meta:{conv:{kind:'group',id:12345},message_id:90},text:'自己的回复',ts:new Date().toISOString()},'isolated-qq-outgoing');
await service.receiveAdmitted(message(4,[quote(90),text('补充问题')]));
current=JSON.parse(requests.at(-1).input.at(-1).content);assert.equal(current.transport.attention,'direct');
assert.equal((await service.receiveAdmitted(message(5,[quote(1),at(56789),text('只问别人')]))).status,'quiet');
await service.receiveAdmitted(message(6,[text('随口接一句')]));
await service.receiveAdmitted(message(7,[text('再说一句')]));
const before=requests.length;
assert.equal((await service.receiveAdmitted(message(8,[text('大家继续聊')]))).status,'quiet');assert.equal(requests.length,before);
await service.receiveAdmitted(message(9,[text('汐，你觉得呢？')]));assert.equal(requests.length,before+1);
assert.equal((await service.receiveAdmitted(message(1,[text('重复')]))).status,'duplicate');
await service.close();

// A new message between bubbles stops the remainder; acknowledged first bubble
// is never automatically retried, and the uncertain whole reply is not context.
let releaseBubble,enteredBubble;const bubbleReady=new Promise(r=>enteredBubble=r),bubbleGate=new Promise(r=>releaseBubble=r);
const bubbles=[],bubbleRequests=[];
service=new ConversationService({root:mkdtempSync(join(tmpdir(),'whale-natural-bubbles-')),botId:'34567',publicProfile:'synthetic',isAllowed:()=>true,
 client:{respond:async req=>{bubbleRequests.push(req);return reply(bubbleRequests.length===1?'已发第一句\n不应发的旧第二句':'新回复');}},send:async v=>bubbles.push(v.text),wait:()=>{enteredBubble();return bubbleGate;}});
const old=service.receiveAdmitted(message(20,[at(34567),text('原问题')]));await bubbleReady;
const followup=service.receiveAdmitted(message(21,[at(34567),text('更正了')]));releaseBubble();
assert.equal((await old).status,'failed-no-retry');assert.equal((await followup).status,'sent');
assert.deepEqual(bubbles,['已发第一句','新回复']);
assert.ok(!JSON.stringify(bubbleRequests[1].input).includes('不应发的旧第二句'));
assert.equal((await service.receiveAdmitted(message(20,[text('重送')]))).status,'duplicate');
await service.close();

// Real routing/batching with a blocked fake generation, no QQ or provider network.
let release,started;const ready=new Promise(r=>started=r),blocked=new Promise(r=>release=r);
const routeRequests=[],routeSent=[];let groups=[];
const world={setWatched:g=>groups=g,getWatched:()=>({groups}),start:async()=>{},stop:async()=>{},handleEvent:()=>{},sendToTarget:async(target,value)=>routeSent.push({target,...value})};
const ledger=new EventLedger(':memory:');
const route=isolatedQQRoute(world,{root:mkdtempSync(join(tmpdir(),'whale-natural-route-')),policy:{group_id:'12345',bot_id:'34567'},ledger,clock:()=>new Date('2026-10-25T08:00:00+08:00'),batchOptions:{delayMs:10,maxWaitMs:25},publicProfile:'synthetic',client:{respond:async req=>{
 routeRequests.push(req);if(routeRequests.length===1){started();await blocked;return reply('过时的答案');}return reply('合并后的答案');
}}});
const m=(id,body)=>({...message(id,[at(34567),text(body)]),time:new Date('2026-10-25T08:00:00+08:00').getTime()/1000});
const first=world.handleEvent(m(101,'第一问'));await ready;
const second=world.handleEvent(m(102,'补充条件'));
const third=world.handleEvent(m(103,'更正条件'));
// Arrival invalidates even before the debounce window has flushed.
release();assert.equal((await first).status,'superseded');
await Promise.all([second,third]);
assert.equal(routeSent.length,1);assert.equal(routeSent[0].text,'合并后的答案');
assert.equal(routeRequests.length,2);const context=JSON.stringify(routeRequests[1].input);
for(const body of ['第一问','补充条件','更正条件'])assert.ok(context.includes(body));
for(const id of [101,102,103])assert.equal(route.service.engine.db.prepare("SELECT count(*) n FROM turns WHERE event=? AND role='user'").get(String(id)).n,1);
assert.equal((await world.handleEvent(m(102,'重复'))).reason,'stale-or-duplicate');
await route.pause();assert.equal((await world.handleEvent(m(104,'暂停'))).status,'paused-or-closed');route.resume();
await world.stop();ledger.close();
console.log('PASS natural groups: structured at/reply, same-chat quote lookup, listening/cooldown/direct followup, stale generation suppression on arrival, coalesced newest context, individual history IDs, duplicate and pause; synthetic only');

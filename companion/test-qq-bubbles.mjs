import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {guardQQWorld} from './qq-event-policy.mjs';
import {installBubbles} from './qq-bubbles.mjs';
const [app,plugin]=process.argv.slice(2);
await import(pathToFileURL(join(app,'build/cortico/src/extensions/runtime.ts')).href);
const {QQWorld}=await import(pathToFileURL(join(plugin,'src/world.ts')).href);
function fixture({onWait=()=>{},failAt=-1}={}){
  const world=new QQWorld({wsUrl:'ws://127.0.0.1:1',groups:[100],privates:[],token:''});
  const state={now:new Date('2026-10-24T09:00:00+08:00'),sent:[],waits:0};
  guardQQWorld(world,{group_id:'100',bot_id:'200'},()=>state.now);
  installBubbles(world,{wait:async()=>{state.waits++;onWait(world,state);}});
  world.host={drainPendingEvents:async()=>[],pushEvent:async()=>({ts:state.now.toISOString()})};
  world.knownMessages.set('123',{conv:{kind:'group',id:100},ts:state.now.toISOString()});
  world.driver={identity:{selfId:200,groups:new Map()},callApi:async(action,args)=>{
    assert.equal(action,'send_group_msg');assert.equal(args.group_id,100);
    state.sent.push(args.message);if(state.sent.length===failAt)throw new Error('synthetic timeout');
    return {message_id:state.sent.length};
  }};
  const invoke=(name,args)=>world.tools().find(t=>t.name===name).handler(args,{});
  return {world,state,invoke};
}
let f=fixture();
assert.match(await f.invoke('qq_draft',{to:'group:100',bubbles:['第一句','第二句'],reply_to:'123',quote:true}),/draft staged/);
assert.equal(f.state.sent.length,0);
await f.invoke('qq_confirm',{decision:'send'});
assert.equal(f.state.sent.length,2);
assert.equal(f.state.sent[0].filter(s=>s.type==='reply').length,1);
assert.equal(f.state.sent[1].filter(s=>s.type==='reply').length,0);
assert.match(await f.invoke('qq_confirm',{decision:'send'}),/no draft/);
f=fixture();await f.invoke('qq_draft',{to:'group:100',text:'普通长文本\n\n保留原样',keep_together:true});await f.invoke('qq_confirm',{decision:'send'});assert.equal(f.state.sent.length,1);
f=fixture();await f.invoke('qq_draft',{to:'group:100',bubbles:['a','b']});await f.invoke('qq_confirm',{decision:'cancel'});assert.equal(f.state.sent.length,0);
f=fixture();await f.invoke('qq_draft',{to:'group:100',bubbles:['old','draft']});await f.invoke('qq_draft',{to:'group:100',text:'new'});await f.invoke('qq_confirm',{decision:'send'});assert.equal(f.state.sent.length,1);
f=fixture();assert.match(await f.invoke('qq_draft',{to:'group:100',text:'x',bubbles:['a','b']}),/bad input/);assert.equal(f.world.pendingDraft,null);
f=fixture({onWait:w=>{w.guardianInboundVersion=(w.guardianInboundVersion??0)+1;}});await f.invoke('qq_draft',{to:'group:100',bubbles:['a','b']});assert.match(await f.invoke('qq_confirm',{decision:'send'}),/interrupted/);assert.equal(f.state.sent.length,1);
f=fixture({failAt:2});await f.invoke('qq_draft',{to:'group:100',bubbles:['a','b','c']});assert.match(await f.invoke('qq_confirm',{decision:'send'}),/uncertain/);assert.equal(f.state.sent.length,2);assert.match(await f.invoke('qq_confirm',{decision:'send'}),/no draft/);
f=fixture({onWait:(_,s)=>{s.now=new Date('2026-10-25T00:00:00+08:00');}});await f.invoke('qq_draft',{to:'group:100',bubbles:['a','b']});await f.invoke('qq_confirm',{decision:'send'});assert.equal(f.state.sent.length,1);
console.log('PASS: actual QQ draft/confirm; multi-bubble, quote-once, legacy text, cancel/replace/invalid, interruption, uncertain-send no retry, midnight guard; zero network');

f=fixture();await f.invoke('qq_draft',{to:'group:100',text:'哎嘿\n老爹你看这个',reply_to:'123'});await f.invoke('qq_confirm',{decision:'send'});assert.equal(f.state.sent.length,2);assert.ok(f.state.sent.every(m=>!m.some(s=>s.type==='reply')));
f=fixture();await f.invoke('qq_draft',{to:'group:100',text:'好呀',reply_to:'123'});await f.invoke('qq_confirm',{decision:'send'});assert.ok(!f.state.sent[0].some(s=>s.type==='reply'));
f=fixture();await f.invoke('qq_draft',{to:'group:100',text:'- 第一项\n- 第二项'});await f.invoke('qq_confirm',{decision:'send'});assert.equal(f.state.sent.length,1);
console.log('PASS: short paragraph fallback, default no quote, explicit quote, structured text preservation');

// Synthetic worlds and friend lists only: no real QQ, network, provider, or files.
import test from 'node:test';
import assert from 'node:assert/strict';
import {guardQQWorld,sendLifeQQDelivery} from './qq-event-policy.mjs';

const BOT='900000004',GROUP='900000002',FATHER='910410001',MOTHER='910410002',OTHER='910410003';
const DAY=Date.parse('2026-10-30T10:00:00+08:00'),NIGHT=Date.parse('2026-10-31T00:00:00+08:00');
function fixture({friends=[FATHER,MOTHER],enabled=true,friendLookup,send}={}){
 let now=DAY,watched={groups:[Number(GROUP)],users:[]};const calls=[],order=[];
 const policy={bot_id:BOT,group_id:GROUP,group_ids:[GROUP],father_id:FATHER,mother_id:MOTHER,friend_private_enabled:enabled,follow_configured_groups:true};
 const receipt={message_id:123456};
 const world={handleEvent:async()=>({accepted:true}),getWatched:()=>watched,setWatched:(groups,users)=>{watched={groups,users};},
  driver:{callApi:async(name,args)=>{assert.equal(name,'get_friend_list');order.push('friend');return friendLookup?friendLookup():friends.map(user_id=>({user_id}));}},
  sendToTarget:async function(target,expression){assert.equal(this,world);calls.push({target,expression});order.push('transport');return send?send(target,expression):receipt;}};
 guardQQWorld(world,policy,()=>new Date(now));
 return {world,policy,calls,order,receipt,clock:value=>now=value,watched:value=>watched=value};
}
const privateTarget=id=>({kind:'private',id});
const denied=async(promise,pattern)=>assert.rejects(promise,error=>{assert.equal(error.deliveryAttempted,false);if(pattern)assert.match(error.message,pattern);return true;});

test('only installed guards and bounded exact destinations/text can use life delivery',async()=>{
 await denied(sendLifeQQDelivery({},privateTarget(FATHER),'fixture'),/installed/);
 const partial={handleEvent:async()=>{},setWatched:()=>{},getWatched:()=>({groups:[Number(GROUP)]})};Object.defineProperty(partial,'sendToTarget',{value:async()=>{throw Error('Partial guard transport must not run');},writable:false});
 assert.throws(()=>guardQQWorld(partial,{bot_id:BOT,group_id:GROUP},()=>new Date(DAY)));await denied(sendLifeQQDelivery(partial,{kind:'group',id:GROUP},'fixture'),/installed/);
 const f=fixture();let attempts=0;
 for(const target of [privateTarget(OTHER),privateTarget(BOT),{kind:'group',id:OTHER},{kind:'private',id:'../../escape'}])await denied(sendLifeQQDelivery(f.world,target,'fixture',{onTransportAttempt:()=>attempts++}));
 await denied(sendLifeQQDelivery(f.world,privateTarget(FATHER),' '.repeat(5)));
 await denied(sendLifeQQDelivery(f.world,privateTarget(FATHER),'x'.repeat(501)));
 assert.equal(attempts,0);assert.equal(f.calls.length,0);
});

test('both current-friend parents can initiate by day without a lease; ordinary private replies keep their lease',async()=>{
 const f=fixture();let attempts=0;
 for(const id of [FATHER,MOTHER])assert.equal(await sendLifeQQDelivery(f.world,privateTarget(id),'Synthetic own sharing',{beforeTransport:()=>f.order.push('before'),onTransportAttempt:()=>{attempts++;f.order.push('attempt');}}),f.receipt);
 assert.deepEqual(f.order,['friend','before','attempt','transport','friend','before','attempt','transport']);assert.equal(attempts,2);
 assert.deepEqual(f.calls.map(c=>c.expression),[{text:'Synthetic own sharing'},{text:'Synthetic own sharing'}]);
 await assert.rejects(()=>f.world.sendToTarget(privateTarget(FATHER),{text:'Ordinary reply has no lease'}),/fresh message/);assert.equal(f.calls.length,2);
 await f.world.handleEvent({post_type:'message',message_type:'private',sub_type:'friend',user_id:FATHER,message_id:42});
 assert.equal(await f.world.sendToTarget(privateTarget(FATHER),{text:'Ordinary reply with real lease'}),f.receipt);assert.equal(f.calls.length,3);
});

test('strangers, non-parent friends, disabled private and a failed friend lookup are rejected before transport',async()=>{
 for(const options of [{friends:[]},{friends:[OTHER]},{enabled:false},{friendLookup:async()=>{throw Error('Synthetic lookup failure');}}]){
  const f=fixture(options);let attempts=0;await denied(sendLifeQQDelivery(f.world,privateTarget(FATHER),'fixture',{onTransportAttempt:()=>attempts++}));assert.equal(attempts,0);assert.equal(f.calls.length,0);
 }
 const other=fixture({friends:[OTHER,FATHER]});await denied(sendLifeQQDelivery(other.world,privateTarget(OTHER),'fixture'),/parent/);
});

test('life group is the exact configured family group and must still be watched',async()=>{
 const f=fixture();assert.equal(await sendLifeQQDelivery(f.world,{kind:'group',id:GROUP},'fixture'),f.receipt);
 f.watched({groups:[],users:[]});await denied(sendLifeQQDelivery(f.world,{kind:'group',id:GROUP},'fixture'),/watched family/);
 f.watched({groups:[Number(OTHER)],users:[]});await denied(sendLifeQQDelivery(f.world,{kind:'group',id:OTHER},'fixture'),/watched family/);assert.equal(f.calls.length,1);
});

test('night never borrows an at wake-up; fresh ordinary group wake behavior remains unchanged',async()=>{
 const f=fixture();f.clock(NIGHT);
 await f.world.handleEvent({post_type:'message',message_type:'group',group_id:GROUP,user_id:FATHER,message_id:1,message:[{type:'at',data:{qq:BOT}}]});
 assert.equal(await f.world.sendToTarget({kind:'group',id:GROUP},{text:'Ordinary mentioned reply'}),f.receipt);
 let attempts=0;for(const target of [privateTarget(FATHER),{kind:'group',id:GROUP}])await denied(sendLifeQQDelivery(f.world,target,'fixture',{onTransportAttempt:()=>attempts++}),/resting/);
 assert.equal(attempts,0);assert.equal(f.calls.length,1);
 f.clock(Date.parse('2026-10-31T06:59:59.999+08:00'));await denied(sendLifeQQDelivery(f.world,privateTarget(FATHER),'fixture'),/resting/);
 f.clock(Date.parse('2026-10-31T07:00:00+08:00'));assert.equal(await sendLifeQQDelivery(f.world,privateTarget(FATHER),'fixture'),f.receipt);
});

test('async friendship lookup crossing midnight is rechecked before beforeTransport or attempt',async()=>{
 let f;f=fixture({friendLookup:async()=>{f.clock(NIGHT);return [{user_id:FATHER}];}});let before=0,attempts=0;
 await denied(sendLifeQQDelivery(f.world,privateTarget(FATHER),'fixture',{beforeTransport:()=>before++,onTransportAttempt:()=>attempts++}),/resting/);
 assert.equal(before,0);assert.equal(attempts,0);assert.equal(f.calls.length,0);
});

test('paused/aborted beforeTransport preserves the original error and is never an attempt',async()=>{
 const f=fixture(),paused=Error('Synthetic service paused');let attempts=0;
 await assert.rejects(()=>sendLifeQQDelivery(f.world,privateTarget(FATHER),'fixture',{beforeTransport:async()=>{throw paused;},onTransportAttempt:()=>attempts++}),error=>error===paused&&error.deliveryAttempted===false);
 const controller=new AbortController();controller.abort();await denied(sendLifeQQDelivery(f.world,privateTarget(FATHER),'fixture',{beforeTransport:()=>controller.signal.throwIfAborted(),onTransportAttempt:()=>attempts++}));
 await denied(sendLifeQQDelivery(f.world,privateTarget(FATHER),'fixture',{beforeTransport:async()=>false,onTransportAttempt:()=>attempts++}),/declined/);
 assert.equal(attempts,0);assert.equal(f.calls.length,0);
});

test('final synchronous checks catch night, parent-policy and group-watch changes during beforeTransport',async()=>{
 for(const change of [f=>f.clock(NIGHT),f=>f.policy.friend_private_enabled=false,f=>f.policy.father_id=OTHER]){
  const f=fixture();let attempts=0;await denied(sendLifeQQDelivery(f.world,privateTarget(FATHER),'fixture',{beforeTransport:async()=>change(f),onTransportAttempt:()=>attempts++}));assert.equal(attempts,0);assert.equal(f.calls.length,0);
 }
 const f=fixture();let attempts=0;await denied(sendLifeQQDelivery(f.world,{kind:'group',id:GROUP},'fixture',{beforeTransport:async()=>f.watched({groups:[]}),onTransportAttempt:()=>attempts++}),/watched/);assert.equal(attempts,0);
});

test('transport rejection is the same error with attempted=true and only one attempt',async()=>{
 const original=Error('Synthetic uncertain transport'),f=fixture({send:async()=>{throw original;}});let attempts=0;
 await assert.rejects(()=>sendLifeQQDelivery(f.world,privateTarget(FATHER),'fixture',{onTransportAttempt:()=>attempts++}),error=>error===original&&error.deliveryAttempted===true);
 assert.equal(attempts,1);assert.equal(f.calls.length,1);
});

test('destination is frozen before async authorization and callback cannot redirect it',async()=>{
 const f=fixture(),target=privateTarget(FATHER);await sendLifeQQDelivery(f.world,target,'fixture',{beforeTransport:async()=>{target.id=OTHER;target.kind='group';}});
 assert.deepEqual(f.calls[0].target,privateTarget(FATHER));assert.ok(Object.isFrozen(f.calls[0].target));
});

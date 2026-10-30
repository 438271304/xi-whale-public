import assert from 'node:assert/strict';
import test from 'node:test';
import {LifeSocialTargets,lifeSocialTargets} from './life-social-targets.mjs';

const ids={bot:'910010001',father:'910010002',mother:'910010003',friend:'910010004',peer:'900000005',family:'910020001',group:'910020002'};
const friend=id=>({user_id:Number(id),nickname:'朋友 '+id});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(){
 const state={groups:[Number(ids.family),Number(ids.group)],friends:[friend(ids.father),friend(ids.mother),friend(ids.friend),friend(ids.peer)],calls:[],error:null};
 const policy={bot_id:ids.bot,group_id:ids.family,father_id:ids.father,mother_id:ids.mother,friend_private_enabled:true,peer_bot_ids:[ids.peer]};
 const world={getWatched:()=>({groups:[...state.groups],privates:[]}),driver:{identity:{selfId:Number(ids.bot),groups:new Map([[Number(ids.group),{groupName:'已加入的群'}]])},async callApi(name,args){state.calls.push({name,args});if(state.error)throw state.error;return state.friends;}}};
 return {state,policy,world,registry:new LifeSocialTargets({world,policy})};
}

test('one registry is shared per world, with verified aliases first and each actual target listed only once',async()=>{
 const f=fixture(),shared=lifeSocialTargets(f.world,f.policy);
 assert.equal(lifeSocialTargets(f.world,{...f.policy}),shared);
 assert.notEqual(lifeSocialTargets(fixture().world,f.policy),shared);
 assert.equal(shared.list().friend_state,'unverified');
 assert.deepEqual(shared.list().targets.map(t=>t.recipient),['family','group:'+ids.group]);
 await shared.refresh();
 const full=shared.list();
 assert.equal(full.friend_state,'available');assert.equal(full.total,6);assert.equal(full.next_offset,null);
 assert.deepEqual(full.targets.map(t=>t.recipient),['family','father','mother','group:'+ids.group,'private:'+ids.friend,'private:'+ids.peer]);
 assert.deepEqual(f.state.calls,[{name:'get_friend_list',args:{}}]);
 assert.equal(new Set(full.targets.map(t=>t.target_kind+':'+t.target_id)).size,full.total);
 const pages=[shared.list({limit:2}),shared.list({offset:2,limit:2}),shared.list({offset:4,limit:2})];
 assert.deepEqual(pages.map(p=>p.next_offset),[2,4,null]);assert.deepEqual(pages.flatMap(p=>p.targets),full.targets);
 assert.deepEqual(shared.list({offset:100}).targets,[]);
 assert.throws(()=>shared.list({offset:-1}));assert.throws(()=>shared.list({limit:0}));
});

test('only bridge roster identities are accepted; self/devices and malformed IDs are excluded, labels cannot alter targets',async()=>{
 const f=fixture();f.state.groups.push(Number(ids.group),'broken','00001',1234);
 f.state.friends.push(friend(ids.bot),friend('2113929217'),friend('2113929218'),friend('2113929219'),{user_id:[]},{user_id:'00001'},{user_id:1234},{user_id:'1234567890123456'},friend(ids.friend));
 f.state.friends.find(row=>String(row.user_id)===ids.friend).remark='\u0000\u202e'+ '名'.repeat(90)+'\n';
 f.world.driver.identity.groups.get(Number(ids.group)).groupName='\u0000\u202e熟人\n群';
 await f.registry.refresh();const listed=f.registry.list();
 assert.equal(listed.total,6);assert.equal(listed.targets.find(t=>t.target_id===ids.friend).label,'名'.repeat(80));
 assert.equal(listed.targets.find(t=>t.target_id===ids.group).label,'熟人群');
 assert.ok(listed.targets.some(t=>t.target_id===ids.peer),'Known peer bots stay on the real roster; the delivery guard enforces their finite turns');
 assert.deepEqual(f.registry.resolve('private:'+ids.friend,'刚好想到这位朋友'),{recipient:'private:'+ids.friend,target_kind:'private',target_id:ids.friend,recipient_reason:'刚好想到这位朋友'});
 assert.throws(()=>f.registry.resolve('private:910010099','任意账号'));
 assert.throws(()=>f.registry.resolve('private:'+ids.father,'别名不能再列一份'));
 assert.throws(()=>f.registry.check({kind:'private',id:ids.bot}));
 assert.throws(()=>f.registry.check({kind:'private',id:'2113929217'}));
});

test('legacy configured aliases may resolve before refresh but never grant an unverified delivery',async()=>{
 const f=fixture();f.state.groups=[];
 assert.deepEqual(f.registry.resolve('family','旧家庭意图'),{recipient:'family',target_kind:'group',target_id:ids.family,recipient_reason:'旧家庭意图'});
 assert.equal(f.registry.resolve('father','旧私聊意图').target_id,ids.father);
 assert.equal(f.registry.list().total,0);
 assert.throws(()=>f.registry.resolve('private:'+ids.friend,'未验证好友'));
 assert.throws(()=>f.registry.check({kind:'private',id:ids.father}));
 assert.throws(()=>f.registry.check({kind:'group',id:ids.family}));
 f.state.friends=[];await f.registry.refresh();
 assert.throws(()=>f.registry.resolve('father','已经不在好友名单'));
 assert.throws(()=>f.registry.resolve('family','已经不在群名单'));
});

test('watched group changes are read on every list, resolve, check and authorization without changing configuration',async()=>{
 const f=fixture();assert.equal(f.registry.check({kind:'group',id:ids.group}),true);
 f.state.groups=[Number(ids.family)];
 assert.equal(f.registry.list().total,1);
 assert.throws(()=>f.registry.resolve('group:'+ids.group,'已经移出'));
 assert.throws(()=>f.registry.check({kind:'group',id:ids.group}));
 await assert.rejects(f.registry.authorize({kind:'group',id:ids.group}));
 assert.equal(await f.registry.authorize({kind:'group',id:ids.family}),true);
 assert.equal(f.state.calls.length,0,'Group checks never need a friend call or roster mutation');
});

test('private authorization rechecks the roster, revokes removed friends and clears old cache on unavailable response',async()=>{
 const f=fixture();await f.registry.refresh();
 assert.equal(f.registry.check({kind:'private',id:ids.friend}),true);
 f.state.friends=f.state.friends.filter(row=>String(row.user_id)!==ids.friend);
 await assert.rejects(f.registry.authorize({kind:'private',id:ids.friend}));
 assert.throws(()=>f.registry.check({kind:'private',id:ids.friend}));
 assert.equal(await f.registry.authorize({kind:'private',id:ids.father}),true);
 f.state.error=new Error('bridge unavailable');
 const failed=await f.registry.refresh();assert.equal(failed.friend_state,'unavailable');
 assert.deepEqual(failed.targets.map(t=>t.target_kind),['group','group']);
 assert.throws(()=>f.registry.check({kind:'private',id:ids.father}));
 await assert.rejects(f.registry.authorize({kind:'private',id:ids.father}));
 assert.equal(await f.registry.authorize({kind:'group',id:ids.group}),true);
 f.state.error=null;f.state.friends={data:[friend(ids.father)]};
 assert.equal((await f.registry.refresh()).friend_state,'unavailable','An unexpected API envelope is not guessed to be a roster');
});

test('disabled friend contact makes no friend request and cannot be revived by old cached identities',async()=>{
 const f=fixture();await f.registry.refresh();const calls=f.state.calls.length;
 f.policy.friend_private_enabled=false;
 assert.deepEqual(f.registry.list().targets.map(t=>t.target_kind),['group','group']);
 assert.equal(f.registry.list().friend_state,'disabled');
 await assert.rejects(f.registry.authorize({kind:'private',id:ids.father}));
 assert.equal((await f.registry.refresh()).friend_state,'disabled');
 assert.equal(f.state.calls.length,calls);
 f.policy.friend_private_enabled=true;assert.throws(()=>f.registry.check({kind:'private',id:ids.father}));
});

test('an aborted late roster response never commits identities or authorizes private delivery',async()=>{
 const f=fixture(),lookup=deferred(),controller=new AbortController();
 f.world.driver.callApi=()=>lookup.promise;
 const request=f.registry.authorize({kind:'private',id:ids.friend},{signal:controller.signal});
 controller.abort();lookup.resolve([friend(ids.friend)]);
 await assert.rejects(request,{name:'AbortError'});
 assert.equal(f.registry.list().friend_state,'unverified');
 assert.equal(f.registry.list().targets.some(t=>t.target_kind==='private'),false);
 assert.throws(()=>f.registry.check({kind:'private',id:ids.friend}));
 const previous=f.registry.list();
 await assert.rejects(f.registry.refresh({signal:controller.signal}),{name:'AbortError'});
 assert.deepEqual(f.registry.list(),previous);
});

test('older concurrent friend responses cannot restore a deleted friend or satisfy a superseded authorization',async()=>{
 const f=fixture();await f.registry.refresh();
 const older=deferred(),newer=deferred();let call=0;
 f.world.driver.callApi=()=>++call===1?older.promise:newer.promise;
 const authorization=f.registry.authorize({kind:'private',id:ids.friend});
 const refresh=f.registry.refresh();newer.resolve([]);await refresh;
 older.resolve([friend(ids.friend)]);await assert.rejects(authorization,/superseded/);
 assert.equal(f.registry.list().friend_state,'available');
 assert.equal(f.registry.list().targets.some(t=>t.target_kind==='private'),false);
 assert.throws(()=>f.registry.check({kind:'private',id:ids.friend}));
});

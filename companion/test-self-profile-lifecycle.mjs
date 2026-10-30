// Fixed fake QQ identity/API and in-memory stores. No real account/network writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {QQSelfProfile} from './qq-self-profile.mjs';
const SELF = '900000004';
const png = n => Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(16,n)]);
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise,resolve};};
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
 let allowed = true, nickname = 'Synthetic whale', signature = 'Old synthetic signature', avatar = png(1), login = SELF;
 let driverHook, currentHook, resolveHook, matchesHook, listHook;
 const calls = [], avatarCalls = [];
 const profile = new QQSelfProfile({path: ':memory:', authorize: () => allowed,
  driver: {callApi: async (name,args) => {
   calls.push({name,args}); if(driverHook)await driverHook(name,args);
   if(name==='get_login_info')return {user_id:login,nickname};
   if(name==='get_stranger_info')return {user_id:login,nickname,long_nick:signature};
   if(name==='set_qq_profile'){nickname=args.nickname;return {};}
   if(name==='set_self_longnick'){signature=args.longNick;return {};}
   if(name==='set_qq_avatar'){avatar=Buffer.from(args.file.slice(9),'base64');return {};}
   throw Error('Unexpected fixture API');
  }}, avatars: {
   current: async options => {avatarCalls.push({kind:'current',options});if(currentHook)await currentHook(options);return avatar;},
   resolve: async (id,options) => {assert.equal(id,'approved');avatarCalls.push({kind:'resolve',options});if(resolveHook)await resolveHook(options);return png(2);},
   matches: async (_a,_b,options) => {avatarCalls.push({kind:'matches',options});if(matchesHook)await matchesHook(options);return true;},
   list: async options => {avatarCalls.push({kind:'list',options});if(listHook)await listHook(options);return [{id:'approved'}];},
  }});
 t.after(async()=>{await profile.close();assert.equal(profile.pending.size,0);assert.equal(profile.controllers.size,0);});
 return {p:profile,calls,avatarCalls,writes:()=>calls.filter(c=>c.name.startsWith('set_')),
  allow:value=>{allowed=value;},login:value=>{login=value;},driver:fn=>{driverHook=fn;},current:fn=>{currentHook=fn;},resolve:fn=>{resolveHook=fn;},matches:fn=>{matchesHook=fn;},list:fn=>{listHook=fn;},
  avatar:value=>{avatar=value;},get signature(){return signature;}};
}

test('permission changing inside login await stops the next write and records an unattempted operation accurately',async t=>{
 const f=fixture(t),before=await f.p.read();let logins=0;
 f.driver(name=>{if(name==='get_login_info'&&++logins===2)f.allow(false);});
 await assert.rejects(f.p.update({expected_version:before.version,signature:'New'}),error=>error.write_attempted===false&&error.state==='failed-before-send');
 assert.equal(f.writes().length,0);const row=f.p.history().operations[0];assert.equal(row.state,'failed-before-send');assert.deepEqual(row.actions,[]);
});

test('pause drains queued work and a rapid resume never revives old queued or in-flight identity work',async t=>{
 const f=fixture(t),before=await f.p.read(),entered=deferred(),release=deferred();let logins=0;
 f.driver(async name=>{if(name==='get_login_info'&&++logins===2){entered.resolve();await release.promise;}});
 const first=f.p.update({expected_version:before.version,signature:'First'}),failed1=assert.rejects(first);
 await entered.promise;const second=f.p.update({expected_version:before.version,nickname:'Second'}),failed2=assert.rejects(second);
 let drained=false;const stopping=f.p.pause().then(()=>{drained=true;});
 try{await tick();assert.equal(drained,false);f.p.resume();}finally{release.resolve();}
 await Promise.all([failed1,failed2,stopping]);assert.equal(f.writes().length,0);assert.equal(logins,2);
 f.driver(null);assert.equal((await f.p.update({expected_version:before.version,signature:'Fresh opportunity'})).state,'verified');
});

test('external signal propagates to avatar awaits; cancellation is not swallowed as a missing avatar',async t=>{
 const f=fixture(t),entered=deferred(),release=deferred(),controller=new AbortController();
 f.current(async({signal})=>{assert.ok(signal);entered.resolve();await release.promise;assert.equal(signal.aborted,true);});
 const running=f.p.read({signal:controller.signal}),failed=assert.rejects(running);
 await entered.promise;controller.abort();release.resolve();await failed;
 assert.equal(f.p.db.prepare('SELECT count(*) n FROM qq_self_versions').get().n,0);
 assert.equal(f.p.db.prepare('SELECT count(*) n FROM qq_self_avatars').get().n,0);assert.equal(f.writes().length,0);
});

test('canAct ending while an avatar candidate resolves prevents its save and all later field writes',async t=>{
 const f=fixture(t),before=await f.p.read();let live=true;
 f.resolve(()=>{live=false;});
 await assert.rejects(f.p.update({expected_version:before.version,nickname:'New',avatar_id:'approved'},{canAct:()=>live}),/ended/);
 assert.equal(f.writes().length,0);assert.equal(f.p.db.prepare('SELECT count(*) n FROM qq_self_avatars').get().n,1);
 assert.equal(f.p.history().operations.length,0);
});

test('an already attempted write cancelled by pause stays uncertain and never continues remaining fields or retries',async t=>{
 const f=fixture(t),before=await f.p.read(),entered=deferred(),release=deferred();
 f.driver(async name=>{if(name==='set_qq_profile'){entered.resolve();await release.promise;}});
 const running=f.p.update({expected_version:before.version,nickname:'May have changed',signature:'Must not run'});
 const failed=assert.rejects(running,error=>error.write_attempted===true&&error.state==='failed-or-uncertain'&&error.automatic_retry===false);
 await entered.promise;let drained=false;const stopping=f.p.pause().then(()=>{drained=true;});
 try{await tick();assert.equal(drained,false);f.p.resume();}finally{release.resolve();}
 await failed;await stopping;assert.deepEqual(f.writes().map(c=>c.name),['set_qq_profile']);
 const row=f.p.history().operations[0];assert.equal(row.state,'failed-or-uncertain');assert.deepEqual(row.actions,['nickname']);assert.equal(row.after_version,null);
 assert.equal(f.signature,'Old synthetic signature');f.driver(null);
 assert.equal((await f.p.read()).receipt_summary.latest_operation.effect,'unconfirmed');assert.equal(f.writes().length,1);
});

test('driver failure after invocation preserves the attempted action even without a returned API response',async t=>{
 const f=fixture(t),before=await f.p.read();f.driver(name=>{if(name==='set_self_longnick')throw Error('Synthetic API response lost');});
 await assert.rejects(f.p.update({expected_version:before.version,signature:'New'}),error=>error.write_attempted===true&&error.state==='failed-or-uncertain');
 assert.deepEqual(f.p.history().operations[0].actions,['signature']);assert.equal(f.writes().length,1);
});

test('pause during visual comparison cannot promote an already attempted avatar change to verified',async t=>{
 const f=fixture(t),before=await f.p.read(),entered=deferred(),release=deferred();
 f.current(()=>{if(f.writes().length)f.avatar(png(3));});
 f.matches(async({signal})=>{entered.resolve();await release.promise;assert.equal(signal.aborted,true);});
 const running=f.p.update({expected_version:before.version,avatar_id:'approved'}),failed=assert.rejects(running,error=>error.write_attempted===true);
 await entered.promise;const stopping=f.p.pause();release.resolve();await failed;await stopping;
 assert.equal(f.p.history().operations[0].state,'failed-or-uncertain');assert.equal(f.writes().length,1);
});

test('tool options guard history and avatar-list awaits; unchanged callers still read/update/restore',async t=>{
 const f=fixture(t),before=await f.p.read();const changed=await f.p.update({expected_version:before.version,signature:'Changed'});
 assert.equal((await f.p.restore({version:before.version,expected_version:changed.after.version})).state,'verified');
 const denied=f.p.tools({canAct:()=>false});const calls=f.calls.length;
 for(const name of ['self_profile_read','self_profile_history','self_avatar_list'])await assert.rejects(denied.find(t=>t.name===name).handler({}),/ended/);
 assert.equal(f.calls.length,calls);
 const entered=deferred(),release=deferred(),controller=new AbortController();
 f.list(async({signal})=>{entered.resolve();await release.promise;assert.equal(signal.aborted,true);});
 const tool=f.p.tools({signal:controller.signal}).find(t=>t.name==='self_avatar_list');
 const running=tool.handler({}),failed=assert.rejects(running);await entered.promise;controller.abort();release.resolve();await failed;
});

test('close waits for standalone reads, is idempotent, rejects new work and never touches a closed database',async t=>{
 const f=fixture(t),entered=deferred(),release=deferred();f.driver(async name=>{if(name==='get_login_info'){entered.resolve();await release.promise;}});
 const running=f.p.read(),failed=assert.rejects(running);await entered.promise;
 const closing=f.p.close();assert.equal(f.p.close(),closing);await tick();assert.equal(f.p.dbClosed,false);
 assert.equal(f.p.db.prepare('SELECT count(*) n FROM qq_self_versions').get().n,0);await assert.rejects(f.p.read(),/closed/);assert.throws(()=>f.p.resume(),/closed/);
 release.resolve();await failed;await closing;assert.equal(f.p.dbClosed,true);assert.deepEqual(f.calls.map(c=>c.name),['get_login_info']);
});

test('maintenance baseline verification uses the same cancellation and attempted-write boundary',async t=>{
 const f=fixture(t),entered=deferred(),release=deferred();
 f.driver(async name=>{if(name==='set_qq_avatar'){entered.resolve();await release.promise;}});
 const running=f.p.verifyAvatarBaselineRestore(),failed=assert.rejects(running,error=>error.write_attempted===true&&error.state==='failed-or-uncertain');
 await entered.promise;const stopping=f.p.pause();release.resolve();await failed;await stopping;
 assert.equal(f.p.db.prepare("SELECT value FROM qq_self_capabilities WHERE key='avatar-baseline-restore'").get(),undefined);
 assert.equal(f.writes().length,1);assert.equal(f.p.history().operations[0].state,'failed-or-uncertain');
});

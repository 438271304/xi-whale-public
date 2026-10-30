// Real runtime wiring with temporary stores. Status must not invoke a model,
// network reader, identity check, credential reader, tool or QQ transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {conversationExtras} from './conversation-extras.mjs';
import {isolatedQQRoute} from './isolated-qq-route.mjs';
import {ScopedRouteManager} from './scoped-route-manager.mjs';
import {NativeWorkshopBackend} from './workshop-native.mjs';
import {BilibiliPublic} from './bilibili-public.mjs';

const NOW=Date.parse('2036-10-17T23:00:00+08:00');
const keys=['public_web','ordinary_tieba','claw','bilibili_subtitles','bilibili_frames','bilibili_speech','qq_voice','qzone_read','qzone_publish','own_workshop','proactive_faces','proactive_images','own_profile'];

test('runtime capabilities follow actual adapters and lifecycle without calling tools',async t=>{
 const noHeavyCheck=()=>{throw Error('UI status must not hash execution binaries');};
 const nativeCheck=t.mock.method(NativeWorkshopBackend.prototype,'capabilities',noHeavyCheck),videoCheck=t.mock.method(BilibiliPublic.prototype,'capabilities',noHeavyCheck);
 const root=mkdtempSync(join(tmpdir(),'whale-capability-')),store=join(root,'stores');mkdirSync(store);
 let calls=0,credentialReads=0,watched={groups:[910460001],users:[]},route;
 const noCall=async()=>{calls++;throw Error('Status must not cause an external call');};
 const client={respond:noCall,searchPublic:noCall,canInitiate:()=>false};
 const policy={bot_id:'910450001',father_id:'910450002',mother_id:'910450003',group_id:'910460001',friend_private_enabled:true};
 const extras=conversationExtras({workspace:join(root,'workspace'),notesRoot:join(root,'notes'),familyGroup:policy.group_id,workroomPath:join(store,'workroom.sqlite3'),policy,publicClient:client,fetcher:noCall,
  tiebaTokenReader:()=>{credentialReads++;throw Error('Status must not read credentials');}});
 const world={handleEvent:async()=>{},sendToTarget:noCall,knownMessages:new Map(),getWatched:()=>watched,setWatched:(groups,users)=>watched={groups,users},
  start:async function(host){this.host=host;this.driver={callApi:noCall};},stop:async()=>{}};
 const manager=new ScopedRouteManager();
 assert.equal(manager.status().capabilities,null);
 manager.create(()=>route=isolatedQQRoute(world,{root:store,client,publicProfile:'synthetic',policy,extraTools:extras,startPaused:true,clock:()=>new Date(NOW)}));
 t.after(async()=>{await world.stop();const target=realpathSync(root);assert.ok(target.startsWith(realpathSync(tmpdir())+sep));rmSync(target,{recursive:true,force:true});});
 const before=manager.status();assert.equal(before.ready,false);assert.equal(before.capabilities.items.own_profile.available,false);
 assert.equal(before.capabilities.items.own_profile.blocker,'route-not-ready');
 await world.start({pushEvent:noCall});
 assert.equal(manager.status().capabilities.items.own_profile.blocker,'service-paused');
 route.resume();
 const changes=()=>[route.service.cognition.store.db,route.social.life.db,route.service.selfQzone.db,route.service.selfProfile.db].map(db=>db.prepare('SELECT total_changes() n').get().n);
 const saved=changes();
 for(let i=0;i<2;i++){
  const result=manager.status(),items=result.capabilities.items;
  assert.equal(result.ready,true);assert.equal(result.accepting,true);assert.equal(result.capabilities.observed_at,NOW);
  assert.deepEqual(Object.keys(items).sort(),keys.sort());
  for(const key of ['qzone_read','qzone_publish','proactive_faces','proactive_images','own_profile'])assert.deepEqual(items[key],{configured:true,available:true,autonomous:true,blocker:null});
  assert.equal(items.public_web.available,null);assert.equal(items.ordinary_tieba.available,null);
  assert.equal(items.claw.configured,true);assert.equal(items.claw.available,null);assert.equal(items.claw.autonomous,true);
  assert.equal(items.own_workshop.configured,true);assert.equal(items.own_workshop.autonomous,true);
  assert.ok(!JSON.stringify(result).includes(policy.bot_id));assert.ok(!JSON.stringify(result).includes(root));
 }
 assert.deepEqual(changes(),saved);assert.equal(calls,0);assert.equal(credentialReads,0);
 assert.equal(nativeCheck.mock.calls.length,0);assert.equal(videoCheck.mock.calls.length,0);
 await route.pause();assert.equal(manager.status().capabilities.items.proactive_images.available,false);
 assert.equal(manager.status().capabilities.items.own_profile.autonomous,true,'pause preserves an actually connected autonomous entry');
 await world.stop();assert.equal(manager.status().capabilities.items.own_profile.available,false);assert.equal(calls,0);
});

test('absent optional services are not enabled by installed source files',async()=>{
 const root=mkdtempSync(join(tmpdir(),'whale-capability-empty-'));
 const extras=conversationExtras({workspace:join(root,'workspace'),notesRoot:join(root,'notes'),familyGroup:'910460001',fetcher:async()=>{throw Error('no fetch');}});
 try{
  const status=extras.capabilityStatus();
  assert.equal(status.claw.configured,false);assert.equal(status.claw.available,false);
  assert.equal(status.claw.blocker,'credential-reader-not-configured');
  for(const key of ['bilibili_subtitles','bilibili_frames','bilibili_speech','own_workshop']){
   assert.equal(status[key].configured,false);assert.equal(status[key].available,false);assert.equal(status[key].autonomous,false);
  }
  await extras.close();assert.equal(extras.capabilityStatus().public_web.blocker,'service-closed');
 }finally{await extras.close();rmSync(root,{recursive:true,force:true});}
});

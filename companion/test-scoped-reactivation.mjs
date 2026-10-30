// Actual pinned registry/QQ methods, synthetic model and transport only.
// Never opens a socket, sends QQ, or starts the production service.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareScopedAssembly} from './scoped-assembly.mjs';
import {ScopedRouteManager} from './scoped-route-manager.mjs';
import {EventLedger} from './event-ledger.mjs';

const app=process.argv[2]??'C:/Users/USER/PersonalAgentBackups/companion-runtime/clean-lab-0.2.8/resources/app';
const plugin=process.argv[3]??'C:/Users/USER/PersonalAgentRuntime/whale-v1/extensions/node_modules/cortico-world-qq';
await import(pathToFileURL(join(app,'build/cortico/src/extensions/runtime.ts')).href);
const {QQWorld}=await import(pathToFileURL(join(plugin,'src/world.ts')).href);
const {WorldAssembly}=await import(pathToFileURL(join(app,'build/cortico/src/world.ts')).href);
const root=mkdtempSync(join(tmpdir(),'whale-scoped-reactivation-'));
for(const name of ['source','workspace','data'])mkdirSync(join(root,name));
const config={worlds:{qq:{enabled:true}},timezone:'Asia/Shanghai',displayName:'Synthetic reactivation acceptance'};
writeFileSync(join(root,'config.json'),JSON.stringify(config));
const now=new Date('2026-10-28T12:00:00+08:00'),manager=new ScopedRouteManager(),routes=[],ledgers=[];
const counters={starts:0,stops:0,models:0,transportSends:0,sharedEvents:0,network:0};
const client={canInitiate:()=>false,respond:async()=>{counters.models++;return {response:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic reply '+counters.models}]}]}};}};
const host={pushEvent:async event=>{counters.sharedEvents++;return {...event,ts:now.toISOString()};}};
const build=()=>{
  const world=new QQWorld({wsUrl:'ws://127.0.0.1:1',groups:[12345],privates:[],token:''});
  // Replace transport lifecycle only. Routing, guardian admission, batching,
  // actual sendToTarget and assembly lifecycle use the installed implementations.
  world.start=async function(scopedHost){
    counters.starts++;this.host=scopedHost;
    this.driver={connected:true,setGroups:()=>{},identity:{selfId:34567,nickname:'Synthetic Xi',groups:new Map([[12345,{groupName:'Synthetic group',card:''}]])},callApi:async(action)=>{
      if(action==='get_group_info')return {group_id:12345,group_name:'Synthetic group'};
      if(action==='get_group_list')return [{group_id:12345,group_name:'Synthetic group'}];
      if(action==='get_friend_list')return [{user_id:45678,nickname:'Synthetic caller'}];
      if(action==='send_group_msg')return {message_id:9000+(++counters.transportSends)};
      throw Error('Unexpected synthetic transport operation: '+action);
    }};
  };
  world.stop=async function(){counters.stops++;if(this.driver)this.driver.connected=false;this.host=null;};
  const ledger=new EventLedger(join(root,'guardian-events.sqlite3'));ledgers.push(ledger);
  const route=prepareScopedAssembly({world,root:join(root,'scoped-chat'),workspace:join(root,'workspace'),sourceData:join(root,'source'),policy:{group_id:'12345',bot_id:'34567',father_id:'45678'},ledger,clock:()=>now,publicProfile:'Synthetic identity. Answer the present directed message.',manifest:'companion/sticker-seed.json',assets:'companion/assets/stickers',fetcher:async()=>{counters.network++;throw Error('No network in reactivation acceptance');},client});
  routes.push(route);return route;
};
const definition={id:'qq',label:'Synthetic QQ',defaults:()=>({enabled:true}),create:()=>manager.create(build)};
const loaded={rootDir:root,memoryDir:join(root,'workspace'),dataDir:join(root,'data'),repoRoot:app,config,secret:()=>''};
const registry=new WorldAssembly(loaded,[definition],['qq']);
let paused=true,busChanges=0;
const core={bus:{isPaused:()=>paused,setPaused:value=>{paused=value;busChanges++;}}};
registry.bind({mount:async world=>{await world.start(host);registry.mounted.push(world);},unmount:async id=>{const index=registry.mounted.findIndex(world=>world.id===id);assert.ok(index>=0);await registry.mounted[index].stop();registry.mounted.splice(index,1);},reservedToolNames:()=>[]});
const message=(id,text)=>({post_type:'message',message_type:'group',group_id:12345,user_id:45678,message_id:id,time:now.getTime()/1000,message:[{type:'at',data:{qq:'34567'}},{type:'text',data:{text}}]});
const received=(route,event)=>route.service.engine.db.prepare("SELECT state FROM turns WHERE peer='group:12345' AND event=? AND role='user'").get(String(event));

try{
  assert.equal(routes.length,1);assert.equal(counters.starts,0);assert.equal(counters.network,0);
  assert.equal(routes[0].service.paused,true);
  manager.attachCore(core);const boundSetPaused=core.bus.setPaused;
  assert.throws(()=>manager.attachCore(core),/attach|bound|already/i);
  assert.throws(()=>manager.create(build),/duplicate|active|closed|existing/i);
  const first=routes[0];await first.world.start(host);
  assert.equal(first.service.paused,true);
  core.bus.setPaused(false);assert.equal(first.service.paused,false);
  await first.world.handleEvent(message(101,'First directed synthetic message'));
  assert.equal(received(first,101)?.state,'completed');assert.equal(counters.models,1);assert.equal(counters.transportSends,1);

  // The framework's real stopSlot calls definition.create after the old stop.
  // This is the path which used to retain the closed old instance.
  await registry.deactivate('qq');
  assert.equal(first.closed,true);assert.equal(first.service.closed,true);
  assert.equal(routes.length,2);const second=routes[1];
  assert.notEqual(first.world,second.world);assert.equal(second.service.paused,true);
  const stopsAfterDeactivate=counters.stops;
  await first.world.stop();await first.world.stop();assert.equal(counters.stops,stopsAfterDeactivate);
  await assert.rejects(async()=>first.world.start(host),/closed|stopped|reuse/i);
  await registry.activate('qq');
  assert.equal(second.service.paused,false);assert.equal(core.bus.setPaused,boundSetPaused);
  assert.equal(counters.starts,2);
  await first.world.handleEvent(message(102,'Old closed source must not answer'));
  assert.equal(counters.models,1);assert.equal(counters.transportSends,1);
  await second.world.handleEvent(message(103,'New source after reactivation'));
  assert.equal(received(second,103)?.state,'completed');assert.equal(counters.models,2);assert.equal(counters.transportSends,2);
  assert.equal(received(second,102),undefined);

  // Explicit pause is retained through a second actual deactivate/activate cycle.
  core.bus.setPaused(true);await manager.drain();assert.equal(second.service.paused,true);
  await registry.deactivate('qq');assert.equal(second.closed,true);
  assert.equal(routes.length,3);const third=routes[2];await registry.activate('qq');
  assert.equal(third.service.paused,true);assert.equal(core.bus.setPaused,boundSetPaused);
  await third.world.handleEvent(message(104,'Must stay paused'));
  assert.equal(counters.models,2);assert.equal(received(third,104),undefined);
  core.bus.setPaused(false);assert.equal(third.service.paused,false);
  await third.world.handleEvent(message(105,'Explicit resume addresses current route'));
  assert.equal(received(third,105)?.state,'completed');assert.equal(counters.models,3);assert.equal(counters.transportSends,3);
  assert.equal(counters.sharedEvents,0);assert.equal(counters.network,0);assert.equal(busChanges,3);
  console.log('PASS actual pinned WorldAssembly + QQWorld with fake transport: no connection on construction; idempotent stop; fresh scoped factory on deactivate/reactivate; old instance cannot restart/reply; new input reaches turns; one bus binding follows current route; intentional pause retained; no model/network/QQ');
}finally{
  core.bus.setPaused(true);await manager.drain();
  for(const route of routes)await route.world.stop();
  for(const ledger of ledgers)ledger.close();
}

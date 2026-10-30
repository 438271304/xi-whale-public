import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CuriosityLife} from './curiosity-life.mjs';
import {ConversationService} from './conversation-service.mjs';
import {conversationScope} from './conversation-scope.mjs';
import {guardQQWorld,sendLifeQQDelivery} from './qq-event-policy.mjs';

// Real life/service/guard/SQLite, synthetic public reader, client and driver.
// Nothing is connected to a real model, QQ instance, account or remote website.
const BOT='910610001',FATHER='910610002',MOTHER='910610003',OTHER='910610004',GROUP='910620001';
const DAY=Date.parse('2036-10-17T12:00:00+08:00'),NIGHT=Date.parse('2036-10-18T00:01:00+08:00');
const privateScope=id=>conversationScope('private',id);
const initial=req=>JSON.parse(req.input.find(item=>item.role==='user').content);
const quiet={name:'keep_quiet',args:{}};
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'whale-family-delivery-'));
 let now=DAY,steps=[],sequence=0,friends=[FATHER,MOTHER,OTHER],friendHook=null,expressionHook=null,failTransport=false;
 let watched={groups:[Number(GROUP)],users:[]},friendChecks=0,service,life;
 const calls=[],requests=[],expressions=[],lastInbound=new Map(),contactPauses=new Set(),pauseJobs=[];
 const policy={bot_id:BOT,group_id:GROUP,group_ids:[GROUP],father_id:FATHER,mother_id:MOTHER,friend_private_enabled:true,follow_configured_groups:true};
 const social={inbound:address=>lastInbound.get(address)??0,availability:{status:scope=>({active:contactPauses.has(scope.address)})}};
 const world={handleEvent:async()=>({accepted:true}),getWatched:()=>watched,setWatched:(groups,users)=>{watched={groups,users};},
  driver:{callApi:async name=>{assert.equal(name,'get_friend_list');friendChecks++;if(friendHook&&friendChecks>1)await friendHook();return friends.map(user_id=>({user_id}));}},
  sendToTarget:async(target,expression)=>{
   assert.deepEqual(Object.keys(expression),['text']);calls.push({target:{...target},text:expression.text});
   if(failTransport)throw Error('Synthetic transport failed after attempt');return {message_id:961000+calls.length};
  }};
 guardQQWorld(world,policy,()=>new Date(now));
 const client={canInitiate:()=>true,generationSettings:()=>({model:'deepseek-flash',thinking:true,reasoningEffort:'high',maxTokens:8192}),respond:async req=>{
  if(req.tools.some(tool=>tool.name==='finish_life_share')){
   expressions.push(req);if(expressionHook)await expressionHook(req);
   return {response:{id:'synthetic-share-'+(++sequence),status:'completed',output:[{type:'function_call',name:'finish_life_share',call_id:'share-'+sequence,arguments:JSON.stringify({decision:'share',text:initial(req).draft,reason:'Preserve the fixture draft for transport assertions.'})}]},attempts:[]};
  }
  requests.push(req);assert.ok(steps.length,'Unexpected model step');const next=steps.shift(),action=typeof next==='function'?next(req):next;
  return {response:{id:'synthetic-life-'+(++sequence),status:'completed',output:[{type:'function_call',name:action.name,call_id:'call-'+sequence,arguments:JSON.stringify(action.args)}]},attempts:[]};
 }};
 const profile=readFileSync('companion/identity/SCOPED_PROFILE.md','utf8').replaceAll('900000004',BOT).replaceAll('900000001',FATHER).replaceAll('900000003',MOTHER);
 const tools=[{name:'public_fetch',description:'Read a synthetic public source; no network.',parameters:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false},
  handler:()=>JSON.stringify({status:'ok',sources:[{url:'https://example.org/family-discovery',title:'Synthetic tide observation',excerpt:'A genuinely returned fixture explanation of tidal timing.'}],retrieved_at:new Date(now).toISOString()})}];
 function open(){
  service=new ConversationService({root:join(root,'conversation'),client,publicProfile:profile,botId:BOT,guardianIds:[FATHER,MOTHER],isAllowed:()=>true,wait:async()=>{},send:args=>world.sendToTarget(args.target,{text:args.text})});
  service.social=social;
  life=new CuriosityLife({path:join(root,'life.sqlite3'),service,social,world,policy,client,clock:()=>now,topics:()=>[],tools});life.resume();
 }
 open();t.after(async()=>{await life.close();await service.close();await Promise.allSettled(pauseJobs);});
 return {root,world,policy,social,calls,requests,expressions,get service(){return service;},get life(){return life;},get friendChecks(){return friendChecks;},
  plan(...next){steps=next;},consumed(){assert.equal(steps.length,0,'Every scripted decision should execute');},
  explore(recipient){steps=[{name:'choose_activity',args:{topic:'Tidal timing',why:'A real fixture detail caught my attention.'}},
   {name:'public_fetch',args:{url:'https://example.org/family-discovery'}},{name:'save_discovery',args:{summary:'The returned fixture explains a tidal timing detail.'}},
   {name:'share_discovery',args:{recipient,recipient_reason:'This observation made me think of '+recipient+'.',text:'合成分享：我刚读到潮汐时间里一个很小的变化。'}}];},
  advance(){now+=31*60000;},night(){now=NIGHT;},onFriend(hook){friendHook=hook;},onExpression(hook){expressionHook=hook;},friends(value){friends=value;},fail(value){failTransport=value;},
  busy(scope){lastInbound.set(scope.address,now);},pauseContact(scope){contactPauses.add(scope.address);},
  pauseService(){pauseJobs.push(service.pause());},async paused(){await Promise.all(pauseJobs);},
  intents(){return life.db.prepare('SELECT * FROM life_share_intents ORDER BY created').all();},
  turns(){return service.engine.db.prepare("SELECT peer,event,state FROM turns WHERE role='assistant' AND event LIKE 'proactive:%'").all();},
  outgoing(){return service.cognition.store.db.prepare("SELECT scope,event,state FROM experiences WHERE role='assistant'").all();},
  async restart(){await life.close();await service.close();open();},
 };
}

for(const recipient of ['father','mother'])test(recipient+' receives a single exact private discovery without a reply lease, independent of a busy group',async t=>{
 const f=fixture(t),id=recipient==='father'?FATHER:MOTHER,scope=privateScope(id);
 await assert.rejects(()=>f.world.sendToTarget({kind:'private',id},{text:'ordinary reply without lease'}),/fresh message/);
 f.busy(conversationScope('group',GROUP));f.explore(recipient);
 const result=await f.life.tick();f.consumed();assert.equal(result.status,'sent');
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].target,{kind:'private',id});assert.equal(f.friendChecks,2);
 const intent=f.intents()[0];assert.equal(intent.recipient,recipient);assert.equal(intent.target_id,id);assert.equal(intent.state,'sent');
 assert.equal(JSON.parse(intent.receipt).scope,scope.address);
 assert.deepEqual(f.turns().map(turn=>({peer:turn.peer,state:turn.state})),[{peer:scope.address,state:'sent'}]);
 const memory=f.outgoing().filter(row=>row.event===JSON.parse(intent.receipt).event);
 assert.equal(memory.length,1);assert.equal(memory[0].scope,scope.address);assert.equal(memory[0].state,'sent');
 const other=f.life.audience(recipient==='father'?'mother':'father','A stale attempt to broadcast');
 assert.equal(f.life.continuity.queue(intent.activity,intent.evidence,'Do not broadcast',other).id,intent.id);
 assert.throws(()=>f.life.continuity.reconsider(intent.id,{decision:'share',reason:'Do not redirect sent work',...other},[{id:intent.id}]),/pending discovery/);
 f.advance();f.plan(req=>{assert.equal(initial(req).pending_discoveries.length,0);return quiet;});
 await f.life.tick();f.consumed();assert.equal(f.calls.length,1);assert.equal(f.intents().length,1);
});

test('ordinary service has no implicit initiation grant; internal life guard accepts a verified current friend',async t=>{
 const f=fixture(t),scope=privateScope(OTHER);let callback=0;
 await assert.rejects(()=>f.service.initiate(scope,'proactive:nonparent','A synthetic message',{purpose:'life-share',trackedTransport:true,send:async()=>callback++}),/Invalid initiation/);
 await sendLifeQQDelivery(f.world,{kind:'private',id:OTHER},'A synthetic message');
 assert.equal(callback,0);assert.equal(f.calls.length,1);assert.equal(f.turns().length,0);
});

for(const change of ['friend-revoked','night','paused','inbound-revision','contact-pause'])test(change+' during async friend lookup defers intent and turn with zero transport attempts',async t=>{
 const f=fixture(t),scope=privateScope(FATHER);
 f.onFriend(async()=>{
  await Promise.resolve();
  if(change==='friend-revoked')f.friends([MOTHER]);
  if(change==='night')f.night();
  if(change==='paused')f.pauseService();
  if(change==='inbound-revision')f.service.engine.invalidate(scope.address);
  if(change==='contact-pause')f.pauseContact(scope);
 });
 f.explore('father');const result=await f.life.tick();f.consumed();await f.paused();
 assert.equal(result.status,'saved-share-deferred');assert.equal(f.friendChecks,2);assert.equal(f.calls.length,0);
 assert.equal(f.intents().length,1);assert.equal(f.intents()[0].state,'queued');
 assert.deepEqual(f.turns().map(turn=>({peer:turn.peer,state:turn.state})),[{peer:scope.address,state:'deferred'}]);
 assert.equal(f.life.db.prepare('SELECT state FROM activity_shares').get().state,'deferred');
 assert.equal(f.outgoing().filter(row=>row.event.startsWith('proactive:')).length,0,'A deferred message must not become sent memory');
});

test('a true transport failure is uncertain in intent and turn, and persistent restart cannot retry or redirect it',async t=>{
 const f=fixture(t);f.fail(true);f.explore('mother');const result=await f.life.tick();f.consumed();
 assert.equal(result.status,'uncertain-no-retry');assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].target,{kind:'private',id:MOTHER});
 const intent=f.intents()[0];assert.equal(intent.state,'uncertain');assert.equal(f.turns()[0].state,'uncertain');
 assert.equal(f.outgoing().filter(row=>row.event.startsWith('proactive:')&&row.state==='sent').length,0);
 await f.restart();f.advance();f.fail(false);f.plan(req=>{assert.equal(initial(req).pending_discoveries.length,0);return quiet;});
 await f.life.tick();f.consumed();assert.equal(f.calls.length,1);assert.equal(f.intents()[0].state,'uncertain');
 assert.throws(()=>f.life.continuity.reconsider(intent.id,{decision:'share',reason:'A stale redirect',...f.life.audience('father','Not allowed after an uncertain attempt')},[{id:intent.id}]),/pending discovery/);
});

test('a persisted legacy family intent binds its null target to the exact watched family group and sends once',async t=>{
 const f=fixture(t),id='legacy-family-activity';
 f.life.db.prepare("INSERT INTO activities (id,topic,motivation,state,summary,created,updated) VALUES(?,?,?,'completed',?,?,?)")
  .run(id,'Legacy public fixture','A preserved curiosity','A saved source summary',DAY,DAY);
 const evidence=f.service.cognition.store.recordMessage({scope:'unknown',event:'legacy-source',role:'self',text:'An actual saved public fixture observation.',at:DAY,source:'public-exploration'});
 const queued=f.life.continuity.queue(id,evidence.id,'合成旧分享：想把这个小发现留给家人。');assert.equal(queued.target_id,null);
 await f.restart();f.plan(req=>{assert.equal(initial(req).pending_discoveries[0].target_id,null);return {name:'reconsider_discovery',args:{id:queued.id,decision:'share',reason:'This old discovery is still worth telling the family.'}};});
 const result=await f.life.tick();f.consumed();assert.equal(result.status,'sent');assert.equal(f.calls.length,1);
 assert.deepEqual(f.calls[0].target,{kind:'group',id:GROUP});const stored=f.intents()[0];
 assert.equal(stored.recipient,'family');assert.equal(stored.target_kind,'group');assert.equal(stored.target_id,GROUP);assert.equal(stored.state,'sent');
 assert.equal(JSON.parse(stored.receipt).scope,'group:'+GROUP);assert.equal(f.outgoing().filter(row=>row.event===JSON.parse(stored.receipt).event)[0].scope,'group:'+GROUP);
 assert.equal(f.friendChecks,1);
});

test('reach_out_from_life privately talks to Mom from her actual words and an own saved project, without fabricating a public exploration',async t=>{
 const f=fixture(t),store=f.service.cognition.store;
 const mother=store.recordMessage({scope:'private:'+MOTHER,event:'synthetic-mother-card',role:'user',senderId:MOTHER,at:DAY-3600000,source:'live-transport',
  text:JSON.stringify({transport:{conversation:'private:'+MOTHER,sender_id:MOTHER,message_id:'970001',time:(DAY-3600000)/1000},body:'合成妈妈原话：我喜欢那个蓝色的小按钮。'})});
 const own=store.recordMessage({scope:'unknown',event:'synthetic-own-card-v2',role:'self',at:DAY-1800000,source:'own-workroom-change',
  text:'A real stored fixture receipt: my little card version 2 has a blue button; saved only, not execution verified.',metadata:{project_id:'fixture-card',version:2,execution_verified:false}});
 f.plan({name:'reach_out_from_life',args:{recipient:'mother',reason:'Her actual remark reminded me of my own small card.',
  evidence_ids:[mother.id,own.id],text:'妈妈，你提到那个蓝色小按钮，我又想到自己的小卡片了。想把旁边那行字也改得轻一点。'}});
 const result=await f.life.tick();f.consumed();assert.equal(result.status,'sent');
 assert.equal(f.requests.length,1);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].target,{kind:'private',id:MOTHER});
 assert.equal(f.life.db.prepare('SELECT count(*) n FROM discoveries').get().n,0,'No fetch/save_discovery path should be invented for personal contact');
 const intent=f.intents()[0],contact=JSON.parse(store.get({id:intent.evidence,maxChars:12000}).text);
 assert.equal(contact.kind,'contact-intention');assert.equal(contact.source_refs.find(ref=>ref.id===mother.id).author.id,MOTHER);
 assert.equal(contact.source_refs.find(ref=>ref.id===own.id).role,'self');
 assert.equal(intent.recipient,'mother');assert.equal(intent.state,'sent');assert.equal(JSON.parse(intent.receipt).scope,'private:'+MOTHER);
 assert.equal(f.outgoing().find(row=>row.event===JSON.parse(intent.receipt).event).scope,'private:'+MOTHER);
});

test('a stale queued father snapshot uses the deliberately retargeted mother context and destination exactly once',async t=>{
 const f=fixture(t);f.busy(privateScope(FATHER));f.explore('father');
 assert.equal((await f.life.tick()).status,'saved-share-deferred');f.consumed();
 const stale=f.intents()[0];assert.equal(stale.recipient,'father');assert.equal(f.calls.length,0);
 f.advance();
 const retargeted=f.life.continuity.reconsider(stale.id,{decision:'share',reason:'I deliberately want to tell Mom now.',
  ...f.life.audience('mother','This particular detail makes me think of Mom.')},f.life.continuity.pending());
 for(const [id,text] of [[FATHER,'FATHER_CONTEXT_ONLY'],[MOTHER,'MOTHER_CONTEXT_ONLY']]){
  f.service.engine.db.prepare("INSERT INTO turns VALUES(?,?,'user',?,?,'completed')")
   .run('private:'+id,'fixture-context-'+id,JSON.stringify({transport:{sender_id:id},body:text}),DAY-3600000);
 }
 const result=await f.life.deliver(stale,privateScope(FATHER),new AbortController().signal);
 assert.equal(result.status,'sent');assert.equal(f.expressions.length,1);
 const expression=initial(f.expressions[0]);assert.equal(expression.recipient,'mother');
 assert.ok(expression.recipient_context.some(row=>row.text==='MOTHER_CONTEXT_ONLY'));
 assert.ok(!expression.recipient_context.some(row=>row.text==='FATHER_CONTEXT_ONLY'));
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].target,{kind:'private',id:MOTHER});
 const stored=f.intents()[0];assert.equal(stored.state,'sent');assert.equal(stored.recipient,'mother');
 assert.ok(stored.revision>retargeted.revision);assert.equal(JSON.parse(stored.receipt).scope,'private:'+MOTHER);
 assert.equal((await f.life.deliver(stale,privateScope(FATHER),new AbortController().signal)).status,'not-pending-no-send');
 assert.equal(f.calls.length,1);assert.equal(f.expressions.length,1);
});

test('a stale expression cannot reset a concurrently sending intent or create a second delivery',async t=>{
 const f=fixture(t);f.busy(privateScope(FATHER));f.explore('father');
 assert.equal((await f.life.tick()).status,'saved-share-deferred');f.consumed();f.advance();
 const stale=f.intents()[0];let releaseFirst,enteredFirst,releaseTransport,enteredTransport,composition=0;
 const firstWaiting=new Promise(resolve=>enteredFirst=resolve),firstGate=new Promise(resolve=>releaseFirst=resolve);
 const transportWaiting=new Promise(resolve=>enteredTransport=resolve),transportGate=new Promise(resolve=>releaseTransport=resolve);
 f.onExpression(async()=>{if(++composition===1){enteredFirst();await firstGate;}});
 f.onFriend(async()=>{enteredTransport();await transportGate;});
 let first,second;
 try{
  first=f.life.deliver(stale,privateScope(FATHER),new AbortController().signal);await firstWaiting;
  second=f.life.deliver(stale,privateScope(FATHER),new AbortController().signal);await transportWaiting;
  const sending=f.intents()[0];assert.equal(sending.state,'sending');assert.ok(sending.attempt);assert.equal(f.calls.length,0);
  releaseFirst();assert.equal((await first).status,'saved-share-deferred');
  const afterConflict=f.intents()[0];assert.equal(afterConflict.state,'sending');assert.equal(afterConflict.attempt,sending.attempt);
  assert.equal(afterConflict.revision,sending.revision);assert.equal(afterConflict.reason,sending.reason);
  releaseTransport();assert.equal((await second).status,'sent');
  assert.equal(f.calls.length,1);assert.equal(f.expressions.length,2);assert.equal(f.intents()[0].state,'sent');
  assert.equal(f.intents()[0].attempt,sending.attempt);
  assert.deepEqual(f.life.db.prepare('SELECT state FROM activity_shares').all().map(row=>row.state),['sent']);
  assert.deepEqual(f.turns().map(row=>row.state),['sent']);
  assert.equal((await f.life.deliver(stale,privateScope(FATHER),new AbortController().signal)).status,'not-pending-no-send');
  assert.equal(f.calls.length,1);
 }finally{releaseFirst();releaseTransport();await Promise.allSettled([first,second].filter(Boolean));}
});

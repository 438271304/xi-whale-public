import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CuriosityLife} from './curiosity-life.mjs';
import {ConversationService} from './conversation-service.mjs';
import {conversationScope} from './conversation-scope.mjs';
import {guardQQWorld,sendLifeQQDelivery} from './qq-event-policy.mjs';
import {lifeSocialTargets} from './life-social-targets.mjs';
import {ProactiveAvailability} from './proactive-availability.mjs';

// Real life/service/guard/SQLite, synthetic public reader, client and driver.
// Nothing is connected to a real model, QQ instance, account or remote website.
const BOT='910610001',FATHER='910610002',MOTHER='910610003',OTHER='910610004',GROUP='910620001',GROUP2='910620002',PEER='910610005';
const DAY=Date.parse('2036-10-17T12:00:00+08:00'),NIGHT=Date.parse('2036-10-18T00:01:00+08:00');
const privateScope=id=>conversationScope('private',id);
const initial=req=>JSON.parse(req.input.find(item=>item.role==='user').content);
const quiet={name:'keep_quiet',args:{}};
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'whale-family-delivery-'));
 let now=DAY,steps=[],sequence=0,friends=[FATHER,MOTHER,OTHER,PEER],friendHook=null,expressionHook=null,failTransport=false;
 let watched={groups:[Number(GROUP),Number(GROUP2)],users:[]},friendChecks=0,service,life;
 const calls=[],requests=[],expressions=[],lastInbound=new Map(),pauseJobs=[];
 const policy={bot_id:BOT,group_id:GROUP,group_ids:[GROUP],father_id:FATHER,mother_id:MOTHER,friend_private_enabled:true,follow_configured_groups:true,peer_bot_ids:[PEER],peer_bot_max_turns:6,peer_bot_window_minutes:10};
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
   return {response:{id:'synthetic-share-'+(++sequence),status:'completed',output:[{type:'function_call',name:'finish_life_share',call_id:'share-'+sequence,arguments:JSON.stringify({decision:'share',text:initial(req).draft??'我刚想到你，来打个招呼。',reason:'Preserve the fixture draft for transport assertions.'})}]},attempts:[]};
  }
  requests.push(req);assert.ok(steps.length,'Unexpected model step');const next=steps.shift(),action=typeof next==='function'?next(req):next;
  return {response:{id:'synthetic-life-'+(++sequence),status:'completed',output:[{type:'function_call',name:action.name,call_id:'call-'+sequence,arguments:JSON.stringify(action.args)}]},attempts:[]};
 }};
 const tools=[{name:'public_fetch',description:'Read a synthetic public source; no network.',parameters:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false},
  handler:()=>JSON.stringify({status:'ok',sources:[{url:'https://example.org/family-discovery',title:'Synthetic tide observation',excerpt:'A genuinely returned fixture explanation of tidal timing.'}],retrieved_at:new Date(now).toISOString()})}];
 function open(){
  service=new ConversationService({root:join(root,'conversation'),client,publicProfile:'Synthetic identity. Source-aware natural conversation.',botId:BOT,guardianIds:[FATHER,MOTHER],peerBots:[PEER],isAllowed:()=>true,canInitiateTo:async(scope,{signal})=>{await lifeSocialTargets(world,policy).authorize(scope,{signal});return true;},wait:async()=>{},send:args=>world.sendToTarget(args.target,{text:args.text})});
  social.availability=new ProactiveAvailability(service.engine.db,{guardianIds:[FATHER,MOTHER],clock:()=>now});service.social=social;
  life=new CuriosityLife({path:join(root,'life.sqlite3'),service,social,world,policy,client,clock:()=>now,topics:()=>[],tools});life.resume();
 }
 open();t.after(async()=>{await life.close();await service.close();await Promise.allSettled(pauseJobs);});
 return {root,world,policy,social,calls,requests,expressions,get service(){return service;},get life(){return life;},get friendChecks(){return friendChecks;},groups(value){watched.groups=value.map(Number);},get now(){return now;},setNow(value){now=value;},
  plan(...next){steps=next;},consumed(){assert.equal(steps.length,0,'Every scripted decision should execute');},
  explore(recipient){steps=[{name:'choose_activity',args:{topic:'Tidal timing',why:'A real fixture detail caught my attention.'}},
   {name:'public_fetch',args:{url:'https://example.org/family-discovery'}},{name:'save_discovery',args:{summary:'The returned fixture explains a tidal timing detail.'}},
   {name:'share_discovery',args:{recipient,recipient_reason:'This observation made me think of '+recipient+'.',text:'合成分享：我刚读到潮汐时间里一个很小的变化。'}}];},
  advance(){now+=31*60000;},night(){now=NIGHT;},onFriend(hook){friendHook=hook;},onExpression(hook){expressionHook=hook;},friends(value){friends=value;},fail(value){failTransport=value;},
  busy(scope){lastInbound.set(scope.address,now);},pauseContact(scope){social.availability.observe({post_type:'message',message_type:'private',sub_type:'friend',user_id:Number(scope.id),sender:{user_id:Number(scope.id)},message_id:99101,time:now/1000,message:[{type:'text',data:{text:'先别主动找我'}}]},{admittedFriend:true});},
  pauseService(){pauseJobs.push(service.pause());},async paused(){await Promise.all(pauseJobs);},
  intents(){return life.db.prepare('SELECT * FROM life_share_intents ORDER BY created').all();},
  turns(){return service.engine.db.prepare("SELECT peer,event,state FROM turns WHERE role='assistant' AND event LIKE 'proactive:%'").all();},
  outgoing(){return service.cognition.store.db.prepare("SELECT scope,event,state FROM experiences WHERE role='assistant'").all();},
  async restart(){await life.close();await service.close();open();},
 };
}

for(const [recipient,kind,id] of [['group:'+GROUP2,'group',GROUP2],['private:'+OTHER,'private',OTHER]])test('listed '+kind+' completes one actual intent/expression/receipt with the canonical destination',async t=>{
 const f=fixture(t);f.explore(recipient);const outcome=await f.life.tick();f.consumed();assert.equal(outcome.status,'sent');
 const intent=f.intents()[0],receipt=JSON.parse(intent.receipt);assert.equal(intent.recipient,recipient);assert.equal(intent.target_kind,kind);assert.equal(intent.target_id,id);
 assert.deepEqual(receipt.target,{kind,id});assert.equal(receipt.scope,kind+':'+id);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].target,{kind,id});
 assert.equal(initial(f.expressions[0]).target.id,id);assert.equal(f.outgoing().filter(r=>r.scope===kind+':'+id&&r.state==='sent').length,1);
 const offered=initial(f.requests[0]).sharing_audiences;assert.ok(offered.some(row=>row.recipient===recipient&&row.target_id===id));
 assert.throws(()=>f.life.continuity.reconsider(intent.id,{decision:'share',reason:'No second target',...f.life.audience('father','A stale redirect')},[{id:intent.id}]),/pending/);
 f.advance();f.plan(quiet);await f.life.tick();assert.equal(f.calls.length,1);
});

test('model cannot select a fabricated number or a newly appearing unoffered contact',async t=>{
 for(const newlyEnabled of [false,true]){
  const f=fixture(t);if(newlyEnabled)f.groups([GROUP]);
  f.plan(req=>{if(newlyEnabled)f.groups([GROUP,GROUP2]);return {name:'reach_out_from_life',args:{recipient:newlyEnabled?'group:'+GROUP2:'private:919999999',reason:'Not actually offered',text:'Must not send',evidence_ids:['exp-'+ '1'.repeat(32)]}};},quiet);
  await f.life.tick();assert.equal(f.calls.length,0);assert.equal(f.intents().length,0);
 }
});

test('a family alias cannot silently rebind to a different current friend while the model is deciding',async t=>{
 const f=fixture(t),source=f.service.cognition.store.recordMessage({scope:'unknown',event:'own-alias-source',role:'self',text:'A synthetic own observation.',at:f.now,source:'verified-workshop-result'});
 f.plan(req=>{assert.ok(initial(req).sharing_audiences.some(row=>row.recipient==='father'&&row.target_id===FATHER));f.policy.father_id=OTHER;return {name:'reach_out_from_life',args:{recipient:'father',reason:'I thought of the listed person',text:'Must not silently redirect',evidence_ids:[source.id]}};},quiet);
 await f.life.tick();assert.equal(f.calls.length,0);assert.equal(f.intents().length,0);
});

for(const change of ['removed-group','deleted-friend','night','route-pause','explicit-friend-pause','group-listen'])test(change+' before transport preserves a queued intention and makes no external attempt',async t=>{
 const f=fixture(t),group=['removed-group','group-listen'].includes(change),scope=conversationScope(group?'group':'private',group?GROUP2:OTHER);
 f.onExpression(async()=>{
  if(change==='removed-group')f.groups([GROUP]);
  if(change==='deleted-friend')f.friends([FATHER,MOTHER]);
  if(change==='night')f.night();
  if(change==='route-pause')f.pauseService();
  if(change==='explicit-friend-pause')f.pauseContact(scope);
  if(change==='group-listen')f.service.socialIntent({post_type:'message',message_type:'group',group_id:Number(GROUP2),user_id:Number(OTHER),sender:{user_id:Number(OTHER)},message_id:921001,time:f.now/1000,message:[{type:'at',data:{qq:BOT}},{type:'text',data:{text:'先旁听吧'}}]});
 });
 f.explore(scope.address);const outcome=await f.life.tick();await f.paused();assert.equal(f.calls.length,0);assert.equal(f.intents().length,1);assert.equal(f.intents()[0].state,'queued');assert.ok(['saved-share-deferred'].includes(outcome.status));
});

test('roster change on the final asynchronous check prevents a stale verified friend from sending',async t=>{
 const f=fixture(t);let armed=false;
 f.onExpression(()=>{armed=true;});f.onFriend(async()=>{if(armed){armed=false;await Promise.resolve();f.friends([FATHER,MOTHER]);}});
 f.explore('private:'+OTHER);const result=await f.life.tick();assert.equal(result.status,'saved-share-deferred');assert.equal(f.calls.length,0);assert.equal(f.intents()[0].state,'queued');
});

test('a generic friend delivery with unknown transport outcome cannot retry or change destination after restart',async t=>{
 const f=fixture(t);f.fail(true);f.explore('private:'+OTHER);assert.equal((await f.life.tick()).status,'uncertain-no-retry');assert.equal(f.calls.length,1);
 const before=f.intents()[0];await f.restart();f.fail(false);f.advance();f.plan(req=>{assert.equal(initial(req).pending_discoveries.length,0);return quiet;});await f.life.tick();
 assert.equal(f.calls.length,1);assert.equal(f.intents()[0].state,'uncertain');assert.equal(f.intents()[0].target_id,OTHER);
 assert.throws(()=>f.life.continuity.reconsider(before.id,{decision:'share',reason:'No retry elsewhere',...f.life.audience('mother','Another audience')},[{id:before.id}]),/pending/);
});

test('changing a family alias cannot bypass unknown contact dedup for the same canonical destination and evidence',async t=>{
 const f=fixture(t),source=f.service.cognition.store.recordMessage({scope:'unknown',event:'own-dedup-source',role:'self',text:'A synthetic own experience.',at:f.now,source:'verified-workshop-result'});
 const contact=(recipient,text)=>({name:'reach_out_from_life',args:{recipient,reason:'This same real experience brought the person to mind',text,evidence_ids:[source.id]}});
 f.fail(true);f.plan(contact('father','First expression'));assert.equal((await f.life.tick()).status,'uncertain-no-retry');assert.equal(f.calls.length,1);
 f.policy.father_id=OTHER;f.fail(false);f.advance();f.plan(contact('private:'+FATHER,'A rewritten expression must not retry'));
 assert.equal((await f.life.tick()).status,'already-contacted-no-chase');assert.equal(f.calls.length,1);assert.equal(f.intents().length,1);assert.equal(f.intents()[0].state,'uncertain');
});

test('other-conversation words and source-derived draft are withheld from a new audience while a personal greeting remains possible',async t=>{
 const f=fixture(t),source=f.service.cognition.store.recordMessage({scope:'private:'+MOTHER,event:'synthetic-private-source',role:'user',senderId:MOTHER,text:JSON.stringify({body:'PRIVATE_FIXTURE_CONTENT_NOT_FOR_GROUP'}),at:f.now-1000,source:'qq-message'});
 f.plan({name:'reach_out_from_life',args:{recipient:'group:'+GROUP2,reason:'PRIVATE_FIXTURE_REASON',text:'PRIVATE_FIXTURE_DRAFT',evidence_ids:[source.id]}});
 const result=await f.life.tick();assert.equal(result.status,'sent');const input=initial(f.expressions[0]);assert.equal(input.withheld_source_count,1);assert.equal(input.draft,null);assert.doesNotMatch(JSON.stringify(input),/PRIVATE_FIXTURE/);assert.doesNotMatch(f.calls[0].text,/PRIVATE_FIXTURE/);assert.equal(f.calls[0].target.id,GROUP2);
});

test('registered peer private turns are finite, cannot renew themselves, and cannot wake the night; ordinary friends remain normal',async t=>{
 const f=fixture(t);let event=700;
 const message=(who,kind='private',group=GROUP2,mention=false)=>({post_type:'message',message_type:kind,sub_type:'friend',group_id:Number(group),user_id:Number(who),sender:{user_id:Number(who)},message_id:++event,time:f.now/1000,message:mention?[{type:'at',data:{qq:BOT}}]:[{type:'text',data:{text:'Synthetic finite peer turn'}}]});
 for(let i=0;i<6;i++)assert.equal((await f.world.handleEvent(message(PEER))).accepted,true);
 assert.equal((await f.world.handleEvent(message(PEER))).reason,'peer-bot-conversation-limit');f.setNow(f.now+11*60000);assert.equal((await f.world.handleEvent(message(PEER))).reason,'peer-bot-conversation-limit');
 await sendLifeQQDelivery(f.world,{kind:'private',id:PEER},'A separately chosen new bounded contact');assert.equal(f.calls.length,1);
 for(let i=0;i<6;i++)assert.equal((await f.world.handleEvent(message(PEER))).accepted,true);
 assert.equal((await f.world.handleEvent(message(PEER))).reason,'peer-bot-conversation-limit');
 assert.equal((await f.world.handleEvent(message(OTHER,'group'))).accepted,true);
 for(let i=0;i<6;i++)assert.equal((await f.world.handleEvent(message(PEER,'group'))).accepted,true);
 assert.equal((await f.world.handleEvent(message(PEER,'group'))).reason,'peer-bot-conversation-limit');
 f.night();assert.equal((await f.world.handleEvent(message(PEER))).reason,'peer-bot-resting');assert.equal((await f.world.handleEvent(message(OTHER))).accepted,true);assert.equal((await f.world.handleEvent(message(OTHER,'group',GROUP2,true))).accepted,true);
});


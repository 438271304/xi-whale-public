// Scoped adapter for the pinned QQWorld; guard admission precedes intake.
import {ConversationService} from './conversation-service.mjs';
import {guardQQWorld} from './qq-event-policy.mjs';
import {GroupBatch} from './group-batch.mjs';
import {transportMessage} from './group-message.mjs';
import {QQContext} from './qq-context.mjs';
import {join} from 'node:path';
import {SocialRhythm} from './social-rhythm.mjs';
import {CuriosityLife} from './curiosity-life.mjs';
import {publicExploration} from './public-exploration.mjs';
import {QQSelfProfile} from './qq-self-profile.mjs';
import {selfAvatarAdapter} from './qq-self-avatar.mjs';
import {ForwardIntake} from './forward-intake.mjs';
import {QQRecall} from './qq-recall.mjs';
import {QQVoice} from './qq-voice.mjs';
import {sendScopedReply} from './scoped-send.mjs';
import {QQSelfQZone} from './qq-self-qzone.mjs';
import {rememberQzonePublication} from './qzone-experiences.mjs';
import {selectBatchAnchor} from './conversation-focus.mjs';
export function isolatedQQRoute(world,{root,client,publicProfile,operatingContract,policy,ledger,ownsLedger=false,clock,attachments=async()=>[],imageAnalyzer,extraTools,startPaused=false,wait,batchOptions,socialTopics=()=>[],socialConfig}){
 if(world.host)throw Error('Install before world start');
 let service,generation=0,closed=false,closing=false,stopPromise;
 const context=new QQContext({path:join(root,'qq-context.sqlite3'),world,policy,clock:()=>clock?clock().getTime():Date.now()});
 const start=world.start,stop=world.stop;
 service=new ConversationService({root,client,publicProfile,operatingContract,peerBots:policy.peer_bot_ids??[],wait,extraTools,startPaused,botId:policy.bot_id,guardianIds:[policy.father_id,policy.mother_id].filter(Boolean),imageAnalyzer,
  isAllowed:async scope=>{
   if(scope.kind==='group')return world.getWatched().groups.map(String).includes(scope.id);
   if(!policy.friend_private_enabled)return false;
   try{const friends=await world.driver.callApi('get_friend_list',{});return Array.isArray(friends)&&friends.some(f=>String(f.user_id)===scope.id);}catch{return false;}
  },
  send:async({target,...expression})=>sendScopedReply(world,target,expression,policy.bot_id)
 });
 const selfProfile=new QQSelfProfile({path:join(root,'qq-self-profile.sqlite3'),avatars:selfAvatarAdapter({media:service.media}),driver:{callApi:(...args)=>{if(!world.driver)throw Error('Existing QQ driver not ready');return world.driver.callApi(...args);}},authorize:async()=>!service.paused&&!service.closed});
 service.selfProfile=selfProfile;
 service.selfQzone=new QQSelfQZone({path:join(root,'qzone.sqlite3'),driver:{callApi:(...args)=>{if(!world.driver)throw Error('Existing QQ driver not ready');return world.driver.callApi(...args);}},authorize:async()=>!service.paused&&!service.closed,onVerified:async receipt=>rememberQzonePublication(service.cognition,receipt)});
 service.qqVoice=new QQVoice({path:join(root,'qq-voice.sqlite3'),root:join(root,'qq-voice-jobs'),driver:{callApi:(...args)=>{if(!world.driver)throw Error('Existing QQ driver not ready');return world.driver.callApi(...args);}},service});
 service.forwardIntake=new ForwardIntake({path:join(root,'forwards.sqlite3'),driver:{callApi:(...args)=>{if(!world.driver)throw Error('Existing QQ driver not ready');return world.driver.callApi(...args);}},service,attachments});
 const social=new SocialRhythm({path:join(root,'social.sqlite3'),service,world,policy,topics:socialTopics,config:socialConfig,clock:()=>clock?clock().getTime():Date.now(),budgetAvailable:()=>client.canInitiate?.()===true});
 social.life=new CuriosityLife({path:join(root,'life.sqlite3'),service,social,world,policy,client,topics:socialTopics,tools:({signal})=>extraTools?.publicTools?.({signal})??publicExploration({client,signal}),homeTools:extraTools?.ownHomeTools?.()??[],creative:extraTools?.ownCreativeTools?{context:()=>extraTools.ownCreativeContext(),tools:context=>extraTools.ownCreativeTools(context)}:null,clock:()=>clock?clock().getTime():Date.now()});
 service.social=social;service.peerBots=policy.peer_bot_ids??[];
 if(!startPaused)social.resume();
 // Admission guard is installed outside this route, so rejected events never reach the model.
 const preparations=new Map(),revisions=new WeakMap();
 const batch=new GroupBatch(async messages=>{
  const admittedGeneration=generation;
  const last=messages.at(-1),key=last.message_type==='group'?'group:'+last.group_id:'private:'+last.user_id;
  // Serialize intake/attachments per chat, but let the engine coalesce queued generations.
  const setup=(preparations.get(key)??Promise.resolve()).catch(()=>{}).then(async()=>{
   if(admittedGeneration!==generation)return {completion:{status:'cancelled-before-intake'}};
   const scope=service.scope(key),groupContext=await context.group(scope),selection=selectBatchAnchor({scope,botId:policy.bot_id,peerBots:policy.peer_bot_ids??[],messages,recent:service.recentTransport(scope),structuredFor:m=>transportMessage(m,{scope,botId:String(policy.bot_id),resolveReply:id=>service.resolveReply(scope,id)})}),standalone=new Set(selection.earlier_direct.filter(x=>x.disposition==='standalone').map(x=>x.message)),batchRevision=service.engine.revisions.get(scope.address),outcomes=[];let remaining=4;
   for(const message of messages){
    for(const quote of message.message.filter(s=>s.type==='reply').slice(0,2)){
     const id=String(quote.data?.id??'');if(!/^-?\d{1,20}$/.test(id)||service.resolveReply(scope,id))continue;
     try{const original=await world.driver.callApi('get_msg',{message_id:Number(id)},8000);const same=scope.kind==='group'?original.message_type==='group'&&String(original.group_id)===scope.id:original.message_type==='private'&&String(original.user_id)===scope.id;
      if(same&&String(original.message_id)===id&&Number.isSafeInteger(original.message_id)&&Array.isArray(original.message)&&Number.isFinite(original.time)){const text=JSON.stringify(transportMessage(original,{scope,botId:String(policy.bot_id)}));service.history.insert(scope,id,text,new Date(original.time*1000).toISOString(),'referenced-qq-api');service.cognition.store.recordMessage({scope,event:id,role:'user',text,at:original.time*1000,senderId:String(original.user_id),source:'referenced-qq-api'});}
     }catch{}
    }
    const loaded=remaining>0?await attachments(message,{limit:remaining}):[];
    const bytes=loaded.slice(0,remaining),intake=loaded.intake?[...loaded.intake]:[];
    if(loaded.length>bytes.length)intake.push({state:'not-received',reason:'batch-image-limit',count:loaded.length-bytes.length});
    if(remaining===0&&message.message?.some(s=>['image','mface','bface','sface'].includes(s.type)))intake.push({state:'not-received',reason:'batch-image-limit'});
    remaining-=bytes.length;
    if(admittedGeneration!==generation)return {completion:{status:'cancelled-before-intake'}};
    const generate=message===last||standalone.has(message);
    const outcome=await service.receiveAdmitted(message,bytes,{listenOnly:!generate,groupContext,intake,revision:batchRevision,batchSelection:{selected_event:String(message.message_id),tail_event:String(last.message_id),disposition:message===last?'tail':'standalone-direct',batch_events:messages.map(m=>String(m.message_id))}});
    if(generate)outcomes.push(outcome);
   }
   return {completion:Promise.resolve(outcomes.find(x=>x.status==='sent')??outcomes.at(-1)??{status:'quiet'})};
  });
  preparations.set(key,setup);
  try{
   return await (await setup).completion;
  }
  catch{return {status:'route-failed-no-retry'};}
  finally{if(preparations.get(key)===setup)preparations.delete(key);}
 },batchOptions??{delayMs:message=>message.message.some(s=>s.type==='at'&&String(s.data?.qq)===String(policy.bot_id))?700:1800,maxWaitMs:5000});
 world.handleEvent=async message=>{
  if(message.post_type!=='message')return {status:'nonmessage-not-routed'};
  if(service.paused||service.closed)return {status:'paused-or-closed'};
  context.remember(message);
  social.noteInbound(message);
  try{revisions.set(message,service.noteArrival(message));}catch{return {status:'invalid-source'};}
  return batch.receive(message);
 };
 guardQQWorld(world,policy,clock,ledger);
 const guardedMessages=world.handleEvent,notices=new Set(),recalls=new QQRecall({service,world,policy});
 world.handleEvent=async message=>{
  if(message.post_type!=='notice')return guardedMessages.call(world,message);
  if(service.paused||service.closed)return {status:'paused-or-closed'};
  const job=(async()=>{const recall=await recalls.receive(message);if(recall)return recall;const notice=await context.poke(message);if(!notice||notice.status!=='accepted-notice')return notice??{status:'unsupported-notice'};
   return service.hearNotice(notice.scope,notice.key,notice.text);})();notices.add(job);try{return await job;}finally{notices.delete(job);}
 };
 world.tools=()=>[]; // The shared persona cannot send to or inspect these conversation tools.
 world.start=async function(host){
  const scopedHost=new Proxy(host,{get(target,key){
   if(key==='pushEvent')return async event=>{
    if(event.source!=='qq')throw Error('Unexpected source on QQ-only host');
    // QQWorld emits qq.self after sending: index locally, never append to shared core.
    service.history.importEvent({...event,origin:'external'},'isolated-qq-outgoing');
    if(event.type==='qq.self'&&event.meta?.conv&&Number.isSafeInteger(event.meta.message_id)&&typeof event.text==='string')service.cognition.store.recordMessage({scope:event.meta.conv,event:String(event.meta.message_id),role:'assistant',text:event.text,at:event.ts,senderId:String(policy.bot_id),source:'acknowledged-qq-outgoing',state:'sent'});
    return {...event,origin:'external'};
   };
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  return start.call(this,scopedHost);
 };
 world.stop=function(){
  if(stopPromise)return stopPromise;closing=true;generation++;batch.cancel();
  stopPromise=(async()=>{const failures=[];
   for(const close of [()=>social.close(),()=>service.close(),()=>selfProfile.close(),()=>batch.close(),()=>Promise.allSettled([...notices]),()=>context.close(),()=>stop.call(world),()=>ownsLedger?ledger.close():undefined])try{await close();}catch(error){failures.push(error);}
   closed=true;if(failures.length)throw new AggregateError(failures,'Isolated QQ cleanup failed');
  })();return stopPromise;
 };
 // Core pause/resume must explicitly forward these before production activation.
 const capabilityStatus=()=>{
  const now=clock?clock().getTime():Date.now(),life=social.life;
  const connected=(configured,autonomous)=>({configured,available:configured&&typeof world.driver?.callApi==='function',autonomous,blocker:configured?null:'adapter-not-connected'});
  let extra={};try{extra=extraTools?.capabilityStatus?.()??{};}catch{}
  const items={...extra,
   public_web:extra.public_web??{configured:true,available:null,autonomous:!!life,blocker:null},
   qzone_read:connected(typeof service.selfQzone?.readOwn==='function',!!life?.ownCorner),
   qzone_publish:connected(typeof service.selfQzone?.publish==='function',typeof life?.heartbeat?.publish==='function'),
   proactive_faces:connected(typeof life?.shareMedia?.revalidate==='function',!!life?.shareComposer),
   proactive_images:connected(typeof life?.shareMedia?.revalidate==='function'&&!!service.media,!!life?.shareComposer),
   own_profile:connected(typeof service.selfProfile?.tools==='function',!!life?.ownProfile),
   qq_voice:service.qqVoice.capabilities(),
  };
  for(const item of Object.values(items)){
   if(!life||life.closed)item.autonomous=false;
   if(service.closed||closed){item.available=false;item.blocker='service-closed';}
   else if(service.paused){item.available=false;item.blocker='service-paused';}
  }
  return {observed_at:now,items};
 };
 return {world,service,social,context,capabilityStatus,get closed(){return closed;},pause:async()=>{if(closing){await stopPromise;return;}generation++;batch.cancel();const paused=service.pause();await social.pause();await paused;},resume:()=>{if(closing)return;service.resume();social.resume();}};
}

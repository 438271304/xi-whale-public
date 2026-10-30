import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {UnifiedCognition} from './cognition-tools.mjs';
import {LifeContinuity} from './life-continuity.mjs';
import {queueLifeContact} from './life-contact.mjs';
import {LifeShareComposer} from './life-share-compose.mjs';
import {LifeShareMedia} from './life-share-media.mjs';
import {ScopedMedia} from './scoped-media.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// All identities and records are synthetic. All three databases are in memory;
// no provider, transport, production data, network or file fixtures are used.
const SELF='910910001',FATHER='910910002',MOTHER='910910003';
const NOW=Date.parse('2036-10-17T12:00:00+08:00');
const target={recipient:'father',target_kind:'private',target_id:FATHER,recipient_reason:'One actual observation made me think of Dad.'};
const scope={kind:'private',id:FATHER,address:'private:'+FATHER};
const audience={unanswered_count:2,recent_feedback:[{event:'feedback-1',role:'user',text:'Please explain the small practical point.',at:NOW-1000}],preferences:{plain_language:true}};
const finish=(decision='share',text='One small, sourced observation.',reason='This is the one point I want to bring back.')=>({name:'finish_life_share',args:{decision,reason,...(text===undefined?{}:{text})}});
const initial=req=>JSON.parse(req.input.find(item=>item.role==='user').content);

function fixture(t,{withMedia=false}={}){
 const cognition=new UnifiedCognition('unused-in-memory-fixture',{path:':memory:',clock:()=>NOW,botId:SELF,guardianIds:[FATHER,MOTHER]});
 const db=new DatabaseSync(':memory:'),conversationDb=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE activities(id TEXT PRIMARY KEY,topic TEXT,motivation TEXT,state TEXT,summary TEXT,created INTEGER,updated INTEGER); CREATE TABLE discoveries(id TEXT,activity TEXT,url TEXT,title TEXT,excerpt TEXT,at INTEGER)');
 conversationDb.exec('CREATE TABLE turns(peer TEXT,event TEXT,role TEXT,text TEXT,at INTEGER,state TEXT,PRIMARY KEY(peer,event,role))');
 const continuity=new LifeContinuity(db,{clock:()=>NOW}),requests=[];let sequence=0,steps=[];
 const client={respond:async(req,options)=>{
  requests.push(structuredClone(req));assert.ok(steps.length,'No unplanned provider call is permitted');
  const action=steps.shift(),result=typeof action==='function'?await action(req,options):action;
  const output=result?.output??[{type:'function_call',name:result.name,call_id:'synthetic-call-'+(++sequence),arguments:JSON.stringify(result.args)}];
  return {response:{id:'synthetic-response-'+(++sequence),status:'completed',output},attempts:[]};
 }};
 const mediaStore=withMedia?new ScopedMedia(':memory:'):null;
 const media=withMedia?new LifeShareMedia({service:{botId:SELF,media:mediaStore,paused:false,closed:false,stickers:{sourceForImage:()=>null}}}):null;
 const dependencies={db,store:cognition.store,journal:cognition.journal,conversationDb,client,profile:'Synthetic personal identity.',clock:()=>NOW,...(media?{media}:{})};
 const composer=new LifeShareComposer(dependencies);
 t.after(()=>{mediaStore?.close();conversationDb.close();db.close();cognition.close();});
 const record=(event,text,{role='self',address='unknown',senderId=null,source='public-exploration',revisionKind='observation',at=NOW-60000}={})=>cognition.store.recordMessage({scope:address,event,role,senderId,text:typeof text==='string'?text:JSON.stringify(text),source,revisionKind,at});
 const activity=()=>{const id='fixture-activity-'+(++sequence);db.prepare("INSERT INTO activities VALUES(?,NULL,NULL,'planning','',?,?)").run(id,NOW,NOW);return id;};
 const discovery=({summary='A stored public observation.',sources=[{url:'https://example.org/source',title:'Synthetic source',level:'text-read'}],...extra}={})=>{
  const source=record('discovery-'+(++sequence),{summary,sources,...extra});
  return {source,intent:continuity.queue(activity(),source.id,'A preliminary private draft.',target)};
 };
 return {cognition,db,conversationDb,composer,dependencies,continuity,requests,record,discovery,media,mediaStore,
  publicImage(){return mediaStore.importApprovedSeed(readFileSync(new URL('./assets/stickers/deepseek-bixin.png',import.meta.url)),'Existing approved public fixture').id;},
  plan(...actions){steps.push(...actions);},consumed(){assert.equal(steps.length,0);},
  run(intent,options={}){return composer.compose({intent,scope,audience,...options});},
  saved(){return db.prepare('SELECT * FROM life_share_expression ORDER BY rowid').all();},
  human(event,text,options={}){return record(event,{transport:{sender_id:FATHER,conversation:scope.address,time:(NOW-60000)/1000},body:text},{role:'user',address:scope.address,senderId:FATHER,source:'live-transport',...options});},
  contact(ids){return queueLifeContact({db,continuity,store:cognition.store,activity:activity(),audience:target,text:'My own interpretation, not Dad\'s words.',reason:'That dated source brought one thought to mind.',evidenceIds:ids,clock:()=>NOW}).intent;},
  conversation(event,text,{peer=scope.address,role='user',state='completed',at=NOW-1000}={}){conversationDb.prepare('INSERT INTO turns VALUES(?,?,?,?,?,?)').run(peer,event,role,typeof text==='string'?text:JSON.stringify(text),at,state);},
 };
}

test('one independent expression generation exposes only finish, preserves identity, and saves a decision without sending',async t=>{
 const f=fixture(t),{intent}=f.discovery(),before=f.cognition.store.counts();
 f.plan(req=>{
  assert.deepEqual(req.tools.map(tool=>tool.name),['finish_life_share']);
  assert.deepEqual(req.tools[0].parameters.required,['decision','reason']);
  assert.equal(req.tools[0].parameters.additionalProperties,false);
  assert.ok(req.instructions.startsWith('Synthetic personal identity.'));
  assert.equal(req.input.length,1);
  assert.equal(initial(req).recipient,'father');
  return finish('share','  A complete little thought.  ');
 });
 const result=await f.run(intent);f.consumed();assert.equal(f.requests.length,1);
 assert.equal(result.decision,'share');assert.equal(result.text,'A complete little thought.');
 const row=f.saved()[0];assert.equal(row.state,'prepared');assert.equal(row.id,result.expression_id);
 assert.equal(JSON.parse(row.result).text,result.text);assert.equal(row.intent,intent.id);
 assert.deepEqual(f.cognition.store.counts(),before,'Preparing expression must not manufacture sent experience');
 assert.equal(f.continuity.get(intent.id).state,'queued');
 assert.equal(f.conversationDb.prepare('SELECT count(*) n FROM turns').get().n,0);
});

test('input contains bounded source excerpts and only recent inbound or acknowledged outgoing context from the actual recipient',t=>{
 const f=fixture(t),sources=Array.from({length:5},(_,i)=>({url:'https://example.org/'+i,title:'source '+i,level:'excerpt',transcript:'DO_NOT_COPY_SOURCE_TRANSCRIPT'}));
 const {intent,source}=f.discovery({summary:'S'.repeat(1200),sources,research_trace:'DO_NOT_COPY_RESEARCH_TRACE'});
 for(let i=0;i<12;i++)f.conversation('context-'+i,{transport:{sender_id:FATHER},body:'C'.repeat(400)},{at:NOW-20000+i});
 f.conversation('proactive:earlier','A previously sent observation.',{role:'assistant',state:'sent',at:NOW-10});
 for(const state of ['uncertain','deferred','failed'])f.conversation('excluded-'+state,'DO_NOT_COPY_'+state,{role:'assistant',state,at:NOW-2});
 f.conversation('other-person','DO_NOT_COPY_OTHER_CONVERSATION',{peer:'private:'+MOTHER,at:NOW-1});
 const input=f.composer.input({intent,scope,audience});
 assert.equal(input.evidence[0].id,source.id);assert.equal(input.evidence[0].revision,source.revision);
 assert.equal(input.evidence[0].summary,'S'.repeat(900));assert.equal(input.evidence[0].sources.length,3);
 assert.equal(input.recipient_context.length,8);assert.equal(input.recipient_context[0].event,'context-5');
 assert.ok(input.recipient_context.every(item=>item.text.length<=240));
 assert.deepEqual(input.recipient_context.at(-1),{event:'proactive:earlier',role:'assistant',at:NOW-10,sender_id:null,text:'A previously sent observation.',kind:'earlier-proactive-share'});
 assert.equal(input.recipient_context[0].sender_id,FATHER);assert.deepEqual(input.audience,audience);
 assert.equal(JSON.stringify(input).includes('DO_NOT_COPY'),false);
});

test('contact keeps the selected source version and human author distinct from self and journal interpretation',async t=>{
 const f=fixture(t),original=f.human('human-original','A human statement about the paper boat.');
 const own=f.record('own-project','An actual own project draft.',{source:'own-workroom-change'});
 const intent=f.contact([original.id,own.id]);
 f.human('human-original','A newer correction must not replace the saved source.',{revisionKind:'correction'});
 const journal=f.cognition.journal.record({evidence_ids:[original.id],interpretation:{feeling:'I felt curious about the old moment.',association:'This is my interpretation, not the human\'s confirmed feeling.'}});
 const unrelated=f.record('unrelated','A separate public source.');
 f.cognition.journal.record({evidence_ids:[unrelated.id],interpretation:{feeling:'DO_NOT_COPY_UNRELATED_REACTION'}});
 f.plan(req=>{
  const input=initial(req),human=input.evidence.find(item=>item.id===original.id),self=input.evidence.find(item=>item.id===own.id);
  assert.equal(human.revision,original.revision);assert.equal(human.text,'A human statement about the paper boat.');
  assert.equal(human.role,'user');assert.equal(human.author.id,FATHER);assert.equal(human.author.kind,'human');
  assert.equal(human.scope,scope.address);assert.equal(human.at,NOW-60000);
  assert.equal(self.role,'self');assert.equal(self.author.id,SELF);assert.equal(self.author.kind,'self');
  assert.equal(input.reactions.length,1);assert.equal(input.reactions[0].id,journal.id);
  assert.deepEqual(input.reactions[0].interpretation,journal.interpretation);
  assert.notEqual(human.text,input.reactions[0].interpretation.feeling);
  assert.equal(JSON.stringify(input).includes('DO_NOT_COPY_UNRELATED'),false);
  return finish();
 });
 await f.run(intent);f.consumed();
});

test('reaction is optional: a sourced discovery still reaches expression generation and can be shared',async t=>{
 const f=fixture(t),{intent}=f.discovery();
 f.plan(req=>{assert.deepEqual(initial(req).reactions,[]);return finish();});
 assert.equal((await f.run(intent)).decision,'share');assert.equal(f.requests.length,1);f.consumed();
});

for(const decision of ['later','keep_private'])test(decision+' saves its own outcome without reusing a stray proposed message',async t=>{
 const f=fixture(t),{intent}=f.discovery();f.plan(finish(decision,'This must never be returned as a message.'));
 const result=await f.run(intent);assert.equal(result.decision,decision);assert.equal(Object.hasOwn(result,'text'),false);
 assert.equal(Object.hasOwn(JSON.parse(f.saved()[0].result),'text'),false);assert.equal(f.saved()[0].state,'prepared');
 assert.equal(f.continuity.get(intent.id).state,'queued');f.consumed();
});

test('invalid or overlong finish text is rejected in full, never truncated into a sendable decision',async t=>{
 const missingText={name:'finish_life_share',args:{decision:'share',reason:'No text was supplied.'}};
 const cases=[finish('share','x'.repeat(361)),finish('share','   '),finish('share',17),missingText,finish('share','valid','r'.repeat(241)),finish('unknown','valid'),{...finish(),args:{...finish().args,send:true}}];
 for(const action of cases){
  const f=fixture(t),{intent}=f.discovery();
  f.plan(action,req=>{
   assert.deepEqual(req.tools.map(tool=>tool.name),['finish_life_share']);
   assert.equal(req.input.at(-1).type,'function_call_output');
   return {output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'A plain answer cannot replace a rejected finish.'}]}]};
  });
  await assert.rejects(f.run(intent),/No explicit expression decision/);f.consumed();
  assert.equal(f.saved()[0].state,'failed');assert.equal(JSON.parse(f.saved()[0].result).text,undefined);
  assert.equal(f.continuity.get(intent.id).state,'queued');
 }
});

test('a complete plain assistant reply without finish is not accepted as a share',async t=>{
 const f=fixture(t),{intent}=f.discovery();
 f.plan({output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Looks ready to send, but there is no explicit decision.'}]}]});
 await assert.rejects(f.run(intent),/No explicit expression decision/);assert.equal(f.saved()[0].state,'failed');f.consumed();
});

test('unavailable research or sending tools cannot execute and do not expand the expression scope',async t=>{
 for(const name of ['public_fetch','send_message']){
  const f=fixture(t),{intent}=f.discovery();
  f.plan({name,args:{text:'This must not be sent.',url:'https://example.org/forbidden'}},req=>{
   assert.deepEqual(req.tools.map(tool=>tool.name),['finish_life_share']);
   assert.equal(req.input.at(-1).type,'function_call_output');return finish('keep_private',undefined);
  });
  assert.equal((await f.run(intent)).decision,'keep_private');assert.equal(f.requests.length,2);f.consumed();
  assert.equal(f.continuity.get(intent.id).state,'queued');
 }
});

test('abort during generation persists interrupted, even when the provider subsequently returns a valid finish',async t=>{
 const f=fixture(t),{intent}=f.discovery(),controller=new AbortController();
 let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 f.plan(async(_req,{signal})=>{assert.equal(signal,controller.signal);entered();await gate;return finish();});
 const promise=f.run(intent,{signal:controller.signal});await started;
 assert.equal(f.saved()[0].state,'preparing');controller.abort();release();
 await assert.rejects(promise,error=>error.name==='AbortError');assert.equal(f.saved()[0].state,'interrupted');
 assert.equal(JSON.parse(f.saved()[0].result).text,undefined);assert.equal(f.continuity.get(intent.id).state,'queued');f.consumed();
});

test('restart marks unfinished expression attempts interrupted and preserves completed decisions',async t=>{
 const f=fixture(t),{intent}=f.discovery();f.plan(finish());await f.run(intent);
 f.db.prepare("INSERT INTO life_share_expression VALUES('in-flight',?,?, 'preparing','{}',NULL)").run(intent.id,NOW);
 new LifeShareComposer(f.dependencies);
 assert.equal(f.db.prepare("SELECT state FROM life_share_expression WHERE id='in-flight'").get().state,'interrupted');
 assert.equal(f.saved()[0].state,'prepared');
});

test('missing contact source revision fails before generation instead of substituting its latest version',async t=>{
 const f=fixture(t),source=f.human('versioned-source','One original statement.');
 const bad=f.record('broken-contact',{kind:'contact-intention',source_refs:[{id:source.id,revision:source.revision+500,author:{id:FATHER,kind:'human'}}]},{source:'life-contact-intention'});
 const {intent}=f.discovery();await assert.rejects(f.run({...intent,evidence:bad.id}),/source version is unavailable/);
 assert.equal(f.requests.length,0);assert.equal(f.saved().length,0);
});

test('long structured contact sources retain the exact body excerpt rather than leaking a truncated JSON envelope',t=>{
 const f=fixture(t),text='Original human body. '+ 'b'.repeat(4000);
 const original=f.human('long-source',text),intent=f.contact([original.id]);
 const input=f.composer.input({intent,scope,audience});
 assert.equal(input.evidence[0].text,text.slice(0,480));assert.equal(input.evidence[0].revision,original.revision);
});

test('a long public research record supplies only its bounded summary and source pointers',t=>{
 const f=fixture(t),{intent}=f.discovery({summary:'Actual public conclusion.',research_trace:'DO_NOT_COPY_LONG_RESEARCH'.repeat(800)});
 const input=f.composer.input({intent,scope,audience});
 assert.equal(input.evidence[0].summary,'Actual public conclusion.');assert.equal(input.evidence[0].sources.length,1);
 assert.equal(JSON.stringify(input).includes('DO_NOT_COPY_LONG_RESEARCH'),false);
});

test('later attributed corrections reach expression generation without rewriting the selected contact or public source',async t=>{
 const f=fixture(t),source=f.human('original-claim','The original human claim.'),contact=f.contact([source.id]);
 const discovery=f.discovery({summary:'The original public summary.'});
 const correctionText='This later feedback corrects the original claim. '+ 'c'.repeat(600);
 const feedback=f.human('later-feedback',correctionText,{at:NOW-1000});
 for(const targetId of [source.id,discovery.source.id])f.cognition.store.registerFeedback({targetId,feedbackId:feedback.id});
 f.human('original-claim','A newer version must not replace the contact\'s selected source.',{revisionKind:'correction'});
 const assertCorrection=req=>{
  const item=initial(req).evidence[0];assert.equal(item.corrections.length,1);
  const correction=item.corrections[0];
  assert.equal(correction.id,feedback.id);assert.equal(correction.kind,'quoted-user-challenge');
  assert.equal(correction.at,NOW-1000);assert.equal(correction.sender_id,FATHER);assert.equal(correction.scope,scope.address);
  assert.equal(correction.text,correctionText.slice(0,400));assert.ok(correction.notice);
  return item;
 };
 f.plan(req=>{
  const item=assertCorrection(req);assert.equal(item.revision,source.revision);
  assert.equal(item.text,'The original human claim.');assert.equal(item.author.kind,'human');return finish('later');
 },req=>{
  const item=assertCorrection(req);assert.equal(item.revision,discovery.source.revision);
  assert.equal(item.summary,'The original public summary.');return finish('keep_private');
 });
 assert.equal((await f.run(contact)).decision,'later');assert.equal((await f.run(discovery.intent)).decision,'keep_private');f.consumed();
 assert.equal(JSON.parse(f.cognition.store.get({id:source.id,revision:source.revision}).text).body,'The original human claim.');
});

test('sending attempts cannot appear as earlier shares or crowd out actual inbound and sent context',async t=>{
 const f=fixture(t),{intent}=f.discovery();
 f.conversation('proactive:confirmed','An actually acknowledged earlier share.',{role:'assistant',state:'sent',at:NOW-2000});
 f.conversation('real-inbound','A real received message whose reply generation failed.',{state:'failed',at:NOW-1000});
 for(let i=0;i<10;i++)f.conversation('proactive:sending-'+i,'DO_NOT_TREAT_AS_SENT',{role:'assistant',state:'sending',at:NOW-100+i});
 f.plan(req=>{
  const context=initial(req).recipient_context;
  assert.deepEqual(context.map(item=>item.event),['proactive:confirmed','real-inbound']);
  assert.equal(context[0].kind,'earlier-proactive-share');assert.equal(context[1].role,'user');
  assert.equal(JSON.stringify(context).includes('DO_NOT_TREAT_AS_SENT'),false);return finish('later');
 });
 assert.equal((await f.run(intent)).decision,'later');f.consumed();
 assert.equal(f.conversationDb.prepare("SELECT count(*) n FROM turns WHERE state='sending'").get().n,10,'Reading context must not settle in-flight deliveries');
});

const mediaFinish=(attachments,text='One complete expression.')=>({name:'finish_life_share',args:{decision:'share',text,reason:'This optional expression fits this recipient.',...(attachments===undefined?{}:{attachments})}});
const lastTool=req=>JSON.parse(req.input.filter(item=>item.type==='function_call_output').at(-1).output);
const textDigest=text=>createHash('sha256').update(text.replace(/\s+/g,'')).digest('hex');

test('optional face lookup and public image page feed one saved expression and the same durable intent revision',async t=>{
 const f=fixture(t,{withMedia:true}),{intent}=f.discovery(),image=f.publicImage(),before=f.cognition.store.counts();
 f.plan(req=>{
  assert.deepEqual(req.tools.map(tool=>tool.name),['finish_life_share','find_life_share_faces','list_life_share_images']);
  assert.equal(initial(req).draft_media_plan,null);return {name:'find_life_share_faces',args:{query:'0'}};
 },req=>{assert.ok(lastTool(req).matches.some(face=>face.id==='0'));return {name:'list_life_share_images',args:{limit:4}};},req=>{
  assert.equal(lastTool(req).items[0].public_image_id,image);return mediaFinish({native_face_ids:['0'],public_image_id:image});
 });
 const prepared=await f.run(intent);f.consumed();assert.equal(f.requests.length,3);
 assert.equal(prepared.binding.intent_id,intent.id);assert.equal(prepared.binding.revision,intent.revision);assert.equal(prepared.binding.target_id,FATHER);
 assert.equal(prepared.media_plan.public_image_id,image);assert.equal(f.continuity.get(intent.id).media_plan,null);
 const saved=f.continuity.prepareExpression(intent,prepared);assert.equal(saved.revision,intent.revision+1);assert.deepEqual(saved.media_plan,prepared.media_plan);
 const raw=f.db.prepare('SELECT text,media_plan FROM life_share_intents WHERE id=?').get(intent.id);
 assert.equal(raw.text,prepared.text);assert.equal(typeof raw.media_plan,'string');assert.deepEqual(JSON.parse(raw.media_plan),prepared.media_plan);
 const restored=new LifeContinuity(f.db,{clock:()=>NOW}).get(intent.id);assert.deepEqual(restored.media_plan,prepared.media_plan);
 assert.ok(f.media.revalidate(restored.media_plan).imageBytes.length);assert.equal(f.saved().length,1);assert.equal(f.saved()[0].state,'prepared');
 assert.deepEqual(f.cognition.store.counts(),before);assert.equal(f.mediaStore.db.prepare('SELECT count(*) n FROM image_sends').get().n,0);
});

test('empty inventory or choosing no attachments leaves text viable and preserves the old empty-media digest',async t=>{
 const f=fixture(t,{withMedia:true}),{intent}=f.discovery();
 f.plan({name:'list_life_share_images',args:{}},req=>{assert.deepEqual(lastTool(req).items,[]);return mediaFinish({native_face_ids:[]},' A simple text thought. ');});
 const prepared=await f.run(intent),saved=f.continuity.prepareExpression(intent,prepared);f.consumed();
 assert.equal(prepared.media_plan,null);assert.equal(saved.media_plan,null);assert.equal(saved.digest,textDigest('A simple text thought.'));
 const noAdapter=fixture(t),plain=noAdapter.discovery().intent;noAdapter.plan(mediaFinish(undefined));
 assert.equal((await noAdapter.run(plain)).media_plan,null);noAdapter.consumed();
});

test('invalid private image or extra attachment fields cannot become a prepared share; ordinary text can still be selected',async t=>{
 for(const kind of ['private','unknown-face','url','later-attachment']){
  const f=fixture(t,{withMedia:true}),{intent}=f.discovery();
  const bytes=readFileSync(new URL('./assets/stickers/deepseek-bixin.png',import.meta.url));
  const privateId=f.mediaStore.insert('private-'+FATHER,bytes,'synthetic-source').id;
  const bad=kind==='private'?mediaFinish({public_image_id:privateId}):kind==='unknown-face'?mediaFinish({native_face_ids:['999999']}):kind==='url'?mediaFinish({url:'https://example.org/not-allowed'}):{name:'finish_life_share',args:{decision:'later',reason:'Wait.',attachments:{native_face_ids:['0']}}};
  f.plan(bad,req=>{assert.match(req.input.at(-1).output,/rejected/);return mediaFinish(undefined);});
  const result=await f.run(intent);f.consumed();assert.equal(result.media_plan,null);assert.equal(result.decision,'share');
  assert.equal(f.continuity.get(intent.id).media_plan,null);assert.equal(f.saved().length,1);
 }
});

test('prepared attachments cannot be reused for another intent, recipient or stale revision',async t=>{
 const f=fixture(t,{withMedia:true}),{intent}=f.discovery(),other=f.discovery().intent;
 f.plan(mediaFinish({native_face_ids:['0']}));const prepared=await f.run(intent);f.consumed();
 assert.throws(()=>f.continuity.prepareExpression(other,prepared),/another intent/);
 const before=f.continuity.get(intent.id),changed=f.continuity.reconsider(intent.id,{decision:'later',reason:'A different audience now.',recipient:'mother',target_kind:'private',target_id:MOTHER,recipient_reason:'A new deliberate recipient.'},[{id:intent.id}]);
 assert.throws(()=>f.continuity.prepareExpression(before,prepared),/changed/);
 assert.throws(()=>f.continuity.prepareExpression(changed,prepared),/another intent/);
 assert.deepEqual(f.continuity.get(intent.id),changed);assert.equal(changed.media_plan,null);
 await assert.rejects(f.run(changed),/intended recipient/);assert.equal(f.requests.length,1);
});

test('the expression binding is captured before generation, including when the caller changes its snapshot',async t=>{
 const f=fixture(t,{withMedia:true}),{intent}=f.discovery();
 f.plan(()=>{intent.recipient_reason='Mutated only after generation began';return mediaFinish({native_face_ids:['0']});});
 const prepared=await f.run(intent);f.consumed();assert.equal(prepared.binding.recipient_reason,target.recipient_reason);
 assert.throws(()=>f.continuity.prepareExpression(intent,prepared),/another intent/);
 assert.equal(f.continuity.get(intent.id).media_plan,null);
});

test('same text plus different media has distinct stable digests, while a fresh text-only expression explicitly clears the old plan',async t=>{
 const f=fixture(t,{withMedia:true}),a=f.discovery().intent,b=f.discovery().intent,c=f.discovery().intent;
 const make=async(intent,ids)=>{f.plan(mediaFinish(ids===undefined?undefined:{native_face_ids:ids}));const decision=await f.run(intent);return f.continuity.prepareExpression(intent,decision);};
 const first=await make(a,['0']),second=await make(b,['1']),same=await make(c,['0']);
 assert.notEqual(first.digest,second.digest);assert.equal(first.digest,same.digest);assert.notEqual(first.digest,textDigest(first.text));
 const before=first,cleared=await make(first,undefined);f.consumed();assert.equal(cleared.media_plan,null);assert.equal(cleared.digest,textDigest(cleared.text));
 assert.equal(cleared.revision,before.revision+1);assert.equal(f.db.prepare('SELECT count(*) n FROM life_share_intents WHERE activity=?').get(a.activity).n,1);
});

test('later and private decisions retain the previous expression plan; a changed recipient or draft clears that bound plan',async t=>{
 for(const decision of ['later','keep_private']){
  const f=fixture(t,{withMedia:true}),{intent}=f.discovery();f.plan(mediaFinish({native_face_ids:['0']}));
  const original=f.continuity.prepareExpression(intent,await f.run(intent));f.plan(finish(decision));
  const deferred=f.continuity.prepareExpression(original,await f.run(original));f.consumed();
  assert.deepEqual(deferred.media_plan,original.media_plan);assert.equal(deferred.text,original.text);assert.equal(deferred.digest,original.digest);
  assert.equal(deferred.state,decision==='later'?'queued':'discarded');
  if(decision==='later'){
   const changed=f.continuity.reconsider(deferred.id,{decision:'later',reason:'Changed the draft.',text:'A genuinely new thought.'},[{id:deferred.id}]);
   assert.equal(changed.media_plan,null);assert.equal(changed.digest,textDigest(changed.text));
  }
 }
});

test('sending, uncertain and sent intents never exchange attachments or create a second intent',async t=>{
 for(const terminal of ['sending','uncertain','sent']){
  const f=fixture(t,{withMedia:true}),{intent}=f.discovery();f.plan(mediaFinish({native_face_ids:['0']}));
  const queued=f.continuity.prepareExpression(intent,await f.run(intent));
  f.plan(mediaFinish({native_face_ids:['1']}));const pendingReplacement=await f.run(queued);f.consumed();
  f.continuity.begin(queued.id,'one-attempt',queued.revision);if(terminal!=='sending')f.continuity.settle(queued.id,terminal,{message_id:42});
  const frozen=f.continuity.get(queued.id);assert.throws(()=>f.continuity.prepareExpression(queued,pendingReplacement),/changed/);
  assert.throws(()=>f.continuity.prepareExpression(frozen,pendingReplacement),/no longer pending/);
  assert.deepEqual(f.continuity.queue(queued.activity,'another-source','Another text.',target),frozen);
  assert.deepEqual(f.continuity.get(queued.id),frozen);assert.equal(f.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,1);
 }
});

test('media storage rejects malformed metadata and missing bindings before changing the intent',async t=>{
 const f=fixture(t,{withMedia:true}),{intent}=f.discovery();f.plan(mediaFinish({native_face_ids:['0']}));const prepared=await f.run(intent);f.consumed();
 for(const change of [p=>delete p.binding,p=>p.media_plan.metadata.native_faces[0].name='forged',p=>p.media_plan.native_face_ids=[0],p=>p.media_plan.metadata.path='C:/not-a-plan']){
  const invalid=structuredClone(prepared);change(invalid);assert.throws(()=>f.continuity.prepareExpression(intent,invalid));
  assert.deepEqual(f.continuity.get(intent.id),intent);
 }
});

test('nullable media migration preserves old text, digest, receipts and old named-column writes',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE life_share_intents(id TEXT PRIMARY KEY,activity TEXT UNIQUE NOT NULL,evidence TEXT NOT NULL,text TEXT NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,next_review INTEGER NOT NULL,attempt TEXT,receipt TEXT)');
 db.prepare('INSERT INTO life_share_intents VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('legacy','legacy-activity','legacy-source','Preserved text.','old-digest','sent','old',1,2,3,'old-attempt','{"message_id":7}');
 const continuity=new LifeContinuity(db,{clock:()=>NOW}),old=continuity.get('legacy');
 assert.equal(old.text,'Preserved text.');assert.equal(old.digest,'old-digest');assert.equal(old.receipt,'{"message_id":7}');assert.equal(old.media_plan,null);
 db.prepare("INSERT INTO life_share_intents(id,activity,evidence,text,digest,state,reason,created,updated,next_review) VALUES('old-writer','old-writer-activity','source','Still plain text','plain-digest','queued','old writer',1,1,1)").run();
 assert.equal(continuity.get('old-writer').media_plan,null);assert.equal(continuity.get('old-writer').text,'Still plain text');
 new LifeContinuity(db,{clock:()=>NOW});assert.deepEqual(continuity.get('legacy'),old);
});

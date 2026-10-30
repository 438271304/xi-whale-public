// Real conversation/memory stores, synthetic sources, and a captured fake client.
// No provider, production database, QQ transport, or persistent fixture writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {ConversationService} from './conversation-service.mjs';
import {recentExchange} from './recent-exchange.mjs';

const NOW=Date.parse('2036-10-17T22:54:00+08:00'),MINUTE=60000;
const A='910210003',B='910210004',BOT='910210001',P='private:'+A,G='group:910220001';
const CURRENT='-981001',PREVIOUS='-981000';
const QUESTION='纸飞机的折线为什么会影响飞得稳不稳？';
const ANSWER='关于纸飞机的折线，我还没有完全弄明白。';
const AFFECTION='哈哈，刚才挺可爱的。（轻轻敲敲脑壳）小鲸鱼在不在呀？';
const sha=text=>createHash('sha256').update(text).digest('hex');
const occurrences=(text,needle)=>text.split(needle).length-1;
const envelope=(event,body,{scope=P,sender=A,at=NOW-10*MINUTE,segments=[]}={})=>JSON.stringify({body,segments,transport:{conversation:scope,sender_id:sender,message_id:String(event),time:at/1000}});
const final=(text='SYNTHETIC_CAPTURED_REPLY')=>({response:{id:'offline-final',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]},attempts:[]});
const call=(id,name,args)=>({type:'function_call',call_id:id,name,arguments:JSON.stringify(args)});
function sections(instructions){return instructions.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));}
const memoryView=instructions=>sections(instructions).find(value=>Array.isArray(value.related));
const recentView=instructions=>sections(instructions).find(value=>Array.isArray(value.recent_human_messages));
const token=(record,overrides={})=>({scope:record.scope,event:String(record.event),role:record.role,source_text_sha256:sha(record.text),body_sha256:sha(record.body),body_complete:true,...overrides});

function fixture(t,{respond}={}){
 const root=mkdtempSync(join(tmpdir(),'whale-context-dedup-')),requests=[],sends=[],toolDefinitions=[];
 const service=new ConversationService({root,botId:BOT,guardianIds:[A,B],publicProfile:'Synthetic test identity. Reply only to the actual current message.',
  isAllowed:()=>true,wait:async()=>{},send:async value=>{sends.push(value);},client:{respond:async req=>{
   requests.push(structuredClone(req));return respond?respond(req,requests.length):final();
  }}});
 service.engine.clock=()=>NOW;service.cognition.store.clock=()=>NOW;
 service.cognition.journal.clock=()=>NOW;service.cognition.journalContext.clock=()=>NOW;service.cognition.personImpressions.clock=()=>NOW;
 const originalToolsFor=service.engine.toolsFor;
 service.engine.toolsFor=(...args)=>{const tools=originalToolsFor(...args);toolDefinitions.push(tools.map(({name,description,parameters})=>({type:'function',name,description,parameters})));return tools;};
 t.after(async()=>{await service.close();const base=realpathSync(tmpdir()),target=realpathSync(root);assert.ok(target.startsWith(base+sep));rmSync(target,{recursive:true,force:true});});
 const store=service.cognition.store;
 const remember=(event,body,{scope=P,sender=A,role='user',at=NOW-10*MINUTE,text,segments=[],inTurns=true,metadata={},revisionKind='observation'}={})=>{
  text??=role==='assistant'?body:envelope(event,body,{scope,sender,at,segments});
  if(inTurns)service.engine.db.prepare('INSERT INTO turns VALUES(?,?,?,?,?,?)').run(scope,String(event),role,text,at,role==='assistant'?'sent':'completed');
  const saved=store.recordMessage({scope,event,role,text,senderId:role==='assistant'?BOT:sender,at,source:role==='assistant'?'acknowledged-delivery':'live-transport',state:role==='assistant'?'sent':'heard',metadata,revisionKind});
  return {...saved,scope,event:String(event),role,text,body,at};
 };
 const currentText=(body=AFFECTION)=>envelope(CURRENT,body,{at:NOW});
 const receive=(body=AFFECTION)=>service.receiveAdmitted({message_type:'private',user_id:Number(A),message_id:Number(CURRENT),time:NOW/1000,sender:{nickname:'Synthetic parent'},message:[{type:'text',data:{text:body}}]},[]);
 const payload=(records,{maxChars=1600}={})=>({related:records.map(r=>store.evidenceView(store.get({id:r.id,maxChars:24000}),{maxChars}))});
 return {service,store,requests,sends,toolDefinitions,remember,currentText,receive,payload};
}

test('a real service request presents the old question/answer once instead of three/two times, without changing current text or tools',async t=>{
 const f=fixture(t),question=f.remember(PREVIOUS,QUESTION),answer=f.remember(PREVIOUS,ANSWER,{role:'assistant',at:NOW-9.5*MINUTE});
 assert.equal((await f.receive()).status,'sent');assert.equal(f.requests.length,1);assert.equal(f.sends.length,1);
 const req=f.requests[0],anchored=f.service.engine.anchoredInput(P,CURRENT),current=anchored.current;
 const priorView={input:anchored.input,memory:f.store.context({scope:P,current:current.text,currentEvent:CURRENT,maxChars:7000}),recent:recentExchange(f.service.engine.db,{peer:P,current,now:NOW,presentation:{botId:BOT,guardianIds:[A,B]}})};
 assert.equal(occurrences(JSON.stringify(priorView),QUESTION),3);assert.equal(occurrences(JSON.stringify(priorView),ANSWER),2);
 assert.equal(occurrences(JSON.stringify(req),QUESTION),1);assert.equal(occurrences(JSON.stringify(req),ANSWER),1);
 assert.equal(JSON.parse(req.input.at(-1).content).said,AFFECTION);assert.deepEqual(req.tools,f.toolDefinitions[0]);
 assert.ok(req.tools.some(tool=>tool.name==='read_experience'));assert.ok(req.tools.some(tool=>tool.name==='read_conversation_history'));
 const view=memoryView(req.instructions),recent=recentView(req.instructions),refs=anchored.presentedSources;
 for(const record of [question,answer]){
  assert.deepEqual(refs.find(r=>r.event===record.event&&r.role===record.role),token(record));
  const item=view.related.find(r=>r.id===record.id);assert.equal(item.body_in_transcript,true);assert.equal(Object.hasOwn(item,'body'),false);
  assert.equal(item.scope,P);assert.equal(item.author.id,record.role==='user'?A:BOT);assert.equal(item.at,record.at);
  assert.equal(f.store.get({id:record.id}).text,record.text);
 }
 assert.equal(recent.recent_human_messages[0].content_in_transcript,true);assert.equal(Object.hasOwn(recent.recent_human_messages[0],'body_excerpt'),false);
 assert.equal(recent.recent_human_messages[0].elapsed_seconds,600);assert.equal(recent.previous_self.elapsed_seconds,570);
 assert.ok(!refs.some(r=>r.event===CURRENT),'The current message is not a historical deduplication token.');
});

test('deduplication requires the same scope, role, author-bearing raw source, body hash and complete presentation',t=>{
 const f=fixture(t),source=f.remember('identity','IDENTITY_BOUND_BODY'),base=f.payload([source]);
 const wrongSender=envelope(source.event,source.body,{sender:B,at:source.at});
 const variants=[token(source,{scope:G}),token(source,{role:'assistant'}),token(source,{source_text_sha256:sha(wrongSender)}),token(source,{body_sha256:sha('OTHER_BODY')}),token(source,{body_complete:false})];
 for(const candidate of variants){const result=f.store.withTranscriptReferences(base,[candidate]);assert.equal(result.related[0].body,source.body);assert.notEqual(result.related[0].body_in_transcript,true);}
 const own=f.remember('identity','OWN_ROLE_BODY',{role:'assistant',at:source.at+1}),other=f.remember('identity','OTHER_SCOPE_BODY',{scope:G,inTurns:false});
 const result=f.store.withTranscriptReferences(f.payload([source,own,other]),[token(source)]);
 assert.equal(result.related[0].body_in_transcript,true);assert.equal(result.related[1].body,own.body);assert.equal(result.related[2].body,other.body);
 assert.equal(f.store.withTranscriptReferences(base,[token(source)]).related[0].body_in_transcript,true);
});

test('history skipped by the 96k transcript budget stays readable, while a truncated memory preview can reference a fully shown source',async t=>{
 const f=fixture(t),hugeBody='SKIPPED_SOURCE_BEGIN '+('x'.repeat(96500))+' SKIPPED_SOURCE_END';
 const huge=f.remember('too-large',hugeBody),small=f.remember('fits','FULL_TRANSCRIPT_BODY '+('y'.repeat(1200)),{at:NOW-5*MINUTE});
 assert.equal((await f.receive()).status,'sent');
 const anchored=f.service.engine.anchoredInput(P,CURRENT),shown=anchored.presentedSources;
 assert.ok(!shown.some(s=>s.event===huge.event));assert.ok(shown.some(s=>s.event===small.event));
 assert.ok(!JSON.stringify(anchored.input).includes('SKIPPED_SOURCE_BEGIN'));assert.ok(JSON.stringify(anchored.input).includes(small.body));
 const payload=f.payload([huge,small],{maxChars:32});assert.equal(payload.related[0].body_complete,false);assert.equal(payload.related[1].body_complete,false);
 const result=f.store.withTranscriptReferences(payload,shown);
 assert.equal(result.related[0].body,payload.related[0].body);assert.notEqual(result.related[0].body_in_transcript,true);
 assert.equal(result.related[1].body_in_transcript,true);assert.equal(Object.hasOwn(result.related[1],'body'),false);
 const incomplete=f.store.withTranscriptReferences(payload,[token(huge,{body_complete:false})]);assert.equal(incomplete.related[0].body,payload.related[0].body);
 assert.equal(f.store.get({id:huge.id,maxChars:24}).next_offset,24,'Omitted transcript text remains explicitly pageable.');
});

test('revised and metadata-enriched sources retain their body even when their latest hashes match a presented token',t=>{
 const f=fixture(t),original=f.remember('revised','OLD_OBSERVATION'),nextText=envelope('revised','CORRECTED_OBSERVATION',{at:original.at});
 f.store.recordMessage({scope:P,event:original.event,role:'user',senderId:A,at:original.at,text:nextText,source:'synthetic-correction',revisionKind:'correction'});
 const revised={...original,text:nextText,body:'CORRECTED_OBSERVATION'};
 const enriched=f.remember('enriched','ENRICHED_BODY',{metadata:{image_intake_status:'newly-reviewed'}});
 const result=f.store.withTranscriptReferences(f.payload([revised,enriched]),[token(revised),token(enriched)]);
 assert.equal(f.store.get({id:original.id}).version_count,2);assert.equal(result.related[0].body,revised.body);assert.equal(result.related[1].body,enriched.body);
 assert.ok(result.related.every(r=>r.body_in_transcript!==true));
 assert.equal(f.store.get({id:original.id,revision:original.revision}).text,original.text,'The earlier revision is not overwritten.');
 const stale=f.store.withTranscriptReferences(f.payload([revised]),[token(original)]);assert.equal(stale.related[0].body,revised.body);
});

test('source-linked corrections, attachments and attribution survive the final read-only view',t=>{
 const f=fixture(t),source=f.remember('with-evidence','ORIGINAL_BODY_WITH_EVIDENCE'),feedback=f.remember('feedback','这句说错了，实际是另一件事。',{at:NOW-MINUTE});
 f.store.registerFeedback({targetId:source.id,feedbackId:feedback.id});
 f.store.recordAttachment({scope:P,id:'synthetic-image',event:source.event,created:source.at,source:'received',analysis:{status:'vision-ok',vision:{description:'SYNTHETIC_IMAGE_DESCRIPTION'}}});
 const base={...f.payload([source]),attachments:[f.store.getAttachment('synthetic-image')]},snapshot=structuredClone(base);
 const changes=f.store.db.prepare('SELECT total_changes() n').get().n,counts=f.store.counts(),result=f.store.withTranscriptReferences(base,[token(source)]),row=result.related[0];
 assert.equal(row.body_in_transcript,true);assert.equal(Object.hasOwn(row,'body'),false);
 for(const key of ['id','scope','event','role','author','at','evidence_kind','attachments','corrections','sources','reply_context'])assert.deepEqual(row[key],base.related[0][key]);
 assert.equal(row.corrections[0].id,feedback.id);assert.ok(row.attachments.includes('synthetic-image'));assert.deepEqual(result.attachments,base.attachments);
 assert.deepEqual(base,snapshot);assert.deepEqual(f.store.counts(),counts);assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,changes);
});

test('journal, mood, interest and current-person selections occur before deduplication and retain the existing 7k budget',t=>{
 const f=fixture(t),source=f.remember('selection','纸飞机这一折让我想到一个具体问题。'),c=f.service.cognition,evidence=[{type:'message',id:source.id}];
 c.journal.record({evidence_ids:[source.id],interpretation:{association:'我想继续比较纸飞机的折线和稳定性。'}});
 c.store.setState({kind:'mood',key:'inner-life',value:{mood:'平静',active:true},evidence,at:NOW-MINUTE});
 c.store.setState({kind:'interest',key:'folds',value:{interpretation:'想理解折线和稳定性',active:true},evidence,at:NOW-MINUTE});
 assert.equal(c.personImpressions.write({person_id:A,key:'specific-questions',operation:'record',expected_revision:0,type:'interaction',interpretation:'他这次愿意一起细看一个问题。',reason:'从本次合成交流形成的理解。',evidence_ids:[source.id]}).status,'saved');
 const current={event:CURRENT,text:f.currentText()},before=memoryView(c.context({kind:'private',id:A},current)),selectionBefore=structuredClone(c.contextEvidence({kind:'private',id:A}));
 const after=memoryView(c.context({kind:'private',id:A},{...current,transcriptPresentation:[token(source)]}));
 assert.ok(before.relevant_journal?.length);assert.ok(before.person_understanding?.entries.length);assert.ok(before.state.some(s=>s.kind==='mood'));assert.ok(before.state.some(s=>s.kind==='interest'));
 for(const key of ['relevant_journal','person_understanding','state','people','recent_contacts'])assert.deepEqual(after[key],before[key]);
 assert.deepEqual(c.contextEvidence({kind:'private',id:A}),selectionBefore);assert.ok(JSON.stringify(before).length<=7000);assert.ok(JSON.stringify(after).length<=7000);
 assert.equal(after.related.find(r=>r.id===source.id).body_in_transcript,true);
});

test('a closed tool round can still read the old full source and a cross-conversation source after presentation deduplication',async t=>{
 let oldSource,crossSource;
 const f=fixture(t,{respond:(req,round)=>{
  if(round===1)return {response:{id:'offline-tools',status:'completed',output:[call('read-old','read_experience',{id:oldSource.id}),call('read-cross','read_experience',{id:crossSource.id})]},attempts:[]};
  const results=req.input.filter(item=>item.type==='function_call_output');assert.equal(results.length,2);
  const own=JSON.parse(results.find(r=>r.call_id==='read-old').output),other=JSON.parse(results.find(r=>r.call_id==='read-cross').output);
  assert.equal(own.text,oldSource.text);assert.equal(own.scope,P);assert.equal(other.text,crossSource.text);assert.equal(other.scope,G);assert.equal(other.author.id,B);
  return final('已读到两处各自的合成来源。');
 }});
 oldSource=f.remember(PREVIOUS,QUESTION);f.remember(PREVIOUS,ANSWER,{role:'assistant',at:NOW-9.5*MINUTE});
 crossSource=f.remember('cross-evidence','CROSS_SOURCE_ORIGINAL_STAYS_READABLE',{scope:G,sender:B,inTurns:false});
 assert.equal((await f.receive('接着刚才的纸飞机问题，读一下已有依据。')).status,'sent');assert.equal(f.requests.length,2);assert.equal(f.sends.length,1);
 assert.equal(memoryView(f.requests[0].instructions).related.find(r=>r.id===oldSource.id).body_in_transcript,true);
 assert.ok(f.store.search({query:'纸飞机',scope:P,excludeCurrent:{scope:P,event:CURRENT}}).records.some(r=>r.id===oldSource.id));
 assert.equal(f.store.get({id:crossSource.id}).text,crossSource.text);
 const events=f.service.engine.db.prepare('SELECT tool,status FROM generation_tool_events ORDER BY id').all();assert.equal(events.length,2);assert.ok(events.every(e=>e.tool==='read_experience'&&e.status==='returned'));
});

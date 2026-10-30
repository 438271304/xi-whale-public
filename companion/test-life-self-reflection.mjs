// Real temporary SQLite, synthetic experiences. No network, model, QQ or publication.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {ExperienceMemory} from './experience-memory.mjs';
import {LifeJournal} from './life-journal.mjs';
import {lifeSelfReflectionTools} from './life-self-reflection.mjs';

const SELF='910010001',HUMAN='910010003',OTHER='910010004',GROUP='group:910020001',NOW=Date.parse('2026-10-30T12:00:00+08:00');
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'whale-life-self-reflection-')),path=join(root,'experience.sqlite3'),others=[];let at=NOW,sequence=0;
 const options={path,botId:SELF,guardianIds:[HUMAN],clock:()=>at};let store=new ExperienceMemory(options),journal=new LifeJournal({store,clock:()=>at});
 t.after(()=>{for(const other of others)other.close();store.close();const target=realpathSync(root);assert.ok(target.startsWith(realpathSync(tmpdir())+sep));rmSync(target,{recursive:true,force:true});});
 return {path,get store(){return store;},get journal(){return journal;},get now(){return at;},time:value=>at=value,advance:()=>at+=1000,
  reopen(){store.close();store=new ExperienceMemory(options);journal=new LifeJournal({store,clock:()=>at});},
  other(){const other=new ExperienceMemory(options);others.push(other);return other;},
  add({role='user',source='live-transport',scope=GROUP,senderId=HUMAN,event='fixture-'+(++sequence),body='PRIVATE_SOURCE_CANARY: a real retained family conversation.',when=at-60000,state=null,metadata={},revisionKind='observation'}={}){
   return store.recordMessage({scope,event,role,senderId,source,at:when,state,metadata,revisionKind,text:JSON.stringify({transport:{conversation:scope,sender_id:senderId,message_id:event,time:when/1000},body})});
  },
  tool(extra={}){return lifeSelfReflectionTools({store,journal,clock:()=>at,...extra})[0];},
  async run(args,extra={}){return JSON.parse(await this.tool(extra).handler(args));},
 };
}
const proposal=(id,patch={})=>({kind:'interest',key:'paper-boats',operation:'record',expected_revision:0,value:'I want to try a few slowly moving paper-boat drawings.',reason:'An actual conversation gave me a specific idea to revisit.',evidence_ids:[id],...patch});

test('QQ interest can be reinterpreted from the same experience, corrected and retired across restart without reviving in context',async t=>{
 const f=fixture(t),source=f.add(),original=f.store.get({id:source.id}).text;
 const first=await f.run(proposal(source.id));assert.equal(first.status,'saved');assert.equal(first.key,'reflection:paper-boats');assert.equal(first.current_revision,1);
 assert.equal(first.source_refs[0].revision,source.revision);assert.equal(first.source_refs[0].author.id,HUMAN);assert.equal(first.source_refs[0].role,'user');assert.equal(first.source_refs[0].at,NOW-60000);
 f.advance();const second=await f.run(proposal(source.id,{key:first.key,operation:'correct',expected_revision:1,value:'I now want one quiet boat interaction rather than a whole gallery.',reason:'I reconsidered what I actually wanted from that same conversation.'}));
 assert.equal(second.status,'saved');assert.equal(second.current_revision,2);assert.equal(second.previous_revision,1);assert.equal(f.store.getState({kind:'interest',key:'reflection:reflection:paper-boats'}).length,0);
 const before=f.store.counts();const duplicate=await f.run(proposal(source.id,{operation:'correct',expected_revision:2,value:'I now want one quiet boat interaction rather than a whole gallery.',reason:'The same understanding in different words.'}));
 assert.equal(duplicate.status,'unchanged');assert.equal(duplicate.current_revision,2);assert.deepEqual(f.store.counts(),before);
 f.reopen();assert.ok(f.store.contextState().some(r=>r.key===first.key));
 const retired=await f.run(proposal(source.id,{operation:'retire',expected_revision:2,value:undefined,reason:'I am putting this particular idea aside for now.'}));assert.equal(retired.status,'saved');assert.equal(retired.active,false);assert.equal(retired.current_revision,3);
 f.reopen();assert.ok(!f.store.contextState().some(r=>r.key===first.key));assert.ok(!f.store.context({scope:GROUP,current:'A present conversation',maxChars:6000}).state.some(r=>r.key===first.key));
 assert.equal(f.store.getState({kind:'interest',key:first.key})[0].value.active,false);assert.equal(f.store.getState({kind:'interest',key:first.key,history:true}).length,3);assert.equal(f.store.get({id:source.id}).text,original);
});

test('saved own draft forms an unfinished thought without claiming execution and can revise an existing public-discovery interest',async t=>{
 const f=fixture(t),work=f.add({role:'self',source:'own-workroom-change',scope:'unknown',senderId:null,metadata:{project_id:'synthetic-project',version:2,execution_verified:false},body:'A saved draft receipt, not completed execution.'});
 const unfinished=await f.run(proposal(work.id,{kind:'unfinished',key:'boat-button',value:'I want to try a slower button transition.'}));assert.equal(unfinished.status,'saved');assert.equal(unfinished.source_refs[0].role,'self');assert.equal(unfinished.source_refs[0].author.id,SELF);assert.equal(unfinished.source_refs[0].execution_verified,false);
 const reading=f.add({role:'self',scope:'unknown',senderId:null,source:'public-exploration',body:'An actual saved public exploration.'});
 f.store.setState({kind:'interest',key:'reflection:tides',value:{interpretation:'I wanted to compare many tides.',active:true,activity_id:'earlier-public'},evidence:[{type:'message',id:reading.id}],source:'activity-reflection',at:f.now});
 const changed=await f.run(proposal(work.id,{key:'reflection:tides',operation:'correct',expected_revision:1,value:'Making the draft showed me that I prefer observing one small tide.',reason:'A saved own-work experience changed this earlier public-exploration interest.'}));assert.equal(changed.status,'saved');assert.equal(changed.current_revision,2);
 const retired=await f.run(proposal(work.id,{key:'tides',operation:'retire',expected_revision:2,value:undefined,reason:'I do not want to continue this question now.'}));assert.equal(retired.active,false);assert.ok(!f.store.contextState().some(s=>s.key==='reflection:tides'));
});

test('missing, arbitrary internal, future event or future source revision cannot support a reflection',async t=>{
 const f=fixture(t),arbitrary=f.add({role:'self',scope:'unknown',source:'unverified-internal-thought'}),future=f.add({event:'future-event',when:f.now+1});
 for(const [id,reason] of [['exp-'+'0'.repeat(32),'experience-reference-unavailable'],[arbitrary.id,'experience-source-not-supported'],[future.id,'future-experience-reference']]){
  const result=await f.run(proposal(id));assert.equal(result.status,'rejected');assert.equal(result.reason,reason);
 }
 const original=f.add({event:'later-correction'});f.advance();const corrected=f.add({event:'later-correction',body:'A correction not yet knowable at the earlier clock.',revisionKind:'correction'});f.time(NOW);
 const rejected=await f.run(proposal(original.id));assert.equal(rejected.reason,'future-experience-reference');
 const pinned=await f.run({...proposal(original.id),evidence_ids:undefined,evidence_refs:[{id:original.id,revision:original.revision}]});assert.equal(pinned.status,'saved');assert.equal(pinned.source_refs[0].revision,original.revision);assert.notEqual(pinned.source_refs[0].revision,corrected.revision);
});

test('an explicit journal version retains its original source revision and distinguishes interpretation from human facts',async t=>{
 const f=fixture(t),source=f.add({event:'journal-source'}),diary=f.journal.record({evidence_ids:[source.id],interpretation:{feeling:'I felt calmer while thinking about the boat.'}});
 f.advance();const corrected=f.add({event:'journal-source',body:'A later corrected human statement, not the prior diary meaning.',revisionKind:'correction'});
 const diary2=f.journal.revise({id:diary.id,expected_revision:1,reason:'A new association.',interpretation:{association:'I now want a very small drawing.'}});assert.equal(diary2.revision,2);
 const result=await f.run({...proposal(source.id),evidence_ids:undefined,journal_refs:[{id:diary.id,revision:1}]});assert.equal(result.status,'saved');assert.equal(result.journal_refs[0].revision,1);assert.equal(result.journal_refs[0].interpretation_is_not_source_fact,true);
 assert.equal(result.source_refs[0].revision,source.revision);assert.notEqual(result.source_refs[0].revision,corrected.revision);assert.equal(result.source_refs[0].author.id,HUMAN);assert.equal(result.source_refs[0].scope,GROUP);
 const row=f.store.getState({kind:'interest',key:result.key})[0];assert.equal(row.value.interpretation_is_not_source_fact,true);assert.equal(row.value.facts_are_source_references,true);assert.ok(!JSON.stringify(row.value).includes('PRIVATE_SOURCE_CANARY'));assert.ok(!JSON.stringify(row.value).includes('A later corrected human statement'));
 f.advance();const futureDiary=f.journal.record({evidence_ids:[source.id],interpretation:{feeling:'A future recorded interpretation.'}});f.time(NOW+1000);
 const bad=await f.run({...proposal(source.id,{key:'future-journal'}),evidence_ids:undefined,journal_refs:[{id:futureDiary.id,revision:futureDiary.revision}]});assert.equal(bad.reason,'future-journal-reference');
 const missing=await f.run({...proposal(source.id,{key:'missing-journal'}),evidence_ids:undefined,journal_refs:[{id:diary.id,revision:999}]});assert.equal(missing.reason,'journal-reference-unavailable');
});

test('mandatory CAS returns the actual concurrent interpretation and never overwrites the other SQLite connection',async t=>{
 const f=fixture(t),source=f.add(),first=await f.run(proposal(source.id)),other=f.other();let release;
 const waiting=new Promise(resolve=>release=resolve),pending=f.run(proposal(source.id,{operation:'correct',expected_revision:1,value:'This stale reflection must not win.'}),{canAct:async()=>{await waiting;return true;}});
 f.advance();other.setState({kind:'interest',key:first.key,value:{interpretation:'A newer actual interpretation.',reason:'A parallel update.',active:true},evidence:[{type:'message',id:source.id}],at:f.now,source:'parallel-fixture'});release();
 const conflict=await pending;assert.equal(conflict.status,'conflict');assert.equal(conflict.current_revision,2);assert.equal(conflict.current.interpretation,'A newer actual interpretation.');assert.equal(conflict.current.active,true);assert.equal(conflict.current.at,f.now);assert.equal(conflict.current.source,'parallel-fixture');assert.equal(conflict.read_current_with,undefined);
 assert.equal(f.store.getState({kind:'interest',key:first.key})[0].value.interpretation,'A newer actual interpretation.');
 const missing=await f.run({...proposal(source.id,{key:'no-cas'}),expected_revision:undefined});assert.equal(missing.reason,'expected-revision-required');
});

test('full provenance recognizes a genuinely acknowledged own message but not an unsent or uncertain assistant claim',async t=>{
 const f=fixture(t),failed=f.add({role:'assistant',source:'conversation-turns',senderId:null,state:'failed'}),uncertain=f.add({role:'assistant',source:'acknowledged-delivery',senderId:null,state:'uncertain'});
 for(const source of [failed,uncertain])assert.equal((await f.run(proposal(source.id))).reason,'experience-source-not-supported');
 const own=f.add({role:'assistant',source:'conversation-turns',senderId:null,event:'ack-hidden',body:'Synthetic own message later acknowledged.'});
 const text=f.store.get({id:own.id}).text;for(let i=0;i<25;i++)f.store.recordMessage({scope:GROUP,event:'ack-hidden',role:'assistant',text,at:NOW-60000,source:'aaa-preview-'+String(i).padStart(2,'0')});
 f.store.recordMessage({scope:GROUP,event:'ack-hidden',role:'assistant',text,at:NOW-60000,source:'acknowledged-qq-outgoing',senderId:SELF});
 assert.ok(!f.store.get({id:own.id}).sources.some(s=>s.source==='acknowledged-qq-outgoing'));
 const saved=await f.run(proposal(own.id));assert.equal(saved.status,'saved');assert.ok(saved.source_refs[0].sources.includes('acknowledged-qq-outgoing'));assert.equal(saved.source_refs[0].author.id,SELF);
});

test('lifecycle and protected kind/key guards prevent writes; retirement requires an existing state',async t=>{
 const f=fixture(t),source=f.add(),before=f.store.counts();
 await assert.rejects(()=>f.run(proposal(source.id),{canAct:()=>false}),/paused/);const abort=new AbortController();abort.abort();await assert.rejects(()=>f.run(proposal(source.id),{signal:abort.signal}),{name:'AbortError'});
 for(const patch of [{kind:'mood'},{key:'guardian-permissions'},{key:'身份与核心'},{operation:'erase'}])assert.equal((await f.run(proposal(source.id,patch))).status,'rejected');
 const noPrior=await f.run(proposal(source.id,{operation:'retire',value:undefined}));assert.equal(noPrior.reason,'no-prior-reflection-to-correct-or-retire');assert.deepEqual(f.store.counts(),before);
 assert.equal(f.tool().name,'reflect_life_state');assert.ok(f.tool().parameters.required.includes('expected_revision'));
});

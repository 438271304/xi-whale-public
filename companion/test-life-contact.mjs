import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {UnifiedCognition} from './cognition-tools.mjs';
import {LifeContinuity} from './life-continuity.mjs';
import {queueLifeContact} from './life-contact.mjs';

const BOT='910810001',MOTHER='910810003',FATHER='910810002',DAY=Date.parse('2026-10-30T12:00:00+08:00');
const target={recipient:'mother',target_kind:'private',target_id:MOTHER,recipient_reason:'An actual shared detail made me think of Mom.'};
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'whale-life-contact-')),cognition=new UnifiedCognition(root,{botId:BOT,guardianIds:[FATHER,MOTHER]});
 const db=new DatabaseSync(join(root,'life.sqlite3'));let now=DAY,sequence=0;
 db.exec('CREATE TABLE activities(id TEXT PRIMARY KEY,topic TEXT,motivation TEXT,state TEXT,summary TEXT,created INTEGER,updated INTEGER); CREATE TABLE discoveries(id TEXT,activity TEXT,url TEXT,title TEXT,excerpt TEXT,at INTEGER)');
 const continuity=new LifeContinuity(db,{clock:()=>now});
 t.after(()=>{db.close();cognition.close();});
 const activity=()=>{const id='synthetic-contact-'+(++sequence);db.prepare("INSERT INTO activities VALUES(?,NULL,NULL,'planning','',?,?)").run(id,now,now);return id;};
 const human=({event='mother-message',text='合成原话：今天想慢慢来。',at=now-60000,revisionKind='observation'}={})=>cognition.store.recordMessage({
  scope:'private:'+MOTHER,event,role:'user',senderId:MOTHER,at,revisionKind,source:'live-transport',
  text:JSON.stringify({transport:{conversation:'private:'+MOTHER,sender_id:MOTHER,message_id:event,time:at/1000},body:text})});
 return {db,cognition,continuity,activity,human,get now(){return now;},advance(){now+=60000;},
  contact(evidenceIds,{activity:id=activity(),...options}={}){return queueLifeContact({db,continuity,store:cognition.store,activity:id,audience:target,text:'合成小汐想说的话：我想到那个细节了。',reason:'That actual experience made me want to tell Mom one small thought.',evidenceIds,clock:()=>now,
   inbound:address=>cognition.store.db.prepare("SELECT max(at) at FROM experiences WHERE scope=? AND role='user'").get(address).at??0,...options});},
  refs(id){return JSON.parse(db.prepare('SELECT refs FROM life_contact_sources WHERE activity=?').get(id).refs);},
 };
}

test('contact references keep exact source revisions, author/time and self-interpretation without rewriting a human claim into a new fact',t=>{
 const f=fixture(t),original=f.human(),corrected=f.human({text:'合成更正原话：我说的是想慢慢做这张卡片。',revisionKind:'correction'});
 assert.equal(corrected.id,original.id);assert.notEqual(corrected.revision,original.revision);
 const own=f.cognition.store.recordMessage({scope:'private:'+BOT,event:'own-project-version-2',role:'self',text:'A real stored fixture project version exists; this does not claim it executed.',at:f.now-1000,source:'own-workroom-change',metadata:{execution_verified:false,project_id:'fixture-project',version:2}});
 const id=f.activity(),result=f.contact([own.id,corrected.id,corrected.id],{activity:id});
 assert.equal(result.status,'contact-intention-saved');assert.equal(result.intent.state,'queued');assert.equal(result.ready,true);
 const refs=f.refs(id);assert.equal(refs.length,2);
 const mother=refs.find(ref=>ref.id===corrected.id),self=refs.find(ref=>ref.id===own.id);
 assert.equal(mother.revision,corrected.revision);assert.equal(mother.author.id,MOTHER);assert.equal(mother.author.kind,'human');
 assert.equal(mother.role,'user');assert.equal(mother.scope,'private:'+MOTHER);assert.equal(mother.at,f.now-60000);assert.equal(mother.evidence_kind,'direct-human-statement');
 assert.equal(self.role,'self');assert.equal(self.author.id,BOT);assert.equal(self.author.kind,'self');
 const intention=f.cognition.store.get({id:result.intent.evidence}),body=JSON.parse(intention.text);
 assert.equal(body.kind,'contact-intention');assert.deepEqual(body.source_refs,refs);assert.match(body.notice,/Own intention and interpretation.*not a new fact.*not a sent message/);
 assert.equal(body.recipient,'mother');assert.ok(!intention.text.includes('合成更正原话'));
 const storedSource=f.cognition.store.get({id:corrected.id,revision:corrected.revision,maxChars:4000});
 assert.match(storedSource.text,/合成更正原话/);assert.equal(storedSource.attribution.is_authoritative_fact,false);
 f.human({text:'Another later source correction.',revisionKind:'correction'});
 assert.equal(f.refs(id).find(ref=>ref.id===corrected.id).revision,corrected.revision,'A later source revision cannot rewrite the saved contact basis');
 assert.equal(JSON.parse(f.db.prepare('SELECT summary FROM activities WHERE id=?').get(id).summary).delivered,false);
 assert.equal(f.cognition.store.db.prepare("SELECT count(*) n FROM experiences WHERE role='assistant'").get().n,0,'Queueing contact never manufactures sent evidence');
});

test('nonexistent/future evidence and another contact intention cannot generate a new wish to contact',t=>{
 const f=fixture(t),source=f.human(),future=f.human({event:'future-fixture',at:f.now+1});
 const unknown='exp-'+'0'.repeat(32),count=f.cognition.store.counts().messages;
 for(const id of [unknown,future.id])assert.throws(()=>f.contact([id]),/existing nonfuture/);
 assert.equal(f.cognition.store.counts().messages,count);
 const first=f.contact([source.id]);
 assert.throws(()=>f.contact([first.intent.evidence]),/not another contact wish/);
 assert.equal(f.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,1);
});

test('the full provenance of an experience prevents contact-intention chaining even beyond the bounded source preview',t=>{
 const f=fixture(t),source=f.human(),first=f.contact([source.id]);
 const original=f.cognition.store.get({id:first.intent.evidence,maxChars:12000});
 for(let index=0;index<25;index++)f.cognition.store.recordMessage({scope:'unknown',event:original.event,role:'self',text:original.text,at:original.at,source:'aaa-preview-'+String(index).padStart(2,'0'),metadata:original.metadata});
 const preview=f.cognition.store.get({id:first.intent.evidence,maxChars:1});
 assert.equal(preview.sources.length,20);assert.ok(!preview.sources.some(source=>source.source==='life-contact-intention'),'This fixture must actually hide the disqualifying source from the bounded preview');
 const before=f.db.prepare('SELECT count(*) n FROM life_share_intents').get().n;
 assert.throws(()=>f.contact([first.intent.evidence]),/not another contact wish/);
 assert.equal(f.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,before);
});

test('a queued same-basis/recipient contact reuses its original intent, reason and timing instead of making duplicate messages',t=>{
 const f=fixture(t),source=f.human(),first=f.contact([source.id]);
 f.continuity.defer(first.intent.id,'Family is busy.');
 const postponed=f.continuity.get(first.intent.id),before=f.cognition.store.counts().messages;
 const second=f.contact([source.id],{text:'A replacement message must not create a new intent.'});
 assert.equal(second.status,'existing-intention');assert.equal(second.ready,false);assert.deepEqual(second.intent,postponed);
 assert.equal(f.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM life_contact_sources').get().n,1);assert.equal(f.cognition.store.counts().messages,before);
});

test('sent contact never chases by elapsed time; actual later inbound from its exact recipient permits a new same-basis contact',t=>{
 const f=fixture(t),source=f.human(),first=f.contact([source.id]);
 f.continuity.begin(first.intent.id,'synthetic-attempt');f.continuity.settle(first.intent.id,'sent',{message_id:42});
 f.advance();const blocked=f.contact([source.id]);assert.equal(blocked.status,'already-contacted-no-chase');assert.equal(blocked.intent,null);
 f.cognition.store.recordMessage({scope:'private:'+FATHER,event:'other-parent-inbound',role:'user',senderId:FATHER,text:'An actual fixture reply from a different parent.',at:f.now,source:'live-transport'});
 assert.equal(f.contact([source.id]).status,'already-contacted-no-chase');
 f.human({event:'mother-actually-returned',at:f.now,text:'合成真实后续入站：我回来啦。'});
 const next=f.contact([source.id]);assert.equal(next.status,'contact-intention-saved');assert.notEqual(next.intent.id,first.intent.id);assert.equal(next.intent.state,'queued');
 assert.equal(f.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,2);
});

test('uncertain or in-flight contact stays no-chase and is not converted into a new sent fact',t=>{
 for(const state of ['sending','uncertain']){
  const f=fixture(t),source=f.human(),first=f.contact([source.id]);f.continuity.begin(first.intent.id,'synthetic-attempt');
  if(state==='uncertain')f.continuity.settle(first.intent.id,'uncertain');
  f.advance();const result=f.contact([source.id]);assert.equal(result.status,'already-contacted-no-chase');assert.equal(result.intent,null);
  assert.equal(f.continuity.get(first.intent.id).state,state);assert.equal(f.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,1);
  assert.equal(f.cognition.store.db.prepare("SELECT count(*) n FROM experiences WHERE role='assistant'").get().n,0);
 }
});

test('retargeted contact deduplicates its actual mother destination, while a never-contacted father can receive a fresh same-source intention',t=>{
 for(const state of ['sent','uncertain']){
  const f=fixture(t),source=f.human();
  const father={recipient:'father',target_kind:'private',target_id:FATHER,recipient_reason:'This source initially made me think of Dad.'};
  const first=f.contact([source.id],{audience:father});assert.equal(first.intent.recipient,'father');
  const moved=f.continuity.reconsider(first.intent.id,{decision:'share',reason:'I now want to tell Mom instead.',...target},f.continuity.pending());
  assert.equal(moved.id,first.intent.id);assert.equal(moved.recipient,'mother');assert.equal(moved.target_id,MOTHER);
  const sameQueued=f.contact([source.id]);assert.equal(sameQueued.status,'existing-intention');assert.equal(sameQueued.intent.id,moved.id);
  f.continuity.begin(moved.id,'synthetic-retargeted-attempt');f.continuity.settle(moved.id,state,state==='sent'?{message_id:42}:null);
  f.advance();
  const motherAgain=f.contact([source.id]);assert.equal(motherAgain.status,'already-contacted-no-chase');assert.equal(motherAgain.intent,null);
  assert.equal(f.continuity.get(moved.id).target_id,MOTHER);assert.equal(f.continuity.get(moved.id).state,state);
  const fatherFirst=f.contact([source.id],{audience:father});
  assert.equal(fatherFirst.status,'contact-intention-saved');assert.equal(fatherFirst.intent.state,'queued');assert.equal(fatherFirst.intent.target_id,FATHER);
  assert.notEqual(fatherFirst.intent.id,moved.id);
  const bases=f.db.prepare('SELECT basis FROM life_contact_sources').all();assert.equal(bases.length,2);assert.equal(bases[0].basis,bases[1].basis,'The source basis is independent of historical recipient labels');
  assert.equal(f.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,2);
 }
});

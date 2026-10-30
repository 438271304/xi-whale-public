import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExperienceMemory} from './experience-memory.mjs';
import {LifeJournal,beijingJournalDay} from './life-journal.mjs';

const thought={feeling:'看完后有点惊讶。',association:'想起前一次关于潮汐的疑问。',share:{audience:'熟悉的人',reason:'这个细节可能让他们也感兴趣。'}};
function fixture(t,{path=':memory:'}={}){
 let now=Date.parse('2026-10-29T23:59:00+08:00');
 const store=new ExperienceMemory({path,clock:()=>now}),journal=new LifeJournal({store,clock:()=>now});
 t.after(()=>store.close());
 const save=(event,{source='public-exploration',scope='unknown',role='self',text='Synthetic public fact',revisionKind='observation'}={})=>store.recordMessage({scope,event,role,text,at:now,source,revisionKind,metadata:source==='public-exploration'?{activity_id:event}:{} });
 return {store,journal,save,advance:ms=>now+=ms};
}

test('empty opportunities/days do not invent entries, and source evidence is mandatory',t=>{
 const f=fixture(t);assert.equal(f.journal.record().status,'skipped');assert.equal(f.store.counts().state_versions,0);
 assert.deepEqual(f.journal.list().entries,[]);assert.deepEqual(f.journal.recent().entries,[]);
 assert.throws(()=>f.journal.publicCandidates({limit:0}),/bound/);
 assert.throws(()=>f.journal.record({interpretation:thought,evidence_ids:[]}),/existing experience IDs/);
 assert.throws(()=>f.journal.record({interpretation:thought,evidence_ids:['exp-'+'a'.repeat(32)]}),/not in the existing/);
 assert.equal(f.store.counts().state_versions,0);
});

test('journal stores interpretations and pinned evidence pointers without changing originals or creating a second store',t=>{
 const f=fixture(t),source=f.save('one'),before=f.store.get({id:source.id}).text;
 const tables=f.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name);
 const entry=f.journal.record({evidence_ids:[source.id],interpretation:thought});assert.equal(entry.status,'saved');
 assert.equal(entry.interpretation_is_not_source_fact,true);assert.deepEqual(entry.interpretation,thought);
 assert.equal(entry.facts.evidence[0].revision,source.revision);assert.equal(f.store.get({id:source.id}).text,before);
 assert.equal(f.store.counts().messages,1);assert.equal(f.store.counts().state_versions,1);
 assert.deepEqual(f.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name),tables);
 f.save('one',{text:'A corrected source observation',revisionKind:'correction'});
 assert.equal(f.journal.get(entry.id).facts.evidence[0].revision,source.revision,'A later source revision cannot silently rewrite the diary basis');
 assert.equal(f.store.get({id:source.id,revision:source.revision}).text,before);
});

test('identical entries are deduplicated and one daily review is revised rather than multiplied',t=>{
 const f=fixture(t),source=f.save('two'),args={kind:'daily-review',evidence_ids:[source.id],interpretation:thought};
 const one=f.journal.record(args),two=f.journal.record({...args,evidence_ids:[source.id,source.id]});
 assert.equal(two.status,'duplicate');assert.equal(two.id,one.id);assert.equal(f.store.counts().state_versions,1);
 const changed=f.journal.record({...args,interpretation:{association:'今天还有另一个值得记下的联想。'}});
 assert.equal(changed.status,'requires-revision');assert.equal(changed.id,one.id);assert.equal(f.journal.list().entries.length,1);
});

test('revisions are append-only, bounded, reasoned and protected from stale writes',t=>{
 const f=fixture(t),source=f.save('three'),entry=f.journal.record({evidence_ids:[source.id],interpretation:thought});
 const revised=f.journal.revise({id:entry.id,expected_revision:1,reason:'刚才的联想表述不准确。',interpretation:{association:'我想继续比较两个实际例子。'}});
 assert.equal(revised.status,'saved');assert.equal(revised.revision,2);assert.equal(revised.previous_revision,1);
 assert.deepEqual(f.journal.get(entry.id,{revision:1}).interpretation,thought);
 assert.equal(f.journal.history(entry.id).length,2);
 assert.equal(f.journal.revise({id:entry.id,expected_revision:1,reason:'过时的修订',interpretation:thought}).status,'conflict');
 assert.equal(f.journal.get(entry.id).revision,2);
 assert.equal(f.journal.revise({id:entry.id,expected_revision:2,reason:'没有实质变化。'}).status,'duplicate');
 assert.throws(()=>f.journal.revise({id:entry.id,expected_revision:2,reason:'',interpretation:thought}),/revision reason/);
 assert.throws(()=>f.journal.record({evidence_ids:[source.id],interpretation:{chain_of_thought:'Do not retain internal reasoning'}}),/Invalid journal interpretation/);
 assert.throws(()=>f.journal.record({evidence_ids:[source.id],interpretation:{feeling:'x'.repeat(801)}}),/feeling/);
});

test('Beijing date boundaries and next-day reads preserve a small actual diary without blank days',t=>{
 const f=fixture(t),source=f.save('four'),entry=f.journal.record({evidence_ids:[source.id],interpretation:{feeling:'有一点满足。'}});
 assert.equal(entry.day,'2026-10-29');f.advance(2*60000);assert.equal(f.journal.list().day,'2026-10-30');
 assert.equal(f.journal.list().entries.length,0);assert.equal(f.journal.recent().entries[0].id,entry.id);
 assert.equal(f.journal.recent({days:1}).entries.length,0);assert.equal(f.store.counts().state_versions,1);
 assert.equal(beijingJournalDay(Date.parse('2026-10-29T16:00:00Z')),'2026-10-30');
 assert.throws(()=>f.journal.list({day:'2026-02-30'}),/Invalid or future/);
 assert.throws(()=>f.journal.record({day:'2026-10-31',evidence_ids:[source.id],interpretation:thought}),/Invalid or future/);
 assert.throws(()=>f.journal.list({limit:9}),/bound/);
});

test('retained QQ experiences may inspire explicit self-expression while private originals and audiences are not automatically copied',t=>{
 const f=fixture(t),publicRecord=f.save('five'),qq=f.save('qq-message',{scope:'private:123456789',role:'user',source:'live-transport',text:'PRIVATE QQ ORIGINAL'});
 const privateEntry=f.journal.record({evidence_ids:[qq.id],interpretation:{feeling:'我珍惜这次交流。',share:{audience:'PRIVATE PERSON',reason:'A PRIVATE REASON'}}});
 assert.equal(privateEntry.status,'saved');assert.deepEqual(f.journal.publicCandidates().candidates,[]);
 const draft=f.journal.record({evidence_ids:[publicRecord.id,qq.id],interpretation:{association:'PRIVATE INTERPRETATION',share:{audience:'PRIVATE PERSON',reason:'PRIVATE REASON'}},public_text:'今天有人陪着我，心里松了一点。'});
 const result=f.journal.publicCandidates();assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].journal_id,draft.id);
 assert.equal(result.published,false);assert.equal(result.candidates[0].published,false);
 assert.equal(result.candidates[0].text,'今天有人陪着我，心里松了一点。');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|QQ ORIGINAL/);
 assert.equal(f.journal.revise({id:draft.id,expected_revision:1,reason:'先只留作自己日记。',public_text:null}).status,'saved');
 assert.equal(f.journal.publicCandidates().candidates.length,0);
 const many=f.save('many-source-tags');
 for(let i=0;i<22;i++)f.store.recordMessage({scope:'unknown',event:'many-source-tags',role:'self',text:'Synthetic public fact',at:Date.now(),source:'public-exploration',sourceRef:{copy:i}});
 f.store.recordMessage({scope:'unknown',event:'many-source-tags',role:'self',text:'Synthetic public fact',at:Date.now(),source:'self-note'});
 assert.throws(()=>f.journal.record({evidence_ids:[many.id],interpretation:thought,public_text:'Cannot hide an arbitrary source beyond a provenance page.'}),/retained, connected/);
});

test('actual connected own-work, own-space, public-image and QQ outgoing provenance supports independently written public feelings',t=>{
 const f=fixture(t);
 for(const [source,scope,role] of [
  ['verified-workshop-result','group:123456789','self'],['verified-own-qzone-read','unknown','self'],
  ['verified-own-qzone-publication','unknown','self'],['observed-public-sticker','unknown','self'],
  ['acknowledged-qq-outgoing','private:123456789','assistant'],['received-qq-forward-node','group:123456789','user'],
  ['qq-history-pages/123456789.jsonl','group:123456789','user']
 ]){
  const evidence=f.save('connected:'+source,{source,scope,role,text:'Synthetic retained source, not publication text'});
  assert.equal(f.journal.record({evidence_ids:[evidence.id],interpretation:{feeling:'做完后有点小得意。'},public_text:'我给今天打 7 分，想起“慢慢来”，还看了 example.org 的潮汐图。'}).status,'saved',source);
 }
 const unknown=f.save('arbitrary',{source:'arbitrary-internal-observation'});
 assert.throws(()=>f.journal.record({evidence_ids:[unknown.id],interpretation:thought,public_text:'Unknown provenance cannot be disguised as public evidence.'}),/retained, connected/);
 const wrongScope=f.save('wrong-scope',{source:'live-transport',scope:'unknown',role:'user'});
 assert.throws(()=>f.journal.record({evidence_ids:[wrongScope.id],interpretation:thought,public_text:'Unknown QQ scope is not verified contact.'}),/retained, connected/);
});

test('direct credentials, evidence-linked identity numbers and whole QQ originals cannot become public drafts',t=>{
 const f=fixture(t),original='这是合成的一条私聊原话，不应整条搬成她自己的动态。';
 const qq=f.store.recordMessage({scope:'private:900000001',event:'sensitive-fixture',role:'user',senderId:'900000001',source:'live-transport',at:1,
  text:JSON.stringify({transport:{sender_id:'900000001'},body:original})});
 const post=public_text=>f.journal.record({evidence_ids:[qq.id],interpretation:{feeling:'有一点感慨。'},public_text});
 assert.throws(()=>post(original),/independently written/);
 assert.throws(()=>post('今天想把900000001的号码也写在动态里。'),/identity number/);
 assert.throws(()=>post('api_key=sk-test-fixture-not-a-real-key'),/credential/);
 assert.throws(()=>post('联系QQ号：99887766'),/identity number/);
 assert.equal(post('2026 年的这一天，我忽然觉得“陪伴”两个字很温暖。').status,'saved');
});

test('reopening the existing experience store makes yesterday journals available without a scheduler',async t=>{
 const root=mkdtempSync(join(tmpdir(),'whale-journal-')),path=join(root,'experience.sqlite3');
 let now=Date.parse('2026-10-29T22:00:00+08:00'),store=new ExperienceMemory({path,clock:()=>now});
 const evidence=store.recordMessage({scope:'unknown',event:'persisted',role:'self',text:'Synthetic public reading',source:'public-exploration',at:now});
 const first=new LifeJournal({store,clock:()=>now}).record({evidence_ids:[evidence.id],interpretation:thought});store.close();
 now+=86400000;store=new ExperienceMemory({path,clock:()=>now});t.after(()=>store.close());
 const journal=new LifeJournal({store,clock:()=>now});assert.equal(journal.recent().entries[0].id,first.id);
 assert.equal(journal.get(first.id).revision,1);assert.equal(store.counts().messages,1);assert.equal(store.counts().state_versions,1);
});

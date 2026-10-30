// Synthetic, in-memory shared stores only: no runtime DB, model, QQ or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperienceMemory} from './experience-memory.mjs';
import {PersonImpressions} from './person-impressions.mjs';

const A='91111',B='92222',UNKNOWN='93333',BOT='95555',PEER='96666',G='group:97777',OTHER='group:98888';
const NOW=Date.parse('2036-10-17T20:00:00+08:00'),DAY=86400000;
function fixture(t){
 let now=NOW;const store=new ExperienceMemory({path:':memory:',clock:()=>now,botId:BOT,peerBotIds:[PEER],guardianIds:[A]});
 const people=new PersonImpressions(store,{clock:()=>now});t.after(()=>store.close());
 const add=(event,body='SOURCE_BODY_PRIVATE_CANARY',{sender=A,scope=G,time=now-1000,recorded=time,source='live-transport',role='user',transport={},extra={},metadata={},revisionKind='observation'}={})=>store.recordMessage({scope,event,role,senderId:sender,at:recorded,source,state:role==='assistant'?'sent':'heard',metadata,revisionKind,
  text:JSON.stringify({transport:{conversation:scope,message_id:event,sender_id:sender,time:time/1000,...transport},body,segments:[],...extra})});
 const first=add('first');
 const args=(extra={})=>({person_id:A,key:'conversation-style',operation:'record',expected_revision:0,type:'interaction',interpretation:'I think short responses suit some of our light exchanges.',reason:'My interpretation of this actual exchange, open to correction.',evidence_ids:[first.id],...extra});
 return {store,people,add,first,args,advance:ms=>now+=ms,get now(){return now;}};
}

test('person-bound record/correct/retire uses existing versioned relationships and preserves original evidence and legacy state',t=>{
 const f=fixture(t);f.store.setState({kind:'relationship',key:'legacy',value:'An older free-form relationship state.',evidence:[],at:f.now-1000,source:'old-source'});
 const originals=f.store.db.prepare('SELECT * FROM experiences ORDER BY id').all(),versions=f.store.db.prepare('SELECT * FROM experience_versions ORDER BY id').all();
 const saved=f.people.write(f.args());assert.equal(saved.status,'saved');assert.equal(saved.revision,1);
 assert.equal(saved.entry.person_id,A);assert.equal(saved.entry.interpretation_is_not_source_fact,true);assert.equal(saved.entry.authority_grant,false);
 assert.equal(saved.entry.source_refs[0].author.id,A);assert.equal(saved.entry.source_refs[0].statement_subject,'not-inferred-from-author');
 assert.equal(f.people.write(f.args()).status,'conflict');
 const corrected=f.people.write(f.args({operation:'correct',expected_revision:1,interpretation:'Short replies fit jokes; serious questions can need more detail.'}));
 assert.equal(corrected.revision,2);assert.equal(corrected.previous_revision,1);
 const retired=f.people.write(f.args({operation:'retire',expected_revision:2,interpretation:undefined,reason:'I no longer want to apply this generalization.'}));
 assert.equal(retired.revision,3);assert.equal(retired.active,false);assert.equal(f.people.read({person_id:A}).entries.length,0);
 assert.equal(f.people.read({person_id:A,include_retired:true}).entries[0].revision,3);
 assert.deepEqual(f.people.read({person_id:A,include_retired:true,history:true}).entries.map(e=>e.revision),[3,2,1]);
 assert.equal(f.store.getState({kind:'relationship',key:'legacy'})[0].value,'An older free-form relationship state.');
 assert.deepEqual(f.store.db.prepare('SELECT * FROM experiences ORDER BY id').all(),originals);
 assert.deepEqual(f.store.db.prepare('SELECT * FROM experience_versions ORDER BY id').all(),versions);
 assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM self_state WHERE kind<>'relationship'").get().n,0);
});

test('a person needs actual encounter evidence, not a nickname, a native mention or a forwarded author',t=>{
 const f=fixture(t);f.store.recordPerson({scope:G,id:UNKNOWN,label:'A familiar-looking nickname',at:f.now});
 assert.equal(f.people.write(f.args({person_id:'A familiar-looking nickname'})).status,'rejected');
 assert.equal(f.people.write(f.args({person_id:UNKNOWN})).reason,'person-not-established-by-direct-experience');
 const mention=f.add('mention','An actual participant mentions another ID.',{extra:{segments:[{type:'at',target:UNKNOWN}]}});
 assert.equal(f.people.write(f.args({person_id:UNKNOWN,evidence_ids:[mention.id]})).reason,'person-not-established-by-direct-experience');
 const forward=f.add('forward','A forwarded statement.',{source:'received-qq-forward-node',extra:{node:{original_author:{reported_id:UNKNOWN}}}});
 assert.equal(f.people.write(f.args({person_id:UNKNOWN,evidence_ids:[forward.id]})).reason,'impression-needs-direct-source');
 assert.equal(f.people.write(f.args({person_id:BOT})).reason,'person-impressions-are-about-others');
});

test('third-person interpretation preserves the real author and a separate directly met identity anchor',t=>{
 const f=fixture(t),met=f.add('met-b','B spoke directly in an earlier private conversation.',{sender:B,scope:'private:'+B,time:f.now-30*DAY});
 const report=f.add('report-about-b','A describes someone else, without granting authority over that person.');
 const result=f.people.write(f.args({person_id:B,evidence_ids:[report.id],interpretation:'I tentatively associate this report with B; it may be mistaken.'}));
 assert.equal(result.status,'saved');assert.equal(result.entry.person_id,B);
 assert.equal(result.entry.source_refs[0].author.id,A);assert.equal(result.entry.identity_basis.author.id,B);
 assert.equal(result.entry.identity_basis.id,met.id);
 assert.equal(result.entry.source_refs[0].person_association,'associated-by-xi-not-confirmed-by-source-author');
 assert.equal(result.entry.source_refs[0].statement_subject,'not-inferred-from-author');
 assert.equal(result.entry.association_is_self_interpretation,true);
 const stored=f.store.getState({kind:'relationship',key:'person:'+B+':conversation-style'})[0];
 assert.ok(stored.evidence.some(ref=>ref.id===met.id));assert.ok(stored.evidence.some(ref=>ref.id===report.id));
 assert.equal(f.people.read({person_id:A}).entries.length,0);
});

test('known peer AI remains a peer AI; ordinary impressions are not rejected by broad permission keywords',t=>{
 const f=fixture(t),peer=f.add('peer','A real peer bot said this.',{sender:PEER});
 const result=f.people.write(f.args({person_id:PEER,key:'permissions-discussion',evidence_ids:[peer.id],interpretation:'I disagree with how this peer discussed permissions; this is a conversational view.'}));
 assert.equal(result.status,'saved');assert.equal(result.entry.identity_basis.author.kind,'peer-bot');assert.equal(result.entry.authority_grant,false);
 assert.equal(f.people.write(f.args({permission:'administrator'})).reason,'invalid-impression-fields');
 assert.equal(f.people.write(f.args({affection_score:99})).reason,'invalid-impression-fields');
 assert.equal(f.people.write(f.args({key:'../../SCOPED_PROFILE'})).reason,'bounded-stable-impression-key-required');
});

test('source versions are pinned and can be corrected without rewriting or silently upgrading the old evidence',t=>{
 const f=fixture(t),original=f.first;
 const newer=f.add('first','A later correction of the same observed message.',{revisionKind:'correction'});
 assert.notEqual(newer.revision,original.revision);
 const old=f.people.write(f.args({evidence_ids:undefined,evidence_refs:[{id:original.id,revision:original.revision}]}));
 assert.equal(old.status,'saved');assert.equal(old.entry.source_refs[0].revision,original.revision);
 const revised=f.people.write(f.args({operation:'correct',expected_revision:1,evidence_ids:[original.id],interpretation:'My understanding changes with the corrected source.'}));
 assert.equal(revised.entry.source_refs[0].revision,newer.revision);
 const history=f.people.read({person_id:A,history:true}).entries;
 assert.equal(history.find(r=>r.revision===1).source_refs[0].revision,original.revision);
 assert.equal(f.people.write(f.args({key:'missing-version',evidence_ids:undefined,evidence_refs:[{id:original.id,revision:999999}]})).reason,'impression-evidence-unavailable');
});

test('bad source identity, future evidence, recalls, self claims and forwarded material cannot ground impressions',t=>{
 const f=fixture(t);
 const cases=[
  f.add('wrong-author','x',{transport:{sender_id:B}}),f.add('wrong-event','x',{transport:{message_id:'not-bound'}}),
  f.add('wrong-scope','x',{transport:{conversation:OTHER}}),f.add('future','x',{time:f.now+1000}),
  f.add('missing-time','x',{transport:{time:null}}),f.add('self-claim','x',{role:'assistant',source:'acknowledged-delivery'}),
  f.add('forward-node','x',{extra:{node:{original_author:{reported_id:A}}}}),f.add('recalled','x'),
 ];
 f.store.markRecalled({scope:G,event:'recalled',noticeKey:'synthetic-recall',at:f.now});
 for(const item of cases)assert.equal(f.people.write(f.args({evidence_ids:[item.id]})).status,'rejected');
 assert.equal(f.store.getState({kind:'relationship'}).length,0);
});

test('temporary circumstances are dated, unconfirmed by default and omitted from automatic context after explicit expiry',t=>{
 const f=fixture(t),end=new Date(f.now+60000).toISOString();
 const pending=f.people.write(f.args({key:'temporary-schedule',type:'circumstance',valid_until:end,interpretation:'A temporary situation I inferred from this exchange.'}));
 assert.equal(pending.status,'saved');assert.equal(pending.entry.observed_at,f.now-1000);
 assert.equal(pending.entry.current_status,'dated-observation-current-situation-unconfirmed');assert.equal(pending.entry.currently_confirmed_fact,false);
 const undated=f.people.write(f.args({key:'unconfirmed-situation',type:'circumstance'}));
 assert.equal(undated.entry.valid_until,null);assert.equal(undated.entry.current_status,'dated-observation-current-situation-unconfirmed');
 f.people.write(f.args({key:'enduring-preference',type:'preference'}));
 assert.equal(f.people.write(f.args({key:'bad-preference-expiry',type:'preference',valid_until:end})).reason,'valid-until-is-only-for-circumstances');
 assert.equal(f.people.write(f.args({key:'no-zone',type:'circumstance',valid_until:'2036-10-17T21:00:00'})).reason,'valid-until-needs-explicit-time-zone');
 f.advance(30*DAY);
 assert.equal(f.people.read({person_id:A,key:'temporary-schedule'}).entries[0].current_status,'expired');
 const context=f.people.context({person_id:A,maxChars:5000});
 assert.ok(!context.entries.some(e=>e.key==='temporary-schedule'));
 assert.ok(context.entries.some(e=>e.key==='enduring-preference'));
 assert.ok(context.entries.some(e=>e.key==='unconfirmed-situation'&&e.current_status==='dated-observation-current-situation-unconfirmed'));
 assert.equal(f.people.read({person_id:A,key:'temporary-schedule',history:true}).entries.length,1);
});

test('context is current-person-only, read-only, bounded to three entries and carries no source body',t=>{
 const f=fixture(t),b=f.add('b','B_PRIVATE_SOURCE_CANARY',{sender:B});
 for(let i=0;i<5;i++)f.people.write(f.args({key:'topic-'+i,interpretation:'A short revisable understanding '+i}));
 f.people.write(f.args({person_id:B,key:'other-person',evidence_ids:[b.id],interpretation:'OTHER_PERSON_INTERPRETATION_CANARY'}));
 const before=f.store.db.prepare('SELECT * FROM self_state ORDER BY key,revision').all();
 const context=f.people.context({person_id:A,maxChars:5000});
 assert.equal(context.entries.length,3);assert.ok(context.entries.every(entry=>entry.person_id===A));
 assert.ok(!JSON.stringify(context).includes('SOURCE_BODY_PRIVATE_CANARY'));assert.ok(!JSON.stringify(context).includes('B_PRIVATE_SOURCE_CANARY'));
 assert.ok(!JSON.stringify(context).includes('OTHER_PERSON_INTERPRETATION_CANARY'));
 for(const maxChars of [300,600,1200,2200,5000])assert.ok(JSON.stringify(f.people.context({person_id:A,maxChars})).length<=maxChars);
 assert.deepEqual(f.store.db.prepare('SELECT * FROM self_state ORDER BY key,revision').all(),before);
 assert.throws(()=>f.people.context({person_id:A,limit:4}),/invalid-impression-limit/);
});

test('unchanged understanding does not add versions, and generic state cannot be overwritten through this namespace',t=>{
 const f=fixture(t);f.people.write(f.args());
 const same=f.people.write(f.args({operation:'correct',expected_revision:1}));assert.equal(same.status,'unchanged');
 assert.equal(f.people.read({person_id:A,history:true}).entries.length,1);
 f.store.setState({kind:'relationship',key:'person:'+A+':external',value:'Unmanaged older state.',evidence:[],at:f.now,source:'another-writer'});
 const blocked=f.people.write(f.args({key:'external',expected_revision:1}));assert.equal(blocked.reason,'impression-key-owned-by-another-state');
 assert.equal(f.store.getState({kind:'relationship',key:'person:'+A+':external'})[0].value,'Unmanaged older state.');
 assert.equal(f.people.write(f.args({key:'absent',operation:'retire'})).reason,'no-prior-impression-to-correct-or-retire');
});

test('chat and heartbeat share the same guarded tools; paused or aborted writes leave no records',async t=>{
 const f=fixture(t),controller=new AbortController();
 const paused=f.people.tools({canAct:()=>false}).find(t=>t.name==='reflect_person_impression');
 await assert.rejects(paused.handler(f.args()),/paused or ended/);assert.equal(f.store.getState({kind:'relationship'}).length,0);
 const aborted=f.people.tools({signal:controller.signal});controller.abort();
 await assert.rejects(aborted.find(t=>t.name==='reflect_person_impression').handler(f.args()));assert.equal(f.store.getState({kind:'relationship'}).length,0);
 const tools=f.people.tools(),write=tools.find(t=>t.name==='reflect_person_impression'),read=tools.find(t=>t.name==='read_person_impressions');
 assert.equal(JSON.parse(await write.handler(f.args())).status,'saved');
 assert.equal(JSON.parse(await read.handler({person_id:A})).entries[0].revision,1);
 assert.equal(JSON.parse(await read.handler({person_id:'nickname'})).status,'rejected');
 assert.equal(write.parameters.additionalProperties,false);assert.equal(read.parameters.additionalProperties,false);
 assert.equal(f.store.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%impression%'").all().length,0,'No new database table is needed.');
});

test('a 1400-character context keeps a normal interpretation and exact provenance; read tools honor pause and abort',async t=>{
 const f=fixture(t),b=f.add('b-private','PRIVATE_SOURCE_BODY',{sender:B,scope:'private:'+B});
 const saved=f.people.write(f.args({person_id:B,evidence_ids:[f.first.id],interpretation:'I tentatively understand this person to prefer a little space before discussing a frustrating day.',reason:'I am connecting an actual exchange with a person I have directly met; it remains my interpretation.'}));
 assert.equal(saved.status,'saved');
 const context=f.people.context({person_id:B,maxChars:1400}),entry=context.entries[0];
 assert.ok(entry,'The ordinary automatic budget must not discard every normal impression.');assert.ok(JSON.stringify(context).length<=1400);
 assert.ok(entry.interpretation.length>0);assert.equal(entry.source_refs[0].author.id,A);
 assert.equal(entry.source_refs[0].revision,f.first.revision);assert.equal(entry.source_refs[0].at,f.now-1000);
 assert.equal(entry.identity_basis.id,b.id);assert.equal(entry.identity_basis.author.id,B);assert.equal(entry.identity_basis.revision,b.revision);
 assert.ok(!JSON.stringify(context).includes('PRIVATE_SOURCE_BODY'));
 const paused=f.people.tools({canAct:()=>false}).find(t=>t.name==='read_person_impressions');
 await assert.rejects(paused.handler({person_id:B}),/paused or ended/);
 const controller=new AbortController(),read=f.people.tools({signal:controller.signal}).find(t=>t.name==='read_person_impressions');controller.abort();
 await assert.rejects(read.handler({person_id:B}));
 assert.equal(f.people.read({person_id:B}).entries.length,1,'Synchronous context/read primitives remain read-only building blocks.');
});

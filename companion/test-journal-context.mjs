import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {UnifiedCognition} from './cognition-tools.mjs';
import {conversationCapabilities} from './conversation-capabilities.mjs';

const A='900000001',B='900000008',BOT='900000004',GROUP='900000002';
const scope={kind:'private',id:A};
function fixture(t){
 let now=Date.parse('2026-10-30T12:00:00+08:00');
 const c=new UnifiedCognition(mkdtempSync(join(tmpdir(),'whale-journal-context-')),{botId:BOT,guardianIds:[A],clock:()=>now});t.after(()=>c.close());
 const message=(sender,event,body,{where='group:'+GROUP,display='同一个显示名',source='live-transport'}={})=>c.store.recordMessage({scope:where,event,role:'user',senderId:sender,at:now-60000,source,text:JSON.stringify({transport:{conversation:where,sender_id:sender,message_id:event,time:(now-60000)/1000,display_name:display,group:{name:'相同群名'}},body,segments:[{type:'text',text:body}]})});
 const diary=(evidence,thought)=>c.journal.record({evidence_ids:[evidence.id],interpretation:thought});
 const current=(sender,body)=>JSON.stringify({transport:{conversation:'private:'+sender,sender_id:sender,message_id:'now',time:now/1000,display_name:'同一个显示名',group:{name:'相同群名'}},body,segments:[{type:'text',text:body}]});
 return {c,message,diary,current,advance:()=>now+=1000};
}

test('journal entries do not displace mood, interest or ordinary self-state and remain explicitly readable',t=>{
 const f=fixture(t),source=f.message(A,'one','A synthetic conversation');
 f.c.store.setState({kind:'mood',key:'now',value:'平静',evidence:[{type:'message',id:source.id}]});
 f.c.store.setState({kind:'interest',key:'ocean',value:'潮汐',evidence:[{type:'message',id:source.id}]});
 f.c.store.setState({kind:'self',key:'own-note',value:'A useful ordinary state',evidence:[{type:'message',id:source.id}]});
 const first=f.diary(source,{feeling:'这次相处让我安心。'});
 for(let i=0;i<8;i++){f.advance();f.diary(source,{association:'新的合成联想 '+i});}
 const states=f.c.store.contextState({limit:5});assert.ok(states.some(x=>x.kind==='mood'));assert.ok(states.some(x=>x.kind==='interest'));assert.ok(states.some(x=>x.key==='own-note'));assert.ok(states.every(x=>!x.key.startsWith('journal:')));
 const read=JSON.parse(f.c.tools(scope,'now').find(x=>x.name==='read_life_journal').handler({id:first.id}));
 assert.equal(read.entries[0].id,first.id);assert.equal(read.entries[0].sources[0].author.id,A);assert.equal(read.entries[0].interpretation_is_not_source_fact,true);
 assert.equal(f.c.contextEvidence(scope).operation,'read-life-journal');assert.equal(f.c.contextEvidence(scope).journal[0].id,first.id);
});

test('actual author identity links a group diary into a private conversation, while shared display/group names do not',t=>{
 const f=fixture(t),source=f.message(A,'two','PRIVATE_SOURCE_CANARY 关于一次相处的原话'),diary=f.diary(source,{feeling:'那次交流让我放松。'});f.advance();
 const own=f.c.journalContext.select({scope,current:f.current(A,'你好')});assert.equal(own.entries[0].id,diary.id);assert.ok(own.entries[0].match_basis.includes('current-source-author'));
 const other=f.c.journalContext.select({scope:{kind:'private',id:B},current:f.current(B,'午饭吃什么')});assert.equal(other.entries.length,0);
 const groupCurrent=JSON.parse(f.current(B,'午饭吃什么'));groupCurrent.transport.conversation='group:'+GROUP;
 const groupContext=JSON.parse(f.c.context({kind:'group',id:GROUP},{event:'now',text:JSON.stringify(groupCurrent)}).split('\n')[2]);
 assert.ok(!groupContext.relevant_journal,'A general memory page filled by recent group messages does not make an unrelated diary relevant');
 assert.doesNotMatch(JSON.stringify(own),/PRIVATE_SOURCE_CANARY/);assert.equal(own.entries[0].sources[0].scope,'group:'+GROUP);assert.equal(own.entries[0].sources[0].author.id,A);
});

test('a retained source ID or a specific topic can recall an interpretation without a same-scope restriction',t=>{
 const f=fixture(t),publicSource=f.c.store.recordMessage({scope:'unknown',event:'activity:tide',role:'self',source:'public-exploration',at:1,text:JSON.stringify({summary:'潮汐受到月球引力影响。',sources:[{url:'https://example.org'}]})});
 const diary=f.diary(publicSource,{association:'我想继续比较不同地方的潮汐。'});f.advance();
 const byId=f.c.journalContext.select({scope,current:f.current(B,'换个话题'),relatedExperienceIds:[publicSource.id]});assert.equal(byId.entries[0].id,diary.id);
 const topical=f.c.journalContext.select({scope,current:f.current(B,'潮汐为什么每天有变化？')});assert.equal(topical.entries[0].id,diary.id);assert.ok(topical.entries[0].match_basis.includes('specific-topic'));
 const unrelated=f.c.journalContext.select({scope,current:f.current(B,'你今天心情感觉怎么样')});assert.equal(unrelated.entries.length,0);
});

test('automatic context is at most two brief interpretations, keeps the total payload bounded, and never writes state',t=>{
 const f=fixture(t),source=f.message(A,'three','PRIVATE_SOURCE_CANARY');
 for(let i=0;i<5;i++){f.diary(source,{feeling:'平静而好奇。'.repeat(40)+i,association:'这是一段比较长的合成联想。'.repeat(25)});f.advance();}
 const before=f.c.store.counts(),raw=f.current(A,'我来看看');
 const result=f.c.context(scope,{event:'now',text:raw});
 const payload=JSON.parse(result.split('\n')[2]);assert.ok(payload.relevant_journal.length>=1&&payload.relevant_journal.length<=2);assert.ok(JSON.stringify(payload).length<=7000);
 assert.doesNotMatch(JSON.stringify(payload.relevant_journal),/PRIVATE_SOURCE_CANARY/);assert.deepEqual(f.c.store.counts(),before);
 assert.equal(f.c.contextEvidence(scope).journal.length,payload.relevant_journal.length);
});

test('journal discovery is read-only, enabled by journal wording or memory discovery, and bounded by actual stored entries',t=>{
 const f=fixture(t),source=f.message(A,'four','Synthetic conversation'),diary=f.diary(source,{association:'我记下了一个自己的小想法。'});
 const all=f.c.tools(scope,'now'),plain=conversationCapabilities(all,'你好');assert.ok(!plain.some(x=>x.name==='read_life_journal'));
 const discovered=plain.find(x=>x.name==='discover_tools').expandsTools({category:'memory'});assert.ok(discovered.some(x=>x.name==='read_life_journal'));
 assert.ok(conversationCapabilities(all,'看看你最近的日记').some(x=>x.name==='read_life_journal'));
 const reader=all.find(x=>x.name==='read_life_journal'),before=f.c.store.counts(),result=JSON.parse(reader.handler({days:2,limit:2}));
 assert.equal(result.read_only,true);assert.equal(result.entries[0].id,diary.id);assert.deepEqual(f.c.store.counts(),before);
 assert.throws(()=>reader.handler({limit:7}),/1–6/);
 const missing=JSON.parse(reader.handler({id:'journal:00000000-0000-0000-0000-000000000000'}));assert.equal(missing.found,false);assert.deepEqual(missing.entries,[]);
 assert.ok(!all.some(x=>/write_life_journal|revise_life_journal/.test(x.name)));
});

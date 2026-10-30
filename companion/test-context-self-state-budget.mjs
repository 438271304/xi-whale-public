// Real memory/journal/context stores with synthetic data only. No provider or QQ.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {UnifiedCognition} from './cognition-tools.mjs';

const A='900000001',B='900000003',BOT='900000004',GROUP='900000002';
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'whale-context-state-'));let now=Date.parse('2026-10-30T12:00:00+08:00');
 const c=new UnifiedCognition(root,{botId:BOT,guardianIds:[A,B],clock:()=>now});
 t.after(()=>{c.close();const base=realpathSync(tmpdir()),target=realpathSync(root);assert.ok(target.startsWith(base+sep));rmSync(target,{recursive:true,force:true});});
 const current=(body='潮汐和海洋看板',where='group:'+GROUP,segments=[])=>JSON.stringify({transport:{conversation:where,sender_id:A,message_id:'now',time:now/1000},body,segments});
 const add=(event,body,{sender=A,where='group:'+GROUP,at=now-1000,segments=[]}={})=>c.store.recordMessage({scope:where,event,role:'user',senderId:sender,at,source:'live-transport',text:JSON.stringify({transport:{conversation:where,sender_id:sender,message_id:event,time:at/1000,group:{name:'同名群'}},body,segments})});
 const quote=add('quote','潮汐和海洋看板：'+('真实合成上下文。'.repeat(500)),{sender:B});
 const source=add('own-source','潮汐和海洋看板的一次真实合成讨论。');
 for(let i=0;i<10;i++)add('long-'+i,'潮汐和海洋看板。'+('长历史正文。'.repeat(600)),{sender:i%2?A:B,at:now-500-i});
 c.store.recordAttachment({scope:'group:'+GROUP,id:'img-heavy',event:'quote',source:'received',analysis:{status:'vision-ok',vision:{status:'ok',description:'合成大图描述。'.repeat(1800)}}});
 c.store.db.prepare('INSERT INTO remembered_people VALUES(?,?,?,?)').run('group:'+GROUP,A,'同一个显示名',now-1000);
 const evidence=[{type:'message',id:source.id}];
 c.store.setState({kind:'mood',key:'inner-life',value:{mood:'平静而有点好奇。'.repeat(180),energy:'steady',curiosity:'curious',cause:'刚才真正讨论了潮汐。'.repeat(120),active:true},evidence,at:now-60000,source:'life-inner-state'});
 c.store.setState({kind:'interest',key:'ocean',value:{interpretation:'想继续观察海洋潮汐。'.repeat(250),active:true},evidence,at:now-50000,source:'activity-reflection'});
 return {c,root,source,quote,current,add,evidence,now,advance:()=>now+=1000};
}
const state=(payload,kind,key)=>payload.state.find(s=>s.kind===kind&&s.key===key);

test('long history and image preserve source-linked mood and active interest without changing stored state',t=>{
 const f=fixture(t),before=f.c.store.counts(),full=f.c.store.getState({kind:'mood',key:'inner-life'})[0];
 const result=f.c.store.context({scope:'group:'+GROUP,current:f.current('潮汐和海洋看板','group:'+GROUP,[{type:'reply',message_id:'quote',reference:{sender_id:B,body:'原文不重复注入。'.repeat(1000)}}]),maxChars:6000});
 const mood=state(result,'mood','inner-life'),interest=state(result,'interest','ocean');assert.ok(mood);assert.ok(interest);assert.ok(JSON.stringify(result).length<=6000);
 assert.equal(mood.revision,full.revision);assert.equal(mood.at,full.at);assert.equal(mood.source,full.source);assert.equal(mood.basis,'linked-experience');assert.equal(mood.evidence[0].id,f.source.id);assert.equal(mood.value_truncated,true);assert.equal(mood.full_state_available_with,'self_state');assert.equal(interest.value.active,true);
 const quoted=result.related.find(r=>r.id===f.quote.id);assert.ok(quoted);assert.equal(quoted.author.id,B);assert.equal(quoted.scope,'group:'+GROUP);assert.equal(quoted.body_complete,false);assert.equal(quoted.full_original_available_with,'read_experience');
 assert.ok(result.people.some(p=>p.id===A&&p.author.id===A&&p.display_only));assert.deepEqual(f.c.store.getState({kind:'mood',key:'inner-life'})[0],full);assert.deepEqual(f.c.store.counts(),before);
 const read=JSON.parse(f.c.tools({kind:'group',id:GROUP},'now').find(t=>t.name==='self_state').handler({kind:'mood',key:'inner-life'}));assert.deepEqual(read[0].value,full.value);
});

test('retired latest revisions stay retired while another older valid interest is still selected',t=>{
 const f=fixture(t);f.c.store.setState({kind:'interest',key:'retired',value:{interpretation:'曾想研究这个。',active:true},evidence:f.evidence,at:f.now-20});f.c.store.setState({kind:'interest',key:'retired',value:{interpretation:'已经放下。',active:false},evidence:f.evidence,at:f.now-10});
 f.c.store.setState({kind:'mood',key:'retired-mood',value:{mood:'过去状态',active:false},evidence:f.evidence,at:f.now-5});
 const candidates=f.c.store.contextState({limit:6}),result=f.c.store.context({scope:'group:'+GROUP,current:f.current(),maxChars:6000});
 assert.ok(candidates.some(s=>s.key==='ocean'));assert.ok(candidates.every(s=>s.value?.active!==false));assert.ok(result.state.every(s=>s.key!=='retired'&&s.key!=='retired-mood'));
 assert.equal(f.c.store.getState({kind:'interest',key:'retired'})[0].value.active,false);assert.equal(f.c.store.getState({kind:'interest',key:'retired',history:true}).length,2);
});

test('long legal state identities and provenance do not push the active interest behind history',t=>{
 const f=fixture(t),moodKey='m"'.repeat(50),interestKey='i"'.repeat(50),source='s"'.repeat(60);
 f.c.store.setState({kind:'mood',key:'inner-life',value:{active:false},evidence:f.evidence,at:f.now-4});
 f.c.store.setState({kind:'mood',key:moodKey,value:{mood:'平静并想继续。'.repeat(200),active:true},evidence:Array(20).fill(f.evidence[0]),at:f.now-3,source});
 f.c.store.setState({kind:'interest',key:interestKey,value:{interpretation:'潮汐与海洋看板。'.repeat(200),active:true},evidence:Array(20).fill(f.evidence[0]),at:f.now-2,source});
 const result=f.c.store.context({scope:'group:'+GROUP,current:f.current(),maxChars:6000}),mood=state(result,'mood',moodKey),interest=state(result,'interest',interestKey);
 assert.ok(mood);assert.ok(interest);assert.equal(interest.source,source);assert.equal(interest.evidence[0].id,f.source.id);assert.equal(interest.evidence_count,20);assert.equal(interest.evidence_truncated,true);assert.ok(JSON.stringify(result).length<=6000);
});

test('old mood retains its recording time and is presented as a dated interpretation',t=>{
 const f=fixture(t),old=f.now-3*86400000;f.c.store.setState({kind:'mood',key:'inner-life',value:{mood:'三天前有点低落',energy:'low',active:true},evidence:f.evidence,at:old,source:'life-inner-state'});
 const result=f.c.store.context({scope:'group:'+GROUP,current:f.current(),maxChars:6000});assert.equal(state(result,'mood','inner-life').at,old);assert.match(result.notice,/dated self-interpretations/);assert.match(result.notice,/not.*proof of current feelings/);
});

test('500-character metadata remains bounded without substituting the current speaker or quoted author',t=>{
 const f=fixture(t),segments=[{type:'reply',message_id:'quote',reference:{sender_id:B,body:'长引用正文。'.repeat(3000)}},...Array.from({length:30},(_,i)=>({type:'at',target:String(500000+i)}))];
 const result=f.c.store.context({scope:'group:'+GROUP,current:f.current('潮汐','group:'+GROUP,segments),maxChars:500});assert.ok(JSON.stringify(result).length<=500);assert.equal(result.current_sender_id,A);assert.equal(result.current_scope,'group:'+GROUP);assert.equal(result.context_truncated,true);
 const quote=result.current_reference_targets.find(r=>r.type==='reply');assert.ok(quote);assert.equal(quote.message_id,'quote');assert.equal(quote.reference.sender_id,B);assert.equal(quote.reference.scope,'group:'+GROUP);
});

test('500-character unresolved source remains unresolved even with many named group candidates',t=>{
 const f=fixture(t);for(let i=0;i<15;i++)f.add('other-'+i,'另一个群的真实合成消息',{where:'group:'+String(700000+i)});
 const result=f.c.store.context({scope:'private:'+A,current:f.current('复盘那个群的聊天','private:'+A),maxChars:500});assert.ok(JSON.stringify(result).length<=500);assert.equal(result.current_sender_id,A);assert.equal(result.selection.needs_scope,true);assert.equal(result.selection.scope,null);assert.deepEqual(result.related,[]);
});

test('the final unified context retains both states after reserving space for two relevant diaries',t=>{
 const f=fixture(t);f.c.journal.record({evidence_ids:[f.source.id],interpretation:{feeling:'潮汐讨论让我感到平静。'.repeat(12)}});f.advance();f.c.journal.record({evidence_ids:[f.source.id],interpretation:{association:'我想继续看不同地方的海洋潮汐。'.repeat(12)}});f.advance();
 const before=f.c.store.counts(),text=f.c.context({kind:'group',id:GROUP},{event:'now',text:f.current()}),payload=JSON.parse(text.split('\n')[2]);assert.ok(JSON.stringify(payload).length<=7000);assert.equal(payload.relevant_journal.length,2);
 assert.ok(state(payload,'mood','inner-life'));assert.ok(state(payload,'interest','ocean'));assert.equal(state(payload,'interest','ocean').evidence[0].id,f.source.id);assert.deepEqual(f.c.store.counts(),before);
 const selected=f.c.contextEvidence({kind:'group',id:GROUP}).selected;assert.deepEqual(selected.map(r=>r.id),payload.related.map(r=>r.id));assert.ok(payload.related.every(r=>r.author.id===A||r.author.id===B));
});

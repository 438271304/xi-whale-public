import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ExperienceMemory} from './experience-memory.mjs';
import {LifeHeartbeat} from './life-heartbeat.mjs';
import {sampleLifeExperiences,LIFE_SOCIAL_LIMITS} from './life-social-context.mjs';

const NOW=Date.parse('2036-10-17T23:30:00+08:00'),HOUR=3600000;
const BOT='920010001',FATHER='920010003',MOTHER='920010004',FRIEND='920010005',PEER='920010006';
const FAMILY='group:920020001',OTHER='group:920020002',PRIVATE='private:'+FRIEND;
const policy={group_id:'920020001',father_id:FATHER,mother_id:MOTHER};
function fixture(t){
 const store=new ExperienceMemory({path:':memory:',clock:()=>NOW,botId:BOT,guardianIds:[FATHER,MOTHER],peerBotIds:[PEER]});
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE life_settings(key TEXT PRIMARY KEY,value TEXT)');
 const heartbeat=new LifeHeartbeat({db,store,clock:()=>NOW,policy});let serial=0;
 t.after(()=>{db.close();store.close();});
 const add=(source,body,options={})=>{
  const event=String(options.event??++serial),role=options.role??'user',at=options.at??NOW-1000*serial,sender=Object.hasOwn(options,'sender')?options.sender:FRIEND;
  const transport={conversation:source,message_id:event,time:(options.transportAt??at)/1000,...(sender?{sender_id:sender}:{})};
  const text=options.text??(role==='user'?JSON.stringify({body,segments:[],transport}):body);
  const saved=store.recordMessage({scope:source,event,role,text,at,senderId:role==='self'||role==='assistant'?BOT:sender,
   source:options.source??(role==='assistant'?'acknowledged-delivery':role==='self'?'public-exploration':'live-transport'),state:options.state??(role==='assistant'?'sent':null),metadata:options.metadata??{},revisionKind:options.revisionKind??'observation'});
  return {...saved,event,text,body,at};
 };
 return {store,db,heartbeat,add,sample:()=>sampleLifeExperiences(store,{now:NOW,policy})};
}

test('other groups and non-parent private encounters enter the real heartbeat beside family and own evidence',t=>{
 const f=fixture(t),expected=[f.add(FAMILY,'家人一起聊了一小会儿',{sender:FATHER}),f.add('private:'+FATHER,'父亲分享小事',{sender:FATHER}),
  f.add('private:'+MOTHER,'母亲说了个新发现',{sender:MOTHER}),f.add(OTHER,'朋友群讨论一个小设计'),f.add(PRIVATE,'朋友刚提到一个兴趣'),
  f.add('unknown','自己保存的公开资料发现',{role:'self'})];
 const result=f.heartbeat.context();
 assert.deepEqual(new Set(result.recent_experiences.map(r=>r.id)),new Set(expected.map(r=>r.id)));
 assert.equal(result.recent_experience_coverage.read_only,true);assert.equal(result.recent_experience_coverage.partial_preview,true);
 assert.ok(result.recent_experiences.every(r=>r.full_original_available_with==='read_life_experience'));
 assert.equal(f.db.prepare('SELECT count(*) n FROM life_corner_posts').get().n,0);assert.equal(f.store.getState({kind:'self'}).length,0);
});

test('a busy group cannot fill the sample; family, other conversations and own records have bounded turns',t=>{
 const f=fixture(t);
 for(const source of [FAMILY,'private:'+FATHER,'private:'+MOTHER])for(let n=0;n<5;n++)f.add(source,'家庭记录'+n,{sender:source.endsWith(MOTHER)?MOTHER:FATHER});
 for(let g=0;g<6;g++)for(let n=0;n<(g===0?100:4);n++)f.add('group:'+(920021000+g),'普通相处'+n,{at:NOW-1000*(n+1)-g});
 for(let n=0;n<8;n++)f.add('unknown','自己做的事情'+n,{role:'self'});
 const {records,coverage}=f.sample(),counts=new Map();for(const row of records)counts.set(row.scope,(counts.get(row.scope)??0)+1);
 assert.ok(records.length<=12);assert.ok((counts.get('unknown')??0)<=4);
 for(const [source,count] of counts)if(source!=='unknown')assert.ok(count<=2,source);
 for(const source of [FAMILY,'private:'+FATHER,'private:'+MOTHER])assert.ok(counts.has(source),source);
 const others=[...counts.keys()].filter(source=>source.startsWith('group:920021'));
 assert.ok(others.length>=2&&others.length<=4);assert.equal(coverage.truncated,true);
 assert.ok(JSON.stringify({records,coverage}).length<=LIFE_SOCIAL_LIMITS.max_json_chars);
});

test('future index, transport or revision times, recalls, source conflicts and uncertain outgoing claims do not surface',t=>{
 const f=fixture(t),ok=f.add(FAMILY,'确实发生的相处',{sender:FATHER,at:NOW-1000}),bad=[];
 bad.push(f.add(OTHER,'未来入库时间',{at:NOW+HOUR}));
 bad.push(f.add(OTHER,'未来传输时间',{at:NOW-2000,transportAt:NOW+HOUR}));
 const recalled=f.add(PRIVATE,'后来撤回的原文',{at:NOW-3000});bad.push(recalled);f.store.markRecalled({scope:PRIVATE,event:recalled.event,noticeKey:'recall-fixture',at:NOW-1000,linkedId:recalled.id});
 bad.push(f.add(OTHER,'尚未确认发出的自己回复',{role:'assistant',state:'uncertain',at:NOW-4000}));
 bad.push(f.add(OTHER,'没有回执的生成',{role:'assistant',state:'draft',source:'conversation-turns',at:NOW-5000}));
 const wrongScope=f.add(OTHER,'错绑范围',{at:NOW-6000,text:JSON.stringify({body:'错绑范围',transport:{conversation:PRIVATE,message_id:'bad-scope',sender_id:FRIEND,time:(NOW-6000)/1000}})});bad.push(wrongScope);
 bad.push(f.add('group:920020007','错绑事件',{event:'indexed-event',at:NOW-6500,text:JSON.stringify({body:'错绑事件',transport:{conversation:'group:920020007',message_id:'other-event',sender_id:FRIEND,time:(NOW-6500)/1000}})}));
 const wrongSender=f.add(OTHER,'身份相互矛盾',{at:NOW-7000,sender:FATHER,text:JSON.stringify({body:'身份相互矛盾',transport:{conversation:OTHER,message_id:'bad-person',sender_id:FRIEND,time:(NOW-7000)/1000}}),event:'bad-person'});bad.push(wrongSender);
 const revision=f.add('private:'+MOTHER,'原来的记录',{sender:MOTHER,at:NOW-8000});
 f.store.clock=()=>NOW+HOUR;f.store.recordMessage({scope:'private:'+MOTHER,event:revision.event,role:'user',text:JSON.stringify({body:'未来的新版本',transport:{conversation:'private:'+MOTHER,message_id:revision.event,sender_id:MOTHER,time:(NOW-8000)/1000}}),senderId:MOTHER,at:NOW-8000,revisionKind:'enrichment'});f.store.clock=()=>NOW;bad.push(revision);
 const ids=new Set(f.sample().records.map(r=>r.id));assert.ok(ids.has(ok.id));for(const row of bad)assert.equal(ids.has(row.id),false,row.body);
 assert.equal(f.store.get({id:recalled.id}).found,true,'Recall is not deletion');
});

test('transport time orders and windows the source while an unknown author, peer and forwarded claim stay distinct',t=>{
 const f=fixture(t),unknown=f.add(OTHER,'不知道发话者的原句',{sender:null,at:NOW-5000}),peer=f.add(PRIVATE,'另一AI的看法',{sender:PEER,at:NOW-4000});
 const forward=f.add('group:920020003','被转来的文字',{event:'forward',sender:FATHER,at:NOW-3000,source:'received-qq-forward-node',
  text:JSON.stringify({body:'被转来的文字',outer_source:{conversation:'group:920020003',sender_id:FATHER},node:{original_author:{reported_id:MOTHER,display_name:'只是转发里的显示名'}}}),metadata:{forward_id:'synthetic-forward'}});
 const stale=f.add('group:920020004','现在才索引的旧事',{at:NOW-2000,transportAt:NOW-60*HOUR});
 const shifted=f.add(FAMILY,'时间按真实传输',{sender:FATHER,at:NOW-1000,transportAt:NOW-2*HOUR});
 const records=f.sample().records,byId=new Map(records.map(r=>[r.id,r]));
 assert.equal(byId.get(unknown.id).author.kind,'unknown');assert.equal(byId.get(unknown.id).author.id,null);
 assert.equal(byId.get(peer.id).author.kind,'peer-bot');assert.equal(byId.get(peer.id).evidence_kind,'direct-peer-bot-statement');
 assert.equal(byId.get(forward.id).author.id,FATHER);assert.equal(byId.get(forward.id).forwarded_claimed_author.reported_id,MOTHER);assert.equal(byId.get(forward.id).forwarded_claimed_author.identity_verified,false);
 assert.equal(byId.has(stale.id),false);assert.equal(byId.get(shifted.id).at,NOW-2*HOUR);assert.equal(byId.get(shifted.id).indexed_event_at,NOW-1000);
});

test('large bodies, attachments and corrections remain bounded and explicitly partial with full original access',t=>{
 const f=fixture(t);let first;
 for(let n=0;n<8;n++){
  const row=f.add('group:'+(920023000+n),'长资料'+String(n)+'甲'.repeat(50000));first??=row;
  for(let a=0;a<6;a++)f.store.recordAttachment({scope:'group:'+(920023000+n),id:'synthetic-'+n+'-'+a,event:row.event,created:NOW-1000});
  for(let c=0;c<3;c++){const feedback=f.add('private:'+FATHER,'纠正'+c+'乙'.repeat(1000),{sender:FATHER});f.store.registerFeedback({targetId:row.id,feedbackId:feedback.id});}
 }
 const sample=f.sample();assert.ok(JSON.stringify(sample).length<=12000);assert.ok(JSON.stringify({recent_experiences:sample.records,recent_experience_coverage:sample.coverage}).length<=12000);assert.ok(sample.records.length<=12);
 for(const row of sample.records){assert.ok(row.body.length<=400);assert.ok(row.attachments.length<=4);assert.ok(row.correction_refs.length<=2);}
 const long=sample.records.find(r=>r.original_body_length>50000);assert.ok(long);assert.ok(long.body.startsWith('长资料'));assert.equal(long.truncated,true);assert.equal(long.body_complete,false);assert.equal(long.attachment_count,6);assert.equal(long.correction_count,3);
 let original='',offset=0;do{const page=f.store.get({id:first.id,offset,maxChars:24000});original+=page.text;offset=page.next_offset;}while(offset!==null);
 assert.equal(JSON.parse(original).body,first.body);
});

test('sampling is read-only, bounded in row materialization and leaves older cross-source search available',t=>{
 const f=fixture(t),old=f.add(PRIVATE,'独特旧话题仍然保留',{at:NOW-7*24*HOUR});
 for(let n=0;n<180;n++)f.add('group:'+(920024000+n%6),'普通旧历史'+n,{at:NOW-60*HOUR-n});
 f.add(OTHER,'今天的新经历');f.add(FAMILY,'今天的家庭语境',{sender:FATHER});
 const changes=f.store.db.prepare('SELECT total_changes() n').get().n;let reads=0;const get=f.store.get.bind(f.store);f.store.get=(...args)=>{reads++;return get(...args);};
 const sample=f.sample();assert.ok(reads<=96);assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,changes);
 assert.equal(sample.records.some(r=>r.id===old.id),false);assert.equal(get({id:old.id}).found,true);
 const recalled=f.store.search({query:'独特旧话题',senderId:FRIEND,limit:6,includeAttachments:false});assert.ok(recalled.records.some(r=>r.id===old.id&&r.scope===PRIVATE));
 assert.equal(f.store.getState({kind:'mood'}).length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM life_heartbeats').get().n,0);
});

test('a confirmed own reply is kept with its actual trigger; source quotas do not transfer subjects between speakers',t=>{
 const f=fixture(t),incoming=f.add(OTHER,'他说的是另一位朋友的事情',{event:'paired',sender:FRIEND,at:NOW-3000}),reply=f.add(OTHER,'我听见了这段转述',{event:'paired',role:'assistant',at:NOW-2000});
 const result=f.sample().records;assert.ok(result.some(r=>r.id===incoming.id));const own=result.find(r=>r.id===reply.id);
 assert.equal(own.author.kind,'self');assert.equal(own.delivery_status.confirmed_sent,true);assert.equal(own.reply_context.sender_id,FRIEND);assert.equal(own.evidence_kind,'assistant-claim');
 assert.equal(own.reply_context.evidence_kind,'response-to-message; not subject ownership');
});

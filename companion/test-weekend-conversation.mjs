// Synthetic stores and a fake provider only. No production DB, model or QQ calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {recentExchange} from './recent-exchange.mjs';
import {PrivateConversation} from './private-conversation.mjs';
import {ExperienceMemory} from './experience-memory.mjs';
import {UnifiedCognition} from './cognition-tools.mjs';

const NOW=Date.parse('2036-10-17T19:57:00+08:00'),MINUTE=60000,DAY=86400000;
const A='91111',B='92222',C='93333',D='94444',BOT='95555',PEER='96666';
const G='group:97777',OTHER='group:98888',PA='private:'+A,PB='private:'+B;
const presentation={botId:BOT,peerBots:[PEER],guardianIds:[A,B]};
function message(event,sender,at,body='SYNTHETIC_MESSAGE',{scope=G,segments=[],transport={},extra={}}={}){
 return JSON.stringify({transport:{conversation:scope,message_id:event,sender_id:sender,time:at/1000,...transport},body,segments,...extra});
}
function turnStore(t){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE turns(peer TEXT,event TEXT,role TEXT,text TEXT,at INTEGER,state TEXT,PRIMARY KEY(peer,event,role))');
 t.after(()=>db.close());
 return {db,put(event,{sender=A,time=NOW-1000,recorded=time,body='SYNTHETIC_MESSAGE',peer=G,scope=peer,role='user',state=role==='assistant'?'sent':'quiet',transport={},segments=[],extra={},text}={}){
  db.prepare('INSERT INTO turns VALUES(?,?,?,?,?,?)').run(peer,event,role,text??(role==='assistant'?body:message(event,sender,time,body,{scope,transport,segments,extra})),recorded,state);
  return db.prepare('SELECT rowid,* FROM turns WHERE peer=? AND event=? AND role=?').get(peer,event,role);
 }};
}
function memory(t){
 const store=new ExperienceMemory({path:':memory:',clock:()=>NOW,botId:BOT,peerBotIds:[PEER],guardianIds:[A,B]});
 t.after(()=>store.close());return store;
}
function remember(store,event,{sender=A,time=NOW-1000,recorded=time,body='SYNTHETIC_SOURCE',scope=G,role='user',source='live-transport',transport={},segments=[],extra={},metadata={},text}={}){
 return store.recordMessage({scope,event,role,senderId:sender,at:recorded,source,metadata,state:role==='assistant'?'sent':'heard',
  text:text??message(event,sender,time,body,{scope,transport,segments,extra})});
}

test('recent exchange preserves another speaker’s new topic and uses transport time rather than insertion time',t=>{
 const f=turnStore(t);
 f.put('old-own',{role:'assistant',time:NOW-332*MINUTE,body:'OLD_TOPIC'});
 f.put('old-other',{sender:B,time:NOW-331*MINUTE});
 f.put('new-topic',{sender:A,time:NOW-2*MINUTE,recorded:NOW-1000,body:'NEW_TOPIC',segments:[{type:'at',target:PEER}]});
 const current=f.put('current',{sender:C,time:NOW,body:'A short reaction from a different speaker.'});
 const view=recentExchange(f.db,{peer:G,current,now:NOW,presentation});
 assert.equal(view.recent_human_messages.at(-1).event,'new-topic');
 assert.equal(view.recent_human_messages.at(-1).author_id,A);
 assert.equal(view.recent_human_messages.at(-1).elapsed_seconds,120);
 assert.equal(view.recent_human_messages.at(-1).at,new Date(NOW-2*MINUTE).toISOString());
 assert.deepEqual(view.recent_human_messages.at(-1).references,[{type:'at',target:PEER}]);
 assert.equal(view.previous_self.event,'old-own');assert.equal(view.previous_self.elapsed_seconds,332*60);
 assert.ok(!view.recent_human_messages.some(r=>r.event==='current'));
});

test('a 49-minute family joke remains available; the view neither deletes history nor decides whether to answer',t=>{
 const f=turnStore(t),earlier=f.put('joke',{sender:B,time:NOW-49*MINUTE,body:'OLDER_JOKE_STAYS_AVAILABLE'});
 f.put('own-joke',{role:'assistant',time:NOW-49*MINUTE+1000,body:'OLDER_REPLY_STAYS_AVAILABLE'});
 const current=f.put('return',{sender:A,time:NOW});
 const before=f.db.prepare('SELECT * FROM turns ORDER BY rowid').all();
 const view=recentExchange(f.db,{peer:G,current,now:NOW,presentation});
 assert.equal(view.recent_human_messages[0].event,earlier.event);
 assert.equal(view.recent_human_messages[0].elapsed_seconds,49*60);
 assert.equal(view.recent_human_messages[0].body_excerpt,'OLDER_JOKE_STAYS_AVAILABLE');
 assert.deepEqual(f.db.prepare('SELECT * FROM turns ORDER BY rowid').all(),before);
 assert.equal(Object.hasOwn(view,'should_reply'),false);assert.equal(Object.hasOwn(view,'topic_expired'),false);
});

test('recent exchange rejects other groups, future transport, bots, forwarded claims and mismatched event identity',t=>{
 const f=turnStore(t);f.put('valid',{sender:A,time:NOW-2*MINUTE,body:'VALID'});
 f.put('other-group',{peer:OTHER,sender:A,time:NOW-1000});
 f.put('wrong-envelope',{scope:OTHER,sender:A,time:NOW-1000});
 f.put('future-human',{sender:A,time:NOW+MINUTE,recorded:NOW-1000});
 f.put('peer-bot',{sender:PEER});f.put('self-as-user',{sender:BOT});
 f.put('wrong-event',{sender:A,transport:{message_id:'different-event'}});
 f.put('forward-node',{text:JSON.stringify({outer_source:{conversation:G,sender_id:B,time:NOW/1000},node:{original_author:{reported_id:A},original_time:NOW/1000,message:[{type:'text',text:'FORWARDED_CLAIM'}]}})});
 f.put('missing-time',{transport:{time:null}});f.put('not-json',{text:'OLD_ARCHIVE_WITHOUT_VERIFIED_TRANSPORT'});
 const current=f.put('current',{sender:B,time:NOW});
 const view=recentExchange(f.db,{peer:G,current,now:NOW,presentation});
 assert.deepEqual(view.recent_human_messages.map(r=>r.event),['valid']);
});

test('previous self requires an actual past sent record and is not replaced by uncertain or future sends',t=>{
 const f=turnStore(t);f.put('sent-before',{role:'assistant',time:NOW-5*MINUTE});
 f.put('failed',{role:'assistant',time:NOW-4000,state:'failed'});
 f.put('uncertain',{role:'assistant',time:NOW-3000,state:'uncertain'});
 f.put('sending',{role:'assistant',time:NOW-2000,state:'sending'});
 f.put('future-self',{role:'assistant',time:NOW+MINUTE});
 f.put('other-self',{peer:OTHER,role:'assistant',time:NOW-1000});
 const current=f.put('current',{time:NOW});
 const view=recentExchange(f.db,{peer:G,current,now:NOW,presentation});
 assert.equal(view.previous_self.event,'sent-before');assert.equal(view.previous_self.elapsed_seconds,300);
});

test('private-conversation integrates the view on every generation without removing an older valid exchange',async t=>{
 let now=NOW,calls=0,sends=0;const requests=[];
 const engine=new PrivateConversation({path:':memory:',profile:'SYNTHETIC_PERSONA',presentation,clock:()=>now,isAllowed:()=>true,
  toolsFor:()=>[{name:'synthetic_read',description:'Synthetic local check.',parameters:{type:'object',properties:{},additionalProperties:false},handler:()=>{now+=MINUTE;return 'read';}}],
  client:{respond:async req=>{requests.push(req);return {response:{id:'synthetic-'+(++calls),status:'completed',output:calls===1?
   [{type:'function_call',name:'synthetic_read',call_id:'read-1',arguments:'{}'}]:
   [{type:'message',role:'assistant',content:[{type:'output_text',text:'SYNTHETIC_REPLY'}]}]},attempts:[]};}},
  send:async()=>{sends++;}});
 t.after(()=>engine.close());
 const insert=(event,role,text,at)=>engine.db.prepare('INSERT INTO turns VALUES(?,?,?,?,?,?)').run(G,event,role,text,at,role==='assistant'?'sent':'quiet');
 insert('old-joke','user',message('old-joke',B,NOW-49*MINUTE,'OLDER_JOKE_STAYS_IN_TRANSCRIPT'),NOW-49*MINUTE);
 insert('old-joke','assistant','OLDER_OWN_REPLY_STAYS_IN_TRANSCRIPT',NOW-49*MINUTE+1000);
 insert('new-topic','user',message('new-topic',A,NOW-2*MINUTE,'A_RECENT_OTHER_SPEAKER'),NOW-1000);
 assert.equal((await engine.receive(G,'current',message('current',C,NOW,'CURRENT_SHORT_REACTION'))).status,'sent');
 const view=req=>req.instructions.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(value=>Array.isArray(value.recent_human_messages));
 assert.equal(calls,2);assert.equal(sends,1);
 assert.equal(view(requests[0]).recent_human_messages.at(-1).elapsed_seconds,120);
 assert.equal(view(requests[1]).recent_human_messages.at(-1).elapsed_seconds,180);
 assert.ok(JSON.stringify(requests[0].input).includes('OLDER_JOKE_STAYS_IN_TRANSCRIPT'));
 assert.ok(JSON.stringify(requests[0].input).includes('OLDER_OWN_REPLY_STAYS_IN_TRANSCRIPT'));
 assert.equal(view(requests[0]).recent_human_messages.at(-1).author_id,A);
});

test('cross-source contact index is metadata only and can find a parent’s recent private interaction',t=>{
 const store=memory(t),secret='PRIVATE_CONTACT_BODY_MUST_NOT_LEAK';
 remember(store,'old-group',{sender:A,time:NOW-60*MINUTE,body:'OLD_PUBLIC_SOURCE'});
 const privateSource=remember(store,'recent-private',{sender:A,scope:PA,time:NOW-10*MINUTE,body:secret,
  segments:[{type:'reply',message_id:'private-quote',reference:{sender_id:B,body:'QUOTED_PRIVATE_BODY_MUST_NOT_LEAK'}}]});
 const contacts=store.recentContacts({senderIds:[A],before:NOW});
 assert.equal(contacts.length,1);assert.equal(contacts[0].id,privateSource.id);assert.equal(contacts[0].scope,PA);
 assert.equal(contacts[0].author_id,A);assert.equal(contacts[0].elapsed_seconds,600);
 assert.ok(!JSON.stringify(contacts).includes(secret));assert.ok(!JSON.stringify(contacts).includes('QUOTED_PRIVATE_BODY'));
 assert.ok(contacts.every(row=>!Object.hasOwn(row,'body')&&!Object.hasOwn(row,'text')&&!Object.hasOwn(row,'references')));
 assert.match(contacts[0].meaning,/not present activity or online status/);
 assert.ok(store.get({id:privateSource.id}).text.includes(secret),'The original remains available by exact source ID.');
});

test('contact order, seven-day window and future exclusion use transport time instead of recording time',t=>{
 const store=memory(t);
 remember(store,'older-received-late',{sender:A,scope:PA,time:NOW-3*DAY,recorded:NOW-1000});
 const actualLatest=remember(store,'latest-transport',{sender:A,time:NOW-5*MINUTE,recorded:NOW-DAY});
 remember(store,'future-transport',{sender:A,time:NOW+MINUTE,recorded:NOW-500});
 remember(store,'expired-transport',{sender:B,scope:PB,time:NOW-8*DAY,recorded:NOW-100});
 const contacts=store.recentContacts({senderIds:[A,B],before:NOW});
 assert.equal(contacts.length,1);assert.equal(contacts[0].id,actualLatest.id);
 assert.equal(contacts[0].at,new Date(NOW-5*MINUTE).toISOString());assert.equal(contacts[0].elapsed_seconds,300);
});

test('current records, forwards, bots, recalls and conflicting or unbound transport cannot become person contacts',t=>{
 const store=memory(t),known=remember(store,'valid-before',{sender:A,time:NOW-60*MINUTE});
 remember(store,'current',{sender:A,time:NOW});
 remember(store,'bot-row',{sender:PEER,time:NOW-100});remember(store,'own-row',{sender:BOT,time:NOW-100});
 remember(store,'self-generated-human',{sender:A,role:'assistant',time:NOW-200});
 remember(store,'forward-source',{sender:A,time:NOW-300,source:'received-qq-forward-node'});
 remember(store,'forward-node',{sender:A,time:NOW-400,extra:{node:{original_author:{reported_id:A},original_time:NOW/1000}}});
 remember(store,'identity-conflict',{sender:A,time:NOW-500,transport:{sender_id:B}});
 remember(store,'scope-conflict',{sender:A,time:NOW-600,transport:{conversation:OTHER}});
 remember(store,'event-conflict',{sender:A,time:NOW-700,transport:{message_id:'not-the-record-event'}});
 remember(store,'unknown-time',{sender:A,time:NOW-800,transport:{time:null}});
 remember(store,'recalled',{sender:A,time:NOW-900});store.markRecalled({scope:G,event:'recalled',noticeKey:'synthetic-recall',at:NOW});
 remember(store,'no-transport',{sender:A,time:NOW-1000,text:'A plain archived claim without a verified transport.'});
 const contacts=store.recentContacts({senderIds:[A,PEER,BOT],before:NOW,excludeCurrent:{scope:G,event:'current'}});
 assert.equal(contacts.length,1);assert.equal(contacts[0].id,known.id);assert.equal(contacts[0].author_id,A);
});

test('full cognition keeps the 7k bound, private bodies out of contact metadata and at most three selected people',t=>{
 const root=mkdtempSync(join(tmpdir(),'whale-weekend-context-'));
 const c=new UnifiedCognition(root,{botId:BOT,peerBotIds:[PEER],guardianIds:[A,B],clock:()=>NOW});
 t.after(()=>{c.close();const parent=realpathSync(tmpdir()),target=realpathSync(root);assert.ok(target.startsWith(parent+sep));rmSync(target,{recursive:true,force:true});});
 const contact=remember(c.store,'parent-private',{sender:A,scope:PA,time:NOW-10*MINUTE,body:'PRIVATE_PARENT_CANARY'});
 remember(c.store,'parent-b-private',{sender:B,scope:PB,time:NOW-11*MINUTE,body:'PRIVATE_SECOND_PARENT_CANARY'});
 remember(c.store,'speaker-private',{sender:C,scope:'private:'+C,time:NOW-12*MINUTE,body:'PRIVATE_SPEAKER_CANARY'});
 remember(c.store,'mentioned-private',{sender:D,scope:'private:'+D,time:NOW-13*MINUTE,body:'PRIVATE_MENTION_CANARY'});
 const evidence=remember(c.store,'quoted',{sender:B,time:NOW-2*MINUTE,body:'Synthetic topic. '.repeat(1000)});
 for(let i=0;i<10;i++)remember(c.store,'large-'+i,{sender:C,time:NOW-MINUTE-i,body:'Synthetic topic. '.repeat(1000)});
 const refs=[{type:'message',id:evidence.id}];
 c.store.setState({kind:'mood',key:'inner-life',value:{mood:'calm '.repeat(700),active:true},evidence:refs,at:NOW-5000,source:'synthetic'});
 c.store.setState({kind:'interest',key:'synthetic-topic',value:{interpretation:'a real interest '.repeat(200),active:true},evidence:refs,at:NOW-4000,source:'synthetic'});
 const segments=[{type:'reply',message_id:'quoted',reference:{sender_id:B}},{type:'at',target:D}];
 const text=message('current',C,NOW,'Synthetic topic.',{segments});
 const wrapped=c.context({kind:'group',id:G.split(':')[1]},{event:'current',text});
 const payload=JSON.parse(wrapped.split('\n').find(line=>line.startsWith('{')));
 assert.ok(JSON.stringify(payload).length<=7000);assert.ok(payload.recent_contacts.length<=3);
 assert.ok(payload.recent_contacts.some(row=>row.id===contact.id));
 assert.ok(payload.recent_contacts.every(row=>[A,B,C,D].includes(row.author_id)));
 assert.ok(payload.state.some(row=>row.kind==='mood'));assert.ok(payload.state.some(row=>row.kind==='interest'));
 assert.ok(payload.related.some(row=>row.id===evidence.id));
 assert.ok(!JSON.stringify(payload.recent_contacts).includes('CANARY'));
 assert.ok(!wrapped.includes('PRIVATE_PARENT_CANARY'));assert.ok(!wrapped.includes('PRIVATE_SECOND_PARENT_CANARY'));
 assert.ok(!wrapped.includes('PRIVATE_SPEAKER_CANARY'));assert.ok(!wrapped.includes('PRIVATE_MENTION_CANARY'));
});

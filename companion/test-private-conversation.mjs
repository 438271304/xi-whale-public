import assert from 'node:assert/strict';
import {PrivateConversation} from './private-conversation.mjs';
import test from 'node:test';
let requests=[],sends=[],allowed=true,failSend=false;
const c=new PrivateConversation({path:':memory:',profile:'Public identity only.',isAllowed:async()=>allowed,
 client:{respond:async r=>{requests.push(r);return {response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'reply-'+requests.length}]}]}};}},
 send:async(peer,text)=>{sends.push({peer,text});if(failSend)throw Error('timeout');}});
assert.equal((await c.receive('12345','1','A_PRIVATE_CANARY')).status,'sent');
assert.equal((await c.receive('23456','1','B_PRIVATE_CANARY')).status,'sent');
assert.ok(!JSON.stringify(requests[1]).includes('A_PRIVATE_CANARY'));
assert.equal((await c.receive('12345','2','again')).status,'sent');
assert.ok(JSON.stringify(requests[2]).includes('A_PRIVATE_CANARY'));
assert.ok(!JSON.stringify(requests[2]).includes('B_PRIVATE_CANARY'));
assert.equal((await c.receive('12345','2','repeat')).status,'duplicate');
assert.deepEqual(requests[0].tools,[]);
failSend=true;assert.equal((await c.receive('12345','3','uncertain')).status,'failed-no-retry');
failSend=false;await c.receive('12345','4','after');
assert.ok(!JSON.stringify(requests.at(-1)).includes('reply-4'));
allowed=false;assert.equal((await c.receive('12345','5','not allowed')).status,'not-allowed');
assert.equal((await c.receive('../bad','6','x')).status,'invalid');
await c.close();assert.equal((await c.receive('12345','7','x')).status,'stopped');
console.log('PASS: private canaries, same-peer continuity, duplicate, invalid IDs, uncertain delivery exclusion, stopped intake; fake model/transport');

const FRAME_PEER='group:910920001',FRAME_BOT='910910001',FRAME_HUMAN='910910002',FRAME_NOW=Date.parse('2026-10-30T12:00:00+08:00');
const frameMessage=(event,body,segments=[])=>JSON.stringify({transport:{conversation:FRAME_PEER,message_id:event,sender_id:FRAME_HUMAN,time:FRAME_NOW/1000,attention:'open'},body,segments});
function frameFixture(t,{quiet=false}={}){
 let captured,sent=0;
 const engine=new PrivateConversation({path:':memory:',profile:'SYNTHETIC_STABLE_PERSONA',presentation:{botId:FRAME_BOT,guardianIds:[FRAME_HUMAN]},clock:()=>FRAME_NOW,isAllowed:()=>true,
  toolsFor:()=>[{name:'stay_quiet',description:'Remain quiet when there is no new contribution.',parameters:{type:'object',properties:{},additionalProperties:false},endsTurn:true,handler:()=> 'quiet'}],
  client:{respond:async req=>{captured=req;return {response:{id:'fixture',status:'completed',output:quiet?[{type:'function_call',name:'stay_quiet',call_id:'quiet-call',arguments:'{}'}]:[{type:'message',role:'assistant',content:[{type:'output_text',text:'A synthetic reply.'}]}]},attempts:[]};}},
  send:async()=>{sent++;}});
 t.after(()=>engine.close());
 return {engine,get captured(){return captured;},get sends(){return sent;},
  insert(event,role,text,at=FRAME_NOW-1000,state=role==='assistant'?'sent':'quiet'){
   engine.db.prepare('INSERT INTO turns VALUES(?,?,?,?,?,?)').run(FRAME_PEER,event,role,text,at,state);
  },
  frame(){return JSON.parse(captured.instructions.split('【本轮固定发话与引用来源】\n')[1].split('\n')[0]);},
 };
}

test('latest self frame deduplicates represented reply/proactive text while retaining provenance and an explicit self quote',async t=>{
 const f=frameFixture(t),reply='REPLY_TEXT_ONLY_IN_TRANSCRIPT',proactive='PROACTIVE_TEXT_ONLY_IN_TRANSCRIPT';
 f.insert('earlier','user',frameMessage('earlier','An actual fixture request.'));
 f.insert('earlier','assistant',reply,FRAME_NOW-3000);
 f.insert('proactive:own-topic','assistant',proactive,FRAME_NOW-2000);
 const quote={type:'reply',message_id:'earlier',reference:{sender_id:FRAME_BOT,body:reply,time:(FRAME_NOW-3000)/1000}};
 assert.equal((await f.engine.receive(FRAME_PEER,'current',frameMessage('current','你刚才那句是这个意思吗？',[quote]))).status,'sent');
 const frame=f.frame();assert.equal(frame.current_sender_id,FRAME_HUMAN);
 for(const event of ['earlier','proactive:own-topic']){
  const anchor=frame.latest_self_messages.find(row=>row.event===event);
  assert.equal(anchor.content_in_transcript,true);assert.ok(!Object.hasOwn(anchor,'text'));
  assert.equal(anchor.author_id,FRAME_BOT);assert.equal(anchor.conversation,FRAME_PEER);assert.equal(anchor.evidence_kind,'assistant-claim');
  assert.equal(anchor.not_independent_human_evidence,true);assert.ok(f.captured.input.some(item=>item.role==='assistant'&&item.content.includes(event==='earlier'?reply:proactive)));
 }
 assert.equal(frame.latest_self_messages.find(row=>row.event==='earlier').in_reply_to_sender_id,FRAME_HUMAN);
 const own=frame.latest_self_messages.find(row=>row.event==='proactive:own-topic');assert.equal(own.kind,'self-initiated-share');assert.equal(own.in_reply_to_sender_id,null);
 assert.equal(own.at,new Date(FRAME_NOW-2000).toISOString());
 const current=JSON.parse(f.captured.input.at(-1).content);assert.equal(current.references[0].author.id,FRAME_BOT);assert.equal(current.references[0].said,reply);
 assert.equal(f.captured.instructions.includes(reply),false);assert.equal(f.captured.instructions.includes(proactive),false);
 assert.match(f.captured.instructions,/本轮若需要发话/);assert.equal(f.sends,1);
});

test('an own topic outside the history row window keeps its bounded body and source anchor',async t=>{
 const f=frameFixture(t),topic='OWN_TOPIC_OUTSIDE_TRANSCRIPT';
 f.insert('proactive:older-topic','assistant',topic,FRAME_NOW-100000);
 for(let index=0;index<30;index++)f.insert('intervening-'+index,'user',frameMessage('intervening-'+index,'A later fixture remark.'));
 await f.engine.receive(FRAME_PEER,'current',frameMessage('current','你刚才主动提起的那个呢？'));
 assert.ok(!f.captured.input.some(item=>item.content.includes(topic)));
 const anchor=f.frame().latest_self_messages[0];assert.equal(anchor.event,'proactive:older-topic');assert.equal(anchor.kind,'self-initiated-share');
 assert.equal(anchor.content_in_transcript,false);assert.equal(anchor.text,topic);assert.equal(anchor.text_truncated,false);
 assert.equal(anchor.author_id,FRAME_BOT);assert.equal(anchor.at,new Date(FRAME_NOW-100000).toISOString());
});

test('an own body omitted by the history character budget retains its preview, and a quiet choice still sends nothing',async t=>{
 const f=frameFixture(t,{quiet:true}),topic='OMITTED_BY_CHARACTER_BUDGET'+'x'.repeat(20000);
 f.insert('proactive:large-context','assistant',topic,FRAME_NOW-3000);
 f.insert('large-a','user',frameMessage('large-a','a'.repeat(45000)));
 f.insert('large-b','user',frameMessage('large-b','b'.repeat(45000)));
 const result=await f.engine.receive(FRAME_PEER,'current',frameMessage('current','这段别人之间的聊天先听着。'));
 const anchor=f.frame().latest_self_messages[0];
 assert.equal(anchor.content_in_transcript,false);assert.equal(anchor.text,topic.slice(0,1200));assert.equal(anchor.text_truncated,true);
 assert.ok(!f.captured.input.some(item=>item.role==='assistant'&&item.content.includes('OMITTED_BY_CHARACTER_BUDGET')));
 assert.equal(result.status,'quiet');assert.equal(f.sends,0);
});

import assert from 'node:assert/strict';
import {buildConversationTime} from './conversation-time.mjs';

const G='group:900000002',OTHER='group:900000007',P='private:900000001',A='900000001',B='900000003';
const now=Date.parse('2026-10-29T12:00:00.500+08:00');
const incoming=(scope,event,sender,at,{recorded=at,extra={}}={})=>({peer:scope,event:String(event),role:'user',state:'accepted',at:recorded,text:JSON.stringify({transport:{conversation:scope,message_id:String(event),sender_id:sender,time:at/1000},body:'PRIVATE_BODY_MUST_NOT_APPEAR',...extra})});
const sent=(scope,event,at,state='sent')=>({peer:scope,event,role:'assistant',state,at,text:'PRIVATE_ASSISTANT_BODY_MUST_NOT_APPEAR'});
const current=incoming(G,100,A,now-30000,{recorded:now-20000}),previous=incoming(G,99,B,now-125000,{recorded:now-120000}),previousSelf=sent(G,'proactive:synthetic-share',now-90000);
const first=buildConversationTime({now,current,previousIncoming:previous,previousSelf});
assert.equal(first.time_zone,'Asia/Shanghai');assert.equal(first.computed_at.absolute_iso,'2026-10-29T04:00:00.500Z');assert.equal(first.computed_at.local_iso,'2026-10-29T12:00:00.500+08:00');
assert.equal(first.current.scope,G);assert.equal(first.current.sender_id,A);assert.equal(first.current.event,'100');assert.equal(first.current.verified_current_transport,true);
assert.equal(first.current.time.transport.original_unit,'seconds');assert.equal(first.current.time.recorded.original_unit,'milliseconds');assert.equal(first.current.elapsed_ms,30000);assert.equal(first.current.recorded_to_generation.elapsed_ms,20000);
assert.equal(buildConversationTime({now,current:incoming(G,101,A,now-123)}).current.elapsed_ms,123);
assert.equal(first.previous_incoming.elapsed_ms,125000);assert.equal(first.previous_incoming.same_sender_as_current,false);assert.equal(first.previous_incoming.reference.sender_id,B);
assert.equal(first.previous_self.elapsed_ms,90000);assert.equal(first.previous_self.reference.event,'proactive:synthetic-share');assert.match(first.previous_self.meaning,/不代表对方已读/);
assert.equal(first.intervals.find(x=>x.from==='previous_incoming').delta_ms,95000);assert.equal(first.intervals.find(x=>x.from==='previous_self').delta_ms,60000);
assert.ok(!JSON.stringify(first).includes('PRIVATE_BODY'));assert.ok(!JSON.stringify(first).includes('PRIVATE_ASSISTANT_BODY'));

// Waiting labels are recalculated at generation, even if the stored message or
// a cached contextual fact was received much earlier.
const delayed=buildConversationTime({now:now+120000,current,previousIncoming:previous,previousSelf});
assert.equal(delayed.previous_incoming.elapsed_ms,245000);assert.equal(delayed.current.elapsed_ms,150000);assert.notEqual(delayed.previous_incoming.label,first.previous_incoming.label);assert.equal(delayed.current.time.effective.absolute_iso,first.current.time.effective.absolute_iso);
assert.equal(buildConversationTime({now:new Date(now),current,previousIncoming:incoming(G,98,A,now-60000)}).previous_incoming.same_sender_as_current,true);

// Midnight uses absolute time differences, never calendar words such as 昨天.
const midnight=Date.parse('2026-10-30T00:01:30+08:00');
const across=buildConversationTime({now:midnight,current:incoming(G,103,A,midnight-60000),previousIncoming:incoming(G,102,A,midnight-120000),previousSelf:sent(G,'reply-101',midnight-180000)});
assert.equal(across.current.time.effective.local_iso,'2026-10-30T00:00:30.000+08:00');assert.equal(across.previous_incoming.time.effective.local_iso,'2026-10-29T23:59:30.000+08:00');assert.equal(across.previous_incoming.elapsed_ms,120000);assert.equal(across.previous_incoming.label,'2分钟前');assert.equal(across.intervals[0].delta_ms,60000);assert.ok(!JSON.stringify(across).includes('昨天'));

// Future timestamps preserve the negative difference, without guessing that
// someone waited or inventing a corrected clock value.
const future=buildConversationTime({now,current:incoming(G,110,A,now+60000),previousIncoming:incoming(G,109,A,now+30000),previousSelf:sent(G,'future-self',now+1000)});
assert.equal(future.current.status,'future');assert.equal(future.current.elapsed_ms,-60000);assert.match(future.current.label,/负间隔/);assert.equal(future.previous_incoming.elapsed_ms,-30000);assert.equal(future.previous_self.elapsed_ms,-1000);
const reverse=buildConversationTime({now,current:incoming(G,112,A,now-60000),previousIncoming:incoming(G,111,A,now-30000)});assert.equal(reverse.intervals[0].status,'negative');assert.equal(reverse.intervals[0].delta_ms,-30000);
const absent=buildConversationTime({current});assert.equal(absent.computed_at.status,'unknown');assert.equal(absent.current.elapsed_ms,null);assert.equal(absent.previous_incoming.included,false);
const missingTime=buildConversationTime({now,current:{transport:{conversation:G,message_id:'120',sender_id:A,time:null}}});assert.equal(missingTime.current.status,'unknown');assert.equal(missingTime.current.time.effective.absolute_iso,null);
const fallback=buildConversationTime({now,current:{peer:G,event:'120',at:now-40000,transport:{conversation:G,message_id:'120',sender_id:A,time:0}}});assert.equal(fallback.current.elapsed_ms,40000);assert.match(fallback.current.time.effective.source,/turns.at/);assert.equal(fallback.current.time.transport.status,'unknown');
assert.equal(buildConversationTime({now:new Date('bad'),current}).computed_at.status,'unknown');

// Same-person activity elsewhere is not this conversation's waiting interval.
for(const scope of [OTHER,P]){
 const excluded=buildConversationTime({now,current,previousIncoming:incoming(scope,90,A,now-1000),previousSelf:sent(scope,'elsewhere',now-2000),relevantEvents:[incoming(scope,80,A,now-3000)]});
 assert.equal(excluded.previous_incoming.included,false);assert.equal(excluded.previous_incoming.elapsed_ms,null);assert.equal(excluded.previous_self.included,false);assert.equal(excluded.relevant_events[0].included,false);assert.equal(excluded.intervals.length,0);
}
for(const state of ['sending','uncertain','failed'])assert.equal(buildConversationTime({now,current,previousSelf:sent(G,'not-sent',now-1000,state)}).previous_self.reason,'not-confirmed-self-delivery');
assert.equal(buildConversationTime({now,current,previousIncoming:current}).previous_incoming.reason,'current-event-is-not-previous');
const mismatch=buildConversationTime({now,current:{...current,peer:OTHER},previousIncoming:previous});assert.equal(mismatch.current.verified_current_transport,false);assert.equal(mismatch.current.scope,null);assert.equal(mismatch.previous_incoming.included,false);
assert.equal(buildConversationTime({now,current:{...current,event:'WRONG_EVENT'}}).current.issues[0],'transport-record-event-mismatch');

// A forwarded node's old original_time never becomes the current speaker/time.
const original=now-10*86400000,forwarded={peer:G,kind:'forwarded-original',outer_source:{conversation:G,message_id:'130',sender_id:A,time:now/1000},node:{key:'forward:one',original_time:original/1000,original_author:{reported_id:B},message:[{type:'text',text:'PRIVATE_FORWARD_BODY'}]}};
const forwardCurrent={transport:{conversation:G,sender_id:A,message_id:'130',time:(now-1000)/1000},node:forwarded.node};
const history=buildConversationTime({now,current:forwardCurrent,previousIncoming:forwarded,relevantEvents:[forwarded,{...forwarded,node:{...forwarded.node,key:'unknown-time',original_time:null}}]});
assert.equal(history.current.elapsed_ms,1000);assert.equal(history.current.sender_id,A);assert.equal(history.current.event,'130');assert.equal(history.previous_incoming.included,false);
assert.equal(history.relevant_events[0].counts_as_waiting,false);assert.equal(history.relevant_events[0].original_time.epoch_ms,original);assert.equal(history.relevant_events[0].outer_time.epoch_ms,now);assert.equal(history.relevant_events[0].interval_to_outer.delta_ms,10*86400000);
assert.equal(history.relevant_events[1].original_time.status,'unknown');assert.equal(history.relevant_events[1].interval_to_outer.status,'unknown');assert.ok(!JSON.stringify(history).includes('PRIVATE_FORWARD_BODY'));
const noTransport=buildConversationTime({now,current:forwarded});assert.equal(noTransport.current.verified_current_transport,false);assert.equal(noTransport.current.event,null);assert.equal(noTransport.current.sender_id,null);assert.equal(noTransport.current.status,'unknown');

// Queued/batched records retain distinct IDs; later input cannot silently take
// the original event's identity. Related event intervals stay explicitly scoped.
const batch={peer:G,event:'140',rowid:42,at:now-5000,queue_event_id:'queued:140',text:JSON.stringify({transport:{conversation:G,sender_id:A,message_id:'140',time:(now-7000)/1000,batch_id:'batch-synthetic',batch_message_ids:['138','139','140']},recent_messages:[{transport:{message_id:'137'}},{message_id:'138'}]})};
const batched=buildConversationTime({now,current:batch,relevantEvents:[{peer:G,event:'136',at:now-15000,kind:'workshop-completed'}]});
assert.equal(batched.current.binding.record_event,'140');assert.equal(batched.current.binding.transport_event,'140');assert.equal(batched.current.binding.record_rowid,42);assert.equal(batched.current.binding.queue_event_id,'queued:140');assert.equal(batched.current.binding.batch_id,'batch-synthetic');assert.deepEqual(new Set(batched.current.binding.batch_message_ids),new Set(['137','138','139','140']));assert.equal(batched.relevant_events[0].interval_to_current.delta_ms,8000);
assert.equal(buildConversationTime({now,current,relevantEvents:Array.from({length:20},()=>previous)}).relevant_events_omitted,4);
// Named timezone formatting uses the actual zone, including historical DST,
// rather than assuming that every Shanghai date has always been UTC+08:00.
assert.equal(buildConversationTime({now:Date.parse('1989-06-01T12:00:00+09:00'),current}).computed_at.local_iso,'1989-06-01T12:00:00.000+09:00');
let getters=0;const unsafe={};Object.defineProperty(unsafe,'transport',{get(){getters++;return current;}});assert.equal(buildConversationTime({now,current:unsafe}).current.status,'unknown');assert.equal(getters,0);
const realNow=Date.now;Date.now=()=>{throw Error('Caller must supply a fresh clock value');};try{assert.equal(buildConversationTime({now,current}).computed_at.epoch_ms,now);}finally{Date.now=realNow;}
console.log('PASS fresh generation time, explicit Shanghai ISO/local, seconds-vs-ms provenance, previous same-scope incoming/actual sent, speaker distinction, delayed labels, midnight/negative/unknown, forward-original separation, queue/batch IDs, no ambient clock/timer/network');

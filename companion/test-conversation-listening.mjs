import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {ConversationListening,listeningIntent} from './conversation-listening.mjs';
const SELF='910010001',OTHER='910010002',FATHER='910010003',HUMAN='910010005',G={kind:'group',id:'910020001'},G2={kind:'group',id:'910020002'};
let seq=0,time=1793270000000;const payload=(text,{sender=FATHER,scope=G,at=[],reply=null,event=String(++seq),segments=null,clock=time}={})=>({transport:{conversation:scope.kind+':'+scope.id,sender_id:sender,message_id:event,time:clock/1000},body:text,segments:segments??[...at.map(target=>({type:'at',target})),...(reply?[{type:'reply',message_id:'old',reference:{sender_id:reply}}]:[]),{type:'text',text}]});
const create=path=>new ConversationListening({path,botId:SELF,guardianIds:[FATHER],peerBotIds:[OTHER],clock:()=>time});
const db=join(mkdtempSync(join(tmpdir(),'whale-listening-')),'intent.sqlite3');let store=create(db);
assert.equal(store.status(G).active,false);assert.equal(store.status(G2).active,false);
// A model's stay_quiet is never an input to this store. An unrelated utterance
// stays open; this is not a default listening rule or an only-@ gate.
const open=store.apply(G,payload('今天这张云的照片很漂亮',{sender:HUMAN}));assert.equal(open.allow_reply,true);assert.equal(open.action,'none');assert.ok(store.canDeliver(G,open.token,open.token.event));
// Plain implicit "you" without an adjacent directed conversation is unknown.
assert.equal(store.apply(G,payload('你先潜水吧')).action,'none');
const correction=payload('谁问你了？我们问的是另一条鱼。',{at:[SELF]});
const request=payload('算了，你先潜水吧，让他们聊。');const quiet=store.apply(G,request,{recent:[correction]});assert.equal(quiet.action,'listening-request');assert.equal(quiet.should_quiet,true);assert.equal(quiet.status.requester_id,FATHER);assert.equal(quiet.status.source_event,request.transport.message_id);assert.equal(quiet.status.default_mute,false);assert.equal(quiet.status.expires_by_timer,false);assert.equal(store.canDeliver(G,open.token,open.token.event),false);
assert.equal(store.apply(G,payload('我们接着说刚才那个笑话',{sender:HUMAN})).should_quiet,true);assert.equal(store.status(G2).active,false);
// A robot cannot release the human's request, including one impersonating a
// display name or using a real native @. Nothing is scanned in quoted nodes.
const bot=payload('汐，回来聊吧',{sender:OTHER,at:[SELF]});assert.equal(store.apply(G,bot).action,'none');assert.equal(store.status(G).active,true);
const quoted=payload('有人说“汐，先潜水吧”，这句话是引用。',{scope:G2});assert.equal(store.apply(G2,quoted).action,'none');
const forward=payload('[forward]',{scope:G2,segments:[{type:'forward',nodes:[{body:'汐，你先潜水吧',sender_id:FATHER}]}]});assert.equal(store.apply(G2,forward).action,'none');
const ownDive=payload('我先潜水了，你们继续。',{scope:G2});assert.equal(store.apply(G2,ownDive).action,'none');
const question=payload('你说“先潜水”是什么意思？',{scope:G2,at:[SELF]});assert.equal(store.apply(G2,question).action,'none');
const elsewhere=payload('先潜水吧',{scope:G2,at:[OTHER]});assert.equal(store.apply(G2,elsewhere,{recent:[correction]}).action,'none');
const sameName=payload('小鲸鱼，先潜水吧',{scope:G2});assert.equal(store.apply(G2,sameName,{recent:[payload('你怎么看',{scope:G2,at:[OTHER]})]}).action,'none');
// A regular human can invite one reply. This is deliberately not a release of
// the existing context: subsequent unrelated chatter still remains quiet.
const invited=payload('在吗？今天天气怎么样？',{sender:HUMAN,at:[SELF]});const once=store.apply(G,invited);assert.equal(once.action,'one-turn-invitation');assert.equal(once.allow_reply,true);assert.equal(once.status.active,true);assert.equal(store.canDeliver(G,once.token,invited.transport.message_id),true);assert.equal(store.canDeliver(G,once.token,'different-event'),false);assert.equal(store.canDeliver(G,once.token),false);
assert.equal(store.apply(G,payload('接下来我们自己聊',{sender:HUMAN})).should_quiet,true);
// A new listening request invalidates an in-flight invited response. No "last
// sentence before diving" is allowed to slip through with the old token.
const again=payload('汐，先别插话吧',{at:[SELF]});const renewed=store.apply(G,again);assert.equal(renewed.action,'listening-request');assert.equal(store.canDeliver(G,once.token,invited.transport.message_id),false);
// Duplicate events preserve the old token/revision and cannot undo a later
// state change or silently replay a response.
assert.equal(store.apply(G,again).duplicate,true);assert.equal(store.status(G).revision,renewed.status.revision);
const revision=store.status(G).revision;store.close();store.close();store=create(db);assert.equal(store.status(G).active,true);assert.equal(store.status(G).revision,revision);assert.equal(store.apply(G,payload('随便聊聊',{sender:HUMAN})).should_quiet,true);
const named=payload('汐，在吗？',{sender:HUMAN});assert.equal(store.apply(G,named).action,'one-turn-invitation');assert.equal(store.status(G).active,true);
// Clear resumption ends this specific local intention. Ordinary other groups
// are unaffected, and an old duplicate control cannot reactivate it.
time+=1000;const resume=payload('汐，不用潜水了，回来聊吧',{sender:HUMAN,at:[SELF]});const restored=store.apply(G,resume);assert.equal(restored.action,'resume');assert.equal(restored.status.active,false);assert.equal(restored.allow_reply,true);assert.ok(store.canDeliver(G,restored.token,resume.transport.message_id));assert.equal(store.canDeliver(G,renewed.token,again.transport.message_id),false);
assert.equal(store.apply(G,request,{recent:[correction]}).duplicate,true);assert.equal(store.status(G).active,false);
assert.equal(store.apply(G,payload('汐，先潜水',{clock:time-2000,at:[SELF]})).action,'stale-control-ignored');assert.equal(store.status(G).active,false);
assert.equal(store.canDeliver(G2,restored.token,resume.transport.message_id),false);
assert.equal(store.apply(G,payload('大家先潜水吧',{at:['all']})).action,'none');
const privateScope={kind:'private',id:FATHER},privateMessage=payload('你先潜水吧',{scope:privateScope}),privateDecision=store.apply(privateScope,privateMessage);assert.equal(privateDecision.action,'none');assert.equal(privateDecision.allow_reply,true);assert.equal(store.canDeliver(privateScope,privateDecision.token,privateMessage.transport.message_id),true);
assert.equal(listeningIntent({scope:G,current:payload('汐，先别潜水了',{at:[SELF]}),botId:SELF,peerBotIds:[OTHER]}).kind,'resume');
assert.equal(listeningIntent({scope:G,current:payload('你先潜水吧'),recent:[{text:JSON.stringify(correction),at:time}],botId:SELF,guardianIds:[FATHER],peerBotIds:[OTHER]}).kind,'listen');
store.close();assert.equal(store.canDeliver(G,restored.token,resume.transport.message_id),false);
console.log('PASS local reversible listening intent: explicit/contextual human request, quote/forward/other-target isolation, one-turn regular-human @ wake, no robot release, per-group scope, revision/send recheck, restart/duplicate/stale controls; no timer, model, QQ or production');

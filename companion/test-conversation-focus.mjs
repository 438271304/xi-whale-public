import assert from 'node:assert/strict';
import {conversationFocus,selectBatchAnchor} from './conversation-focus.mjs';
import {transportMessage} from './group-message.mjs';
import {conversationScope} from './conversation-scope.mjs';

const scope=conversationScope('group','12345'),other=conversationScope('group','23456'),botId='34567',fish='45678',human='56789',second='67890';
const text=value=>({type:'text',data:{text:value}}),at=target=>({type:'at',data:{qq:target}}),reply=event=>({type:'reply',data:{id:event}});
const raw=(event,segments,{sender=human,group=scope.id}={})=>({post_type:'message',message_type:'group',group_id:group,user_id:sender,message_id:event,time:1700027403,message:segments,sender:{card:'小鲸鱼'}});
const refs=new Map(),structured=message=>transportMessage(message,{scope:conversationScope(message.message_type,message.message_type==='group'?message.group_id:message.user_id),botId,resolveReply:event=>refs.get(event)??null});
const payload=(event,segments,options)=>structured(raw(event,segments,options));
const focus=(current,recent=[],s=scope)=>conversationFocus({scope:s,botId,peerBots:[fish],current,recent});

// Actual native segments outrank nickname text, stale attention and other quotes.
const otherAsk=payload(1,[at(fish),text('汐，你怎么看')]);assert.equal(focus(otherAsk).attention,'others');assert.equal(focus(otherAsk).reason,'native-at-other');
const selfAsk=payload(2,[at(botId),text('小鲸鱼，你怎么看')]);assert.equal(focus(selfAsk).attention,'direct');assert.deepEqual(focus(selfAsk).target_ids,[botId]);
const conflicting=payload(3,[at(fish),at(botId),text('一起看看')]);assert.equal(focus(conflicting).attention,'direct');
const fakeDirect=payload(4,[text('普通闲聊')]);fakeDirect.transport.attention='direct';fakeDirect.body='[at:'+botId+']';assert.equal(focus(fakeDirect).attention,'open');
assert.equal(focus(payload(5,[text('[CQ:at,qq='+botId+'] 你怎么看')])).attention,'open');
assert.equal(focus(payload(6,[text('天气不错，一起聊聊')])).attention,'open');
assert.equal(focus(payload(7,[text('大家看看新话题')]),[otherAsk]).attention,'open');
assert.equal(focus(payload(8,[text('刚才小鲸鱼说得挺有趣')]),[otherAsk]).attention,'open');
assert.equal(focus(payload(9,[text('汐，你觉得呢？')])).attention,'direct');
assert.equal(focus(payload(10,[text('汐帮我看一下这个问题')])).attention,'direct');
assert.equal(focus(payload(11,[text('小鲸鱼，帮我看一下')])).attention,'open');
assert.equal(focus(payload(12,[text('“汐，你怎么看”是她的原话')])).attention,'open');
for(const content of ['@小鲸鱼','@小鲸鱼 你怎么看这个事情？','小鲸鱼','你怎么看？','你呢','然后呢']){
 const result=focus(payload(20,[text(content)]),[otherAsk]);assert.equal(result.attention,'others',content);assert.equal(result.source,'adjacent-native-target');assert.deepEqual(result.target_ids,[fish]);assert.equal(result.evidence[0].event,'1');
}
// No unbounded recipient inheritance across new topics, speakers or quotes.
for(const content of ['我换个话题，大家喜欢什么游戏','今天看到个新视频，大家看吗','汐，帮我读一下这条新消息'])assert.notEqual(focus(payload(21,[text(content)]),[otherAsk]).attention,'others');
const interrupted=payload(22,[text('换我说一下')],{sender:second});assert.equal(focus(payload(23,[text('@小鲸鱼')]),[otherAsk,interrupted]).attention,'open');
const nextOpen=payload(24,[text('大家聊点别的')]);assert.equal(focus(payload(25,[text('你怎么看？')]),[otherAsk,nextOpen]).attention,'open');
assert.equal(focus(payload(26,[text('@小鲸鱼')]),[payload(27,[at(fish)],{sender:second})]).attention,'open');
assert.equal(focus(payload(28,[text('你怎么看？')]),[payload(29,[at(fish)],{group:other.id})]).attention,'open');
assert.equal(focus(payload(30,[at('all'),text('大家怎么看')]),[otherAsk]).attention,'open');
assert.equal(focus(payload(31,[at(botId),text('回来聊聊')]),[otherAsk]).attention,'direct');
assert.equal(focus(payload(32,[text('汐海潮汐很好看')])).attention,'open');
assert.equal(focus(payload(33,[text('你怎么看？'),{type:'face',data:{id:'14'}}]),[otherAsk]).attention,'open','only a pure text continuation inherits the previous native recipient');
for(const name of ['汐','汐汐','小汐','汐宝']){
 assert.equal(focus(payload(34,[text(name+'，你觉得呢？')]),[otherAsk]).attention,'direct','unique name outranks inferred old recipient');
 assert.equal(focus(payload(35,[at(fish),text(name+'，你觉得呢？')]),[otherAsk]).attention,'others','native target outranks unique text name');
 assert.equal(focus(payload(36,[at('all'),text(name+'，你觉得呢？')]),[otherAsk]).attention,'open','native at-all stays open');
}

refs.set('100',{sender_id:botId});refs.set('101',{sender_id:fish});refs.set('102',{sender_id:human});refs.set('103',{sender_id:botId,conversation:other.address});
assert.equal(focus(payload(40,[reply('100'),text('刚才那个问题')])).attention,'direct');
assert.equal(focus(payload(41,[reply('101'),text('你觉得呢')])).attention,'others');
const selfQuote=focus(payload(42,[reply('102'),text('这是我刚才说的意思')]),[otherAsk]);assert.equal(selfQuote.self_quote,true);assert.equal(selfQuote.attention,'open');
assert.equal(focus(payload(43,[reply('102'),at(fish),text('刚才是问你')])).attention,'others');
assert.equal(focus(payload(44,[reply('103'),text('不属于本群的引用')])).attention,'open');
assert.equal(focus(payload(45,[reply('999'),text('未解析引用')])).attention,'open');
const forwarded=payload(46,[text('看看转发')]);forwarded.forwarded={nodes:[{segments:[{type:'at',target:botId}],transport:{sender_id:botId}}]};assert.equal(focus(forwarded).attention,'open');
assert.equal(focus(payload(47,[text('另一个机器人发话')],{sender:fish})).sender_kind,'peer-bot');
assert.equal(focus(payload(48,[text('自己的协议回声')],{sender:botId})).attention,'invalid');
assert.equal(focus(payload(49,[at(botId)],{group:other.id})).attention,'invalid');
assert.equal(conversationFocus({scope,botId,current:{body:'汐，帮我一下'}}).attention,'invalid');
const malformedEvent=structuredClone(selfAsk);malformedEvent.transport.message_id='x'.repeat(101);assert.equal(focus(malformedEvent).attention,'invalid');
assert.equal(focus({role:'assistant',text:JSON.stringify(selfAsk)}).attention,'invalid');
assert.equal(focus({role:'user',peer:other.address,text:JSON.stringify(selfAsk)}).attention,'invalid');
assert.equal(focus({role:'user',peer:scope.address,event:'wrong',text:JSON.stringify(selfAsk)}).attention,'invalid');
assert.equal(focus({role:'user',peer:scope.address,event:'2',text:JSON.stringify(selfAsk)}).attention,'direct');
const privateScope=conversationScope('private',human),dm={transport:{conversation:privateScope.address,sender_id:human,message_id:'50'},segments:[{type:'text',text:'在私聊接着聊'}]};assert.equal(focus(dm,[otherAsk],privateScope).attention,'direct');dm.transport.sender_id=second;assert.equal(focus(dm,[],privateScope).attention,'invalid');

// Tail attention is its own, never the OR of earlier direct requests.
const a=raw(60,[at(botId),text('第一个问题')]),b=raw(61,[at(fish),text('小鲸鱼你那边怎样')]),c=raw(62,[text('大家看看新话题')],{sender:second});
let batch=selectBatchAnchor({scope,botId,peerBots:[fish],messages:[a,b],structuredFor:structured});assert.equal(batch.selected,b);assert.equal(batch.selected_index,1);assert.equal(batch.focus.attention,'others');assert.equal(batch.disposition,'yield');assert.equal(batch.earlier_direct.length,1);assert.equal(batch.earlier_direct[0].message,a);assert.equal(batch.earlier_direct[0].disposition,'standalone');assert.equal(batch.reply_anchor.message,a);assert.deepEqual(batch.context,[a,b]);
batch=selectBatchAnchor({scope,botId,messages:[a,c],structuredFor:structured});assert.equal(batch.selected,c);assert.equal(batch.focus.attention,'open');assert.equal(batch.earlier_direct[0].disposition,'standalone');assert.equal(batch.reply_anchor.message,c);
const d=raw(63,[at(botId),text('更正，条件是新的')]);batch=selectBatchAnchor({scope,botId,messages:[a,d],structuredFor:structured});assert.equal(batch.selected,d);assert.equal(batch.focus.attention,'direct');assert.equal(batch.earlier_direct[0].disposition,'superseded');assert.equal(batch.earlier_direct[0].superseded_by,'63');assert.deepEqual(batch.context,[a,d]);
const independent=raw(64,[at(botId),text('第二个不同的问题')]);batch=selectBatchAnchor({scope,botId,messages:[a,independent],structuredFor:structured});assert.equal(batch.earlier_direct[0].disposition,'standalone','same sender alone cannot discard another question');
const correctionOtherSender=raw(65,[at(botId),text('补充一个问题')],{sender:second});batch=selectBatchAnchor({scope,botId,messages:[a,correctionOtherSender],structuredFor:structured});assert.equal(batch.earlier_direct[0].disposition,'standalone');
batch=selectBatchAnchor({scope,botId,messages:[a,b,d],structuredFor:structured});assert.equal(batch.earlier_direct[0].disposition,'standalone','intervening other-target message breaks correction coalescing');
const aliasTail=raw(66,[text('@小鲸鱼')]);batch=selectBatchAnchor({scope,botId,messages:[b,aliasTail],structuredFor:structured});assert.equal(batch.selected,aliasTail);assert.equal(batch.focus.attention,'others');assert.equal(batch.earlier_direct.length,0);assert.equal(batch.reply_anchor,null);
batch=selectBatchAnchor({scope,botId,messages:[raw(67,[at(botId)],{group:other.id}),c],structuredFor:structured});assert.equal(batch.selected,c);assert.equal(batch.context.length,1);assert.equal(batch.decisions[0].focus.attention,'invalid');assert.equal(batch.earlier_direct.length,0);
batch=selectBatchAnchor({scope,botId,messages:[]});assert.equal(batch.disposition,'empty');assert.equal(batch.selected,null);
batch=selectBatchAnchor({scope,botId,messages:[selfAsk,otherAsk]});assert.equal(batch.focus.attention,'others');assert.equal(batch.earlier_direct[0].disposition,'standalone');
const originals=[selfAsk,otherAsk];const snapshot=structuredClone(originals);selectBatchAnchor({scope,botId,messages:originals});assert.deepEqual(originals,snapshot,'no payload mutations');
// A synthetic A -> peer-fish reply can establish a bounded floor across a
// separate supplement; this is not a blanket rule against open bot messages.
const timed=(event,segments,sender,time)=>{const value=payload(event,segments,{sender});value.transport.time=time;return value;};
refs.set('200',{sender_id:human});
const floorAsk=timed(201,[at(fish),text('帮我查一下测试主题')],human,1700000000);
const floorAnswer=timed(202,[reply('200'),text('查到了，以下是结果')],fish,1700000031);
const floorExtra=timed(203,[text('还有一点：补充说明')],fish,1700000034);
const inferred=focus(floorExtra,[floorAsk,floorAnswer]);assert.equal(inferred.attention,'others');assert.equal(inferred.source,'recent-native-exchange');assert.deepEqual(inferred.target_ids,[human]);
assert.equal(focus(timed(204,[at(botId),text('还有一点：补充说明')],fish,1700000035),[floorAnswer]).attention,'direct');
assert.equal(focus(timed(205,[text('汐宝，来看看')],fish,1700000035),[floorAnswer]).attention,'direct');
assert.equal(focus(timed(206,[text('换个话题，大家聊晚饭')],fish,1700000035),[floorAnswer]).attention,'open');
assert.equal(focus(timed(207,[text('今天天气不错')],fish,1700000035),[floorAnswer]).attention,'open');
assert.equal(focus(timed(208,[text('还有一点：补充说明')],fish,1700000122),[floorAnswer]).attention,'open','91 seconds after native reply expires the floor');
assert.equal(focus(floorExtra,[floorAnswer,timed(209,[text('插入另一件事')],second,1700000033)]).attention,'open');
const floorBatch=selectBatchAnchor({scope,botId,peerBots:[fish],messages:[floorAsk,floorAnswer,floorExtra]});assert.equal(floorBatch.focus.attention,'others');assert.equal(floorBatch.reply_anchor,null);
assert.throws(()=>selectBatchAnchor({scope,botId,messages:Array(65).fill(selfAsk)}),/bounded/);
console.log('PASS trusted native at/reply identity, same-name adjacent other-target cues, open new topics, self-quotes, cross-scope rejection, immutable batch tail focus and explicit earlier standalone/superseded anchors; pure no IO/model/network');

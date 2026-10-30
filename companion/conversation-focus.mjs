// Pure addressing evidence. Callers supply admitted transportMessage payloads,
// oldest-to-newest recent user records, and trusted identity/scope configuration.
// Names are conversational cues, never account identity or action authorization.
import {inferOtherExchange} from './conversation-floor.mjs';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>/^\d{5,15}$/.test(String(value??''))?String(value):null;
function scopeKey(value){
 if(typeof value==='string'){const match=/^(group|private)[:-](\d{5,15})$/.exec(value);return match?match[1]+':'+match[2]:null;}
 if(!object(value)||!['group','private'].includes(value.kind)||!id(value.id))return null;
 const key=value.kind+':'+String(value.id);
 if(value.address!==undefined&&value.address!==key||value.key!==undefined&&value.key!==key.replace(':','-'))return null;return key;
}
function payload(value){
 if(!object(value)||value.role!==undefined&&value.role!=='user')return null;
 if(object(value.transport))return value;
 if(typeof value.text!=='string'||value.text.length>200000)return null;
 try{const parsed=JSON.parse(value.text);return object(parsed)&&object(parsed.transport)?parsed:null;}catch{return null;}
}
const eventOf=value=>typeof value==='string'&&value.length>0&&value.length<=100&&!/[\x00-\x1f\x7f]/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)?String(value):null;
function normalized(value,key,botId){
 const data=payload(value),t=data?.transport,sender=id(t?.sender_id),event=eventOf(t?.message_id);
 if(!data||!key||!sender||!event||scopeKey(t.conversation)!==key||t.event_kind)return null;
 if(value.peer!==undefined&&scopeKey(value.peer)!==key||value.scope!==undefined&&scopeKey(value.scope)!==key||value.event!==undefined&&String(value.event)!==event)return null;
 if(key.startsWith('private:')&&sender!==key.slice(8))return null;
 const segments=Array.isArray(data.segments)?data.segments:[];
 const targets=[...new Set(segments.filter(s=>s?.type==='at').map(s=>s.target==='all'?'all':id(s.target)).filter(Boolean))];
 const references=segments.filter(s=>s?.type==='reply'&&object(s.reference)).filter(s=>{
  const ref=s.reference,claimed=ref.conversation??ref.scope;return claimed===undefined||scopeKey(claimed)===key;
 }).map(s=>({event:eventOf(s.message_id),sender_id:id(s.reference.sender_id)})).filter(s=>s.sender_id);
 const text=segments.filter(s=>s?.type==='text'&&typeof s.text==='string').map(s=>s.text).join('').trim();
 return {data,key,sender,event,targets,references,text,textOnly:segments.length>0&&segments.every(s=>s?.type==='text'),selfQuote:references.some(s=>s.sender_id===sender),self:sender===botId};
}
function nativeTarget(row,botId){
 if(row.targets.includes(botId))return {attention:'direct',reason:'native-at-self',source:'native-at',targets:row.targets.filter(t=>t!=='all')};
 const targets=row.targets.filter(t=>t!=='all');if(targets.length)return {attention:'others',reason:'native-at-other',source:'native-at',targets};
 if(row.references.some(r=>r.sender_id===botId))return {attention:'direct',reason:'native-reply-self',source:'native-reply',targets:[botId]};
 const referenced=[...new Set(row.references.map(r=>r.sender_id).filter(target=>target!==row.sender))];
 if(referenced.length)return {attention:'others',reason:'native-reply-other',source:'native-reply',targets:referenced};
 return null;
}
function textCall(text){
 const match=/^(?:请\s*)?(@\s*)?(小鲸鱼|汐汐|小汐|汐宝|汐)(?=$|[\s，,、:：!！?？~～。.]|你|在|来|帮|能|给|回|出来)([\s\S]*)$/.exec(text);
 if(!match)return null;return {alias:match[2],unique:match[2]!=='小鲸鱼',textAt:!!match[1],rest:match[3].replace(/^[\s，,、:：!！?？~～。.]+/,'').trim()};
}
const bareQuestion=text=>/^(?:那)?(?:你呢|你怎么看|你觉得呢|你说呢|你觉得怎么样|怎么看|怎么说|然后呢|还有呢|在吗|在不在|为什么|为啥|呢)[\s，,。.!！?？~～]*$/.test(text);
const aliasOnly=call=>call&&!call.rest;
function previousRow(recent,key,botId,currentEvent){
 if(!Array.isArray(recent))return null;
 for(let i=recent.length-1;i>=Math.max(0,recent.length-24);i--){
  const row=normalized(recent[i],key,botId);if(!row||row.event===currentEvent||row.self)continue;return row;
 }
 return null;
}

export function conversationFocus({scope,botId,peerBots=[],current,recent=[]}={}){
 const key=scopeKey(scope),self=id(botId),row=normalized(current,key,self),bots=new Set((peerBots instanceof Set?[...peerBots]:Array.isArray(peerBots)?peerBots:[]).map(id).filter(Boolean));
 const base={scope:key,current_event:row?.event??null,sender_id:row?.sender??null,sender_kind:row?.self?'self':bots.has(row?.sender)?'peer-bot':'other-account',self_quote:row?.selfQuote??false,target_ids:[],evidence:[]};
 if(!self||!row||row.self)return {...base,attention:'invalid',reason:row?.self?'self-message':'unverified-current-source',source:'invalid'};
 const evidence=(r,n)=>({scope:key,event:r.event,sender_id:r.sender,source:n.source,target_ids:[...n.targets]});
 if(key.startsWith('private:'))return {...base,attention:'direct',reason:'private-correspondent',source:'private-scope',target_ids:[self]};
 const native=nativeTarget(row,self);if(native)return {...base,attention:native.attention,reason:native.reason,source:native.source,target_ids:native.targets,evidence:[evidence(row,native)]};
 if(row.targets.includes('all'))return {...base,attention:'open',reason:'native-at-all',source:'native-at',evidence:[{scope:key,event:row.event,sender_id:row.sender,source:'native-at',target_ids:['all']}]};
 // A self-quote can clarify a request, but is not an at to another account.
 // The immediately preceding same-scope user is necessary evidence; never scan
 // past an intervening speaker to indefinitely inherit an old recipient.
 const call=textCall(row.text),prior=previousRow(recent,key,self,row.event),priorNative=prior?nativeTarget(prior,self):null;
 // A unique self-name can call Xi back; the shared nickname cannot identify
 // either fish by itself. Actual native segments above remain authoritative.
 if(call?.unique)return {...base,attention:'direct',reason:'explicit-text-vocative',source:'text-vocative',target_ids:[self],text_call:{alias:call.alias,text_at:call.textAt},evidence:[]};
 const narrow=row.textOnly&&!!(call?.textAt||aliasOnly(call)||bareQuestion(call?call.rest:row.text));
 if(!row.targets.includes('all')&&!row.selfQuote&&narrow&&prior?.sender===row.sender&&priorNative?.attention==='others'){
  return {...base,attention:'others',reason:'adjacent-native-other-continuation',source:'adjacent-native-target',target_ids:priorNative.targets,evidence:[evidence(prior,priorNative)],text_call:call?{alias:call.alias,text_at:call.textAt}:null};
 }
 const floor=inferOtherExchange({scope,botId:self,peerBots,current,recent});
 if(floor)return {...base,...floor};
 if(call)return {...base,attention:'open',reason:'shared-name-open-context',source:'text-shared-name',text_call:{alias:call.alias,text_at:call.textAt}};
 return {...base,attention:'open',reason:row.selfQuote?'self-quote-keeps-open-context':'ordinary-open-conversation',source:'none'};
}

function supersedes(previous,next){
 if(previous.focus.sender_id!==next.focus.sender_id||next.focus.attention!=='direct')return false;
 const row=payload(next.structured),segments=row?.segments??[];
 if(segments.some(s=>s?.type==='reply'&&String(s.message_id)===previous.focus.current_event&&id(s.reference?.sender_id)===next.focus.sender_id))return true;
 let text=segments.filter(s=>s?.type==='text'&&typeof s.text==='string').map(s=>s.text).join('').trim();const call=textCall(text);if(call)text=call.rest;
 return /^(?:补充|更正|纠正|改成|改为|刚才(?:那条|那个|说的|我说)|上(?:一)?条|前(?:一)?条|再加(?:一条条件|个条件))/.test(text);
}

export function selectBatchAnchor({scope,botId,peerBots=[],messages=[],recent=[],structuredFor=message=>message}={}){
 if(!Array.isArray(messages)||messages.length>64||typeof structuredFor!=='function')throw TypeError('Invalid bounded conversation batch');
 const decisions=[],valid=[],context=[];
 for(let index=0;index<messages.length;index++){
  const message=messages[index];let structured;try{structured=structuredFor(message,index);}catch{structured=null;}
  const focus=conversationFocus({scope,botId,peerBots,current:structured,recent:[...(Array.isArray(recent)?recent:[]),...valid.map(v=>v.structured)]});
  const item={message,index,structured,focus};decisions.push(item);if(focus.attention!=='invalid'){valid.push(item);context.push(message);}
 }
 const selected=valid.at(-1)??null,earlier=[];
 for(let i=0;i<valid.length-1;i++){
  const item=valid[i];if(item.focus.attention!=='direct')continue;
  const next=valid[i+1],replaced=supersedes(item,next);
  earlier.push({message:item.message,index:item.index,focus:item.focus,disposition:replaced?'superseded':'standalone',superseded_by:replaced?next.focus.current_event:null});
 }
 const standalones=earlier.filter(item=>item.disposition==='standalone'),replyAnchor=selected?.focus.attention==='others'?(standalones.at(-1)??null):selected;
 return {selected:selected?.message??null,selected_index:selected?.index??null,focus:selected?.focus??null,disposition:!selected?'empty':selected.focus.attention==='others'?'yield':'tail',earlier_direct:earlier,reply_anchor:replyAnchor?{message:replyAnchor.message,index:replyAnchor.index,focus:replyAnchor.focus}:null,context,decisions,
  notice:'Selected is the latest valid message in this scope. Earlier standalone direct requests require their own source/receipt; never upgrade the selected tail from a different message.'};
}

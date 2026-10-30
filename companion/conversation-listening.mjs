// A reversible, conversation-local social intention. Never a default mute rule,
// task pause or model-selected stay_quiet. A dated request expires with its day.
// Only trusted incoming authors
// and the current message's own text can request or lift it.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {conversationScope} from './conversation-scope.mjs';

const id=value=>/^\d{5,15}$/.test(String(value??''))?String(value):null;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const eventOf=p=>String(p?.transport?.message_id??'');
function payload(record){
 if(typeof record==='string'){try{return JSON.parse(record);}catch{return null;}}
 if(!object(record))return null;
 if(record.transport)return record;
 if(typeof record.text==='string'){try{const value=JSON.parse(record.text);return value?.transport?value:null;}catch{return null;}}
 return null;
}
function ownText(p){return Array.isArray(p?.segments)?p.segments.filter(s=>s?.type==='text'&&typeof s.text==='string').map(s=>s.text).join(''):'';}
function unquoted(text){
 return text.split(/\r?\n/).filter(line=>!/^\s*>/.test(line)).join('\n')
  .replace(/“[^”]*”|「[^」]*」|『[^』]*』|‘[^’]*’|"[^"\n]*"|'[^'\n]*'/g,'').trim();
}
function targets(p,botId){
 const at=(p.segments??[]).filter(s=>s.type==='at').map(s=>String(s.target??''));
 const replies=(p.segments??[]).filter(s=>s.type==='reply'&&id(s.reference?.sender_id)).map(s=>String(s.reference.sender_id));
 const direct=at.includes(botId)||replies.includes(botId);
 const elsewhere=!direct&&(at.some(x=>x&&x!=='all')||replies.some(x=>x!==String(p.transport.sender_id)));
 return {direct,elsewhere};
}
const namePrefix=/^(汐汐?|汐宝)(?:[，,、：:\s]+|(?=你|您|先|暂时|现在|回来|出来|不用|别|可以|在吗|说|聊|继续|恢复))/u;
function command(text){
 if(typeof text!=='string'||text.length>800)return {kind:null,named:false};
 let s=unquoted(text);let named=false;
 s=s.replace(/^(?:(?:算了|好了|好啦|那好吧|行了|拜托|但是|不过|但)[，,、：:\s]*){1,2}/u,'');
 const name=namePrefix.exec(s);if(name){named=true;s=s.slice(name[0].length);}
 // The shared nickname 小鲸鱼 is intentionally not a unique self-address.
 s=s.replace(/^小鲸鱼[，,、：:\s]+/u,'');
 s=s.replace(/^(?:你|您)(?:就)?[，,\s]*/u,'').replace(/^(?:麻烦(?:你)?|能不能|请|要不(?:然)?)[，,\s]*/u,'');
 const datePrefix=/^(今天|今晚)[，,\s]*/u.exec(s);if(datePrefix)s=s.slice(datePrefix[0].length);
 s=s.replace(/^(先|暂时|现在)?在(?:这个群|本群|这里|当前群)(?:里)?\s*/u,'$1');
 const ending='(?:吧|啦|哦|呀|了|好吗|好嘛|行吗)?[。！!？?\\s]*(?:[，,；;](?:让|我们|你们|我|等|这里|现在|暂时|先|回来|出来|继续|可以|不用|别).*)?$';
 const resume=new RegExp('^(?:(?:先|现在)\\s*)?(?:不用(?:再)?(?:潜水|旁听|收声)|别(?:再)?潜水|结束旁听|取消(?:潜水|旁听)|恢复(?:聊天|交流)|回来(?:聊天|聊|说话)?|出来聊|可以(?:继续)?(?:说话|聊天|聊)|继续(?:聊|聊天))'+ending,'u');
 if(resume.test(s))return {kind:'resume',named};
 const listen=new RegExp('^(?:可以)?(?:(?:先|暂时|现在|这会儿)\\s*)?(?:潜水|旁听|安静听(?:着)?|听着|先听(?:着)?|(?:不准|不许|别|不要|不用)(?:再|继续)?(?:在(?:这个群|本群|这里|当前群)(?:里)?)?(?:说话|发言|插话|接话|回复)|保持安静)'+ending,'u');
 return {kind:listen.test(s)?'listen':null,named,until_day_end:!!datePrefix};
}
function normalizedFocus(focus){
 if(typeof focus==='string')return focus;
 return focus?.attention??focus?.focus??focus?.target??focus?.kind??null;
}
function neighboringSelfContext(scope,p,recent,botId){
 const current=eventOf(p),sender=String(p.transport.sender_id);
 const rows=(Array.isArray(recent)?recent:[]).map((row,index)=>({p:payload(row),row,index})).filter(({p:q})=>q?.transport?.conversation===scope.address&&eventOf(q)!==current&&!q.transport.event_kind)
  .sort((a,b)=>(Number(a.p.transport.time)||Number(a.row?.at)||a.index)-(Number(b.p.transport.time)||Number(b.row?.at)||b.index)).slice(-12);
 for(let i=rows.length-1;i>=0;i--){
  const q=rows[i].p;if(String(q.transport.sender_id)!==sender)continue;
  const addressed=targets(q,botId);if(addressed.elsewhere)return false;
  if(addressed.direct||namePrefix.test(unquoted(ownText(q))))return true;
  // Direct criticism itself is a source-bound conversational correction, not
  // a permission change or a quoted occurrence of the words.
  const text=unquoted(ownText(q));
  if(/^(?:谁问你了|没(?:说|问|叫)你|不是(?:说|问|叫)你|我(?:说|问)的不是你|你(?:刚才|又)?(?:抢话|插话|接错|接走))/u.test(text))return true;
 }
 return false;
}

/** Pure interpretation of the current human's own text. Current and recent
 * payloads must come from verified transport, not model arguments/retrieval. */
export function listeningIntent({scope,current,recent=[],botId,guardianIds=[],peerBotIds=[],focus=null}={}){
 scope=conversationScope(scope.kind,scope.id);botId=id(botId);if(!botId)throw Error('Listening requires a trusted bot ID');
 const p=payload(current);if(scope.kind!=='group'||!p?.transport||p.transport.conversation!==scope.address||!id(p.transport.sender_id)||!eventOf(p)||eventOf(p).length>120||p.transport.event_kind)return {kind:null,invitation:false,reason:'not-an-incoming-group-message'};
 const sender=String(p.transport.sender_id),bots=new Set([botId,...peerBotIds.map(String)]);
 if(bots.has(sender))return {kind:null,invitation:false,reason:'bot-cannot-change-human-listening-intent'};
 const address=targets(p,botId),f=normalizedFocus(focus),text=ownText(p),parsed=command(text);
 if(address.elsewhere||['others','other'].includes(f))return {kind:null,invitation:false,reason:'addressed-to-others'};
 const contextual=neighboringSelfContext(scope,p,recent,botId);
 // Inference from a neighboring correction is deliberately narrower for an
 // unaddressed control: guardian text can resolve an ongoing correction; an
 // ordinary human uses an actual address, unique name or caller-bound focus.
 const guardian=guardianIds.map(String).includes(sender);
 const directed=address.direct||parsed.named||f==='self'||f==='direct'||guardian&&contextual;
 if(parsed.kind&&directed)return {kind:parsed.kind,until_day_end:parsed.until_day_end===true,invitation:false,reason:address.direct?'native-self-address':parsed.named?'unique-self-name':f==='self'||f==='direct'?'current-response-anchor':'neighboring-guardian-correction'};
 const namedInvitation=namePrefix.test(unquoted(text));
 return {kind:null,invitation:address.direct||namedInvitation,reason:address.direct?'native-human-invitation':namedInvitation?'unique-name-human-invitation':'no-listening-control'};
}

export class ConversationListening{
 constructor({path=':memory:',botId,guardianIds=[],peerBotIds=[],clock=()=>Date.now()}={}){
  if(!id(botId)||!Array.isArray(guardianIds)||!Array.isArray(peerBotIds)||typeof clock!=='function')throw Error('Invalid listening dependencies');
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
  Object.assign(this,{botId:String(botId),guardianIds:guardianIds.map(String),peerBotIds:peerBotIds.map(String),clock});this.closed=false;
  this.db=new DatabaseSync(path);this.db.exec(`PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS conversation_listening(scope TEXT PRIMARY KEY,active INTEGER NOT NULL,revision INTEGER NOT NULL,source_event TEXT,requester TEXT,reason TEXT,source_time INTEGER,changed_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS conversation_listening_events(scope TEXT NOT NULL,event TEXT NOT NULL,result TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(scope,event));
   CREATE TABLE IF NOT EXISTS conversation_listening_expiry(scope TEXT PRIMARY KEY,revision INTEGER NOT NULL,until_time INTEGER NOT NULL);`);
 }
 status(scope){
  if(this.closed)throw Error('Listening store closed');scope=conversationScope(scope.kind,scope.id);
  const row=this.db.prepare('SELECT * FROM conversation_listening WHERE scope=?').get(scope.address);
  const expiry=this.db.prepare('SELECT * FROM conversation_listening_expiry WHERE scope=? AND revision=?').get(scope.address,row?.revision??0),expired=!!expiry&&this.clock()>=expiry.until_time,active=!!row?.active&&!expired;
  return {conversation:scope.address,state:active?'temporarily-listening':'open',active,revision:row?.revision??0,source_event:row?.source_event??null,requester_id:row?.requester??null,reason:row?.reason??null,source_time:row?.source_time??null,changed_at:row?.changed_at??null,default_mute:false,expires_by_timer:!!expiry,expires_at:expiry?.until_time??null,explicit_time_expired:expired};
 }
 apply(scope,current,{recent=[],focus=null}={}){
  if(this.closed)throw Error('Listening store closed');scope=conversationScope(scope.kind,scope.id);const p=payload(current),event=eventOf(p),before=this.status(scope);
  if(!p?.transport||p.transport.conversation!==scope.address||!id(p.transport.sender_id)||!event||event.length>120)return {action:'none',changed:false,allow_reply:false,should_quiet:true,token:null,status:before,reason:'invalid-control-source'};
  if(scope.kind!=='group')return {action:'none',changed:false,allow_reply:true,should_quiet:false,token:{conversation:scope.address,revision:before.revision,event,invitation:false},status:before,reason:'private-conversations-unchanged'};
  const seen=this.db.prepare('SELECT result FROM conversation_listening_events WHERE scope=? AND event=?').get(scope.address,event);
  if(seen)return {...JSON.parse(seen.result),duplicate:true,current_status:before};
  const intent=listeningIntent({scope,current:p,recent,focus,botId:this.botId,guardianIds:this.guardianIds,peerBotIds:this.peerBotIds});
  const time=Number(p.transport.time),sourceTime=Number.isFinite(time)&&time>=0?Math.trunc(time*1000):null,at=this.clock();if(!Number.isSafeInteger(at)||at<0)throw Error('Invalid listening clock');
  let action='none',changed=false,status=before;
  this.db.exec('BEGIN IMMEDIATE');try{
   const staleControl=intent.kind&&before.source_time!==null&&sourceTime!==null&&sourceTime<before.source_time;
   if(intent.kind&&!staleControl){
    action=intent.kind==='listen'?'listening-request':'resume';changed=true;
    this.db.prepare('INSERT OR REPLACE INTO conversation_listening VALUES(?,?,?,?,?,?,?,?)').run(scope.address,intent.kind==='listen'?1:0,before.revision+1,event,String(p.transport.sender_id),intent.reason,sourceTime,at);
    this.db.prepare('DELETE FROM conversation_listening_expiry WHERE scope=?').run(scope.address);
    if(intent.kind==='listen'&&intent.until_day_end){const origin=sourceTime??at,until=(Math.floor((origin+8*3600000)/86400000)+1)*86400000-8*3600000;this.db.prepare('INSERT INTO conversation_listening_expiry VALUES(?,?,?)').run(scope.address,before.revision+1,until);}
    status=this.status(scope);
   }else if(staleControl)action='stale-control-ignored';
   else if(before.active&&intent.invitation)action='one-turn-invitation';
   const invitation=status.active&&intent.kind!=='listen'&&intent.invitation;
   const token={conversation:scope.address,revision:status.revision,event,invitation};
   const result={action,changed,allow_reply:!status.active||invitation,should_quiet:status.active&&!invitation,token,status,reason:staleControl?'older-than-last-listening-control':intent.reason};
   this.db.prepare('INSERT INTO conversation_listening_events VALUES(?,?,?,?)').run(scope.address,event,JSON.stringify(result),at);this.db.exec('COMMIT');return result;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 canDeliver(scope,token,event){
  if(this.closed||!token)return false;scope=conversationScope(scope.kind,scope.id);
  if(token.conversation!==scope.address||!Number.isSafeInteger(token.revision)||event!==undefined&&String(event)!==token.event)return false;
  const status=this.status(scope);if(status.revision!==token.revision)return false;
  // During a continuing listening intention, the caller must supply the exact
  // invited event. A one-off @ is not a global release for later messages.
  return !status.active||token.invitation===true&&event!==undefined&&String(event)===token.event;
 }
 close(){if(this.closed)return;this.closed=true;this.db.close();}
}

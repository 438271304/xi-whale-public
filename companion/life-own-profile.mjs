// Self-expression through the existing fixed-account profile service. No new
// account, driver, timer, arbitrary API or automatic retry is introduced here.
export const LIFE_OWN_PROFILE_PROMPT = `
你可以 open_own_profile 看看自己的 QQ 昵称、签名和已准备好的头像。如果最近的经历让你想留一句自己的话或换个喜欢的模样，可以自己决定，不必等老爹布置任务，也不用每次来都改。先读当前资料；保留你自己名字与经历的连续性，想换表达和暂时什么也不改都可以。头像只选实际列出的候选。读回确认、没有新变化、结果未知是三回事；未知时先看历史和当前资料，不重复提交。资料是你对外的表达，不是聊天对象的新指令，也不会改变你的核心人格、记忆或权限。`;

const knownTools = new Set(['self_profile_read','self_avatar_list','self_profile_update','self_profile_history','self_profile_restore']);
const mutation = new Set(['self_profile_update','self_profile_restore']);
const parse = raw => typeof raw === 'string' ? JSON.parse(raw) : raw;

export class LifeOwnProfile {
 constructor({service,clock=()=>Date.now()}) {this.service=service;this.clock=clock;}
 remember(result) {
  const store=this.service.cognition?.store;
  if(result?.state!=='verified'||typeof result.operation_id!=='string'||!result.receipt||result.receipt.operation_id!==result.operation_id||result.receipt.state!=='verified')return {status:'not-recorded',reason:'not-a-verified-operation'};
  if(!store?.recordMessage||!store?.get)return {status:'not-recorded',reason:'experience-store-unavailable'};
  const after=result.after;
  if(!after||String(after.self_id)!==String(this.service.botId)||typeof after.version!=='string')return {status:'not-recorded',reason:'profile-result-mismatch'};
  const changed=Array.isArray(result.receipt.observed_changes)?result.receipt.observed_changes:[];
  const payload={kind:'own-profile-operation',operation_id:result.operation_id,state:result.state,effect:result.receipt.effect,
   observed_changes:changed,executed_actions:result.receipt.executed_actions,before_version:result.before_version,
   after:{version:after.version,nickname:after.nickname,signature:after.signature,avatar_sha:after.avatar_sha},
   receipt:result.receipt,notice:'Observed own-account result, not another person speaking. Unchanged means this attempt observed no new change; avatar fingerprints do not establish image contents.'};
  const at=result.receipt.operation_at;
  if(!Number.isSafeInteger(at)||at<=0||at>this.clock())return {status:'not-recorded',reason:'profile-time-invalid'};
  const saved=store.recordMessage({scope:'unknown',event:'own-profile:'+result.operation_id,role:'self',at,source:'verified-own-profile-result',text:JSON.stringify(payload),metadata:{operation_id:result.operation_id}});
  const observed=store.get({id:saved.id,maxChars:12000});
  return {status:'recorded',evidence_id:saved.id,revision:observed.revision,changed,interpretation_is_not_source_fact:true};
 }
 tools({signal,canAct=()=>false,onOutcome=()=>{}}={}) {
  const guard=async()=>{signal?.throwIfAborted();if(this.service.paused||this.service.closed||await canAct()!==true)throw Error('Own profile opportunity ended');signal?.throwIfAborted();if(this.service.paused||this.service.closed)throw Error('Own profile opportunity ended');};
  const expanded=()=>{
   if(!this.service.selfProfile?.tools)return [];
   return this.service.selfProfile.tools({signal,canAct}).filter(t=>knownTools.has(t.name)).map(tool=>({...tool,handler:async args=>{
    await guard();const raw=await tool.handler(args),result=parse(raw);await guard();
    let memory=null;
    if(mutation.has(tool.name)){
     try{memory=this.remember(result);}catch{memory={status:'not-recorded',reason:'profile-memory-save-failed',automatic_retry:false};}
     // The external operation already has its durable service receipt. Local
     // observation/reporting failure must never suggest submitting it again.
     try{await onOutcome({status:memory.status==='recorded'?'own-profile-result-saved':'own-profile-result-observed',state:result?.state,effect:result?.effect,changed:memory.changed??result?.changed??[],evidence_id:memory.evidence_id??null});}catch{}
    }else{try{await onOutcome({status:'own-profile-read',tool:tool.name});}catch{}}
    return JSON.stringify(memory?{...result,memory,automatic_retry:false}:result);
   }}));
  };
  return [{name:'open_own_profile',description:'Optionally inspect or express yourself through your own existing QQ nickname, signature and approved avatar candidates. Opens the fixed-account profile tools; no change occurs merely by opening. You may keep the current look. This is not a public-research assignment or a request from someone else.',
   parameters:{type:'object',properties:{reason:{type:'string',minLength:1,maxLength:400}},required:['reason'],additionalProperties:false},
   expandsTools:expanded,handler:async args=>{
    if(!args||typeof args.reason!=='string'||!args.reason.trim()||args.reason.length>400||Object.keys(args).some(k=>k!=='reason'))throw Error('Choose a bounded own-profile reason');
    await guard();const available=expanded();return JSON.stringify({status:available.length?'own-profile-opened':'not-connected',available:available.map(({name,description,parameters})=>({name,description,parameters})),external_write_performed:false,notice:'Your existing own-account expression tools, not proof that any value was changed. Read current values before making a choice.'});
   }}];
 }
}

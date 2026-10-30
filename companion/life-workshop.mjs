import {conversationScope} from './conversation-scope.mjs';
import {workroomTools} from './workroom.mjs';
import {workshopTools} from './workshop.mjs';

// Own creative-space adapter only. The caller owns all stores, executor,
// scheduling and lifecycle. This module opens no DB and grants no new capability.
// Integration: new LifeWorkshop({workroom,workshop,cognition,policy,eligible});
// then context() and tools({id: opportunityId,signal,canAct}) per opportunity.
export class LifeWorkshop {
 constructor({workroom,workshop,cognition,policy,eligible=()=>false,clock=()=>Date.now()}) {
  if(!workroom||!workshop||!cognition?.store||typeof eligible!=='function')throw Error('Existing creative stores, cognition and eligibility are required');
  this.scope=conversationScope('private',policy?.bot_id);
  Object.assign(this,{workroom,workshop,cognition,eligible,clock});
 }
 ownJob(id){
  const row=this.workshop.row(this.scope,id);
  if(String(row.requester)!==this.scope.id||!row.source_event.startsWith('life:'))throw Error('Not an own life workshop job');
  return row;
 }
 rememberChange(action,result,sourceEvent){
  const project=result.project_id,version=result.version??result.base_version;
  if(!project||!Number.isSafeInteger(version))return {status:'not-applicable'};
  // Read the saved immutable version; checks or submission alone are never
  // described as running its JS. No source code/private briefs enter memory.
  const saved=this.workroom.read(this.scope,project,undefined,version);
  const queued=['workshop_submit','workshop_resume'].includes(action);
  const summary={action,project_id:project,version,title:saved.title,displayed:result.displayed??null,
   checks_ok:result.checks?.ok??null,job_id:result.job_id??null,job_state:result.job_id?result.state:null,
   execution_verified:false,notice:queued?'A real execution request receipt, not completed execution.':'Files/version receipt saved; syntax checks and display do not imply execution.'};
  const record=this.cognition.store.recordMessage({scope:'unknown',event:['own-workroom-change',action,project,version,result.job_id??''].join(':'),
   role:'self',text:JSON.stringify(summary),at:this.clock(),source:'own-workroom-change',
   metadata:{creative_scope:this.scope.address,requester:this.scope.id,source_event:sourceEvent,project_id:project,version,execution_verified:false}});
  return {status:'recorded',evidence_id:record.id,source:'own-workroom-change'};
 }
 rememberResult(job){
  if(job.state!=='completed')return {status:'not-completed'};
  const result=job.result;
  if(result?.project_id!==job.project||!Number.isSafeInteger(result.version)||result.version<=job.base_version||
   !result.evidence?.tool_results?.some(receipt=>receipt.status==='completed'))return {status:'unverified-result'};
  const saved=this.workroom.read(this.scope,job.project,undefined,result.version);
  const summary={job_id:job.id,project_id:job.project,base_version:job.base_version,version:result.version,state:'completed',
   source_event:job.source_event,requester:job.requester,engine:job.checkpoint.engine??'offline',
   title:saved.title,files:saved.files,tool_receipts:result.evidence.tool_results.map(receipt=>({status:receipt.status})),
   execution_verified:true,production_merged:false,notice:'The injected workshop completed with tool receipts and saved this actual artifact version.'};
  const record=this.cognition.store.recordMessage({scope:this.scope.address,event:'own-workshop-result:'+job.id,role:'self',
   text:JSON.stringify(summary),at:job.updated,source:'verified-workshop-result',
   metadata:{creative_scope:this.scope.address,requester:this.scope.id,source_event:job.source_event,job_id:job.id,project_id:job.project,version:result.version,execution_verified:true}});
  return {status:'recorded',evidence_id:record.id,source:'verified-workshop-result'};
 }
 context(){
  const projects=this.workroom.list(this.scope).slice(0,6).map(({id,title,version,deleted,updated})=>({project_id:id,title,version,deleted:!!deleted,updated}));
  const jobs=this.workshop.list(this.scope).filter(job=>String(job.requester)===this.scope.id&&job.source_event.startsWith('life:')).slice(0,6).map(job=>{
   let memory;try{memory=this.rememberResult(job);}catch{memory={status:'recording-failed',notice:'Actual result remains in the workshop.'};}
   return {job_id:job.id,project_id:job.project,base_version:job.base_version,state:job.state,source_event:job.source_event,requester:job.requester,
    parent:job.parent,engine:job.checkpoint.engine??'offline',updated:job.updated,error:job.error,
    result:job.result?{version:job.result.version??null,unexecuted_draft:!!job.result.draft_artifacts,
     execution_verified:job.state==='completed'&&memory.status==='recorded',evidence_id:memory.evidence_id??null}:null,memory};
  });
  return {scope:this.scope.address,requester:this.scope.id,projects,jobs,
   capabilities:this.workshop.capabilities(),
   notice:'Your own creative space. Saved files are displayed on the local home by default, including unfinished work; no display approval is needed. Queued, blocked, syntax-checked and saved unexecuted drafts are not completed execution. You may end this opportunity after a saved step or queued job; its real result is available next time, so repeated status polling is unnecessary. Existing engine budgets and sandbox boundaries still apply.'};
 }
 tools({id,signal,canAct=()=>true}={}){
  if(typeof id!=='string'||!id||id.length>90)throw Error('A bounded life opportunity ID is required');
  const sourceEvent='life:'+id,message=Object.freeze({user_id:this.scope.id,message_id:sourceEvent});
  const authorize=async()=>{
   signal?.throwIfAborted();
   const allowed=!this.workshop.closed&&!this.workshop.paused&&await this.eligible(id)&&await canAct();
   signal?.throwIfAborted();return allowed&&!this.workshop.closed&&!this.workshop.paused;
  };
  // Passing no guardian policy is deliberate: self creation is authorized as
  // the bot itself, never by borrowing a family member's guardian status.
  const underlying=[...workroomTools(this.workroom,this.scope,{message,authorize}),...workshopTools(this.workshop,this.scope,{message,authorize},{})];
  const changes=new Set(['workroom_create','workroom_write','workroom_restore','workroom_submit','workshop_submit','workshop_resume','workshop_restore_draft']);
  return underlying.map(tool=>({...tool,name:'own_'+tool.name,
   description:'In your own creative namespace, as yourself. '+tool.description.replaceAll('this chat','your own creative space').replaceAll('this conversation','your own creative space'),
   handler:async(args={})=>{
    if(!await authorize())throw Error('Life opportunity is paused, expired or ineligible');
    if(tool.name.startsWith('workshop_')&&args.job_id)this.ownJob(args.job_id);
    // Listing/status comes from the original handler; enforce requester/source
    // ownership before exposing jobs, while preserving its real capabilities.
    const raw=await tool.handler(args);let value;
    try{value=JSON.parse(raw);}catch{return raw;}
    if(tool.name==='workshop_status'){
     value.jobs=value.jobs.filter(job=>String(job.requester)===this.scope.id&&job.source_event.startsWith('life:'));
     for(const job of value.jobs){try{job.memory=this.rememberResult(job);}catch{job.memory={status:'recording-failed'};}}
    }
    const result=tool.name.startsWith('workroom_')?value.ok?value.result:null:value;
    if(changes.has(tool.name)&&result){
     // The actual operation already has its own durable receipt. Memory failure
     // must not turn a successful write/queue into an apparent failed action.
     try{value.memory=this.rememberChange(tool.name,result,sourceEvent);}catch{value.memory={status:'recording-failed',notice:'Original operation receipt is preserved; do not repeat the action for memory alone.'};}
    }
    return JSON.stringify(value);
   }
  }));
 }
}

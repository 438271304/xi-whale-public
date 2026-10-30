// Optional source-linked changes to existing self_state; no timer, provider,
// transport, persona file, or separate memory store.
const incoming=new Set(['live-transport','admitted-transport','referenced-qq-api','conversation-turns','admitted-poke-transport','received-qq-forward-node']);
const outgoing=new Set(['acknowledged-delivery','acknowledged-qq-outgoing','isolated-qq-outgoing','conversation-turns']);
const own=new Set(['own-workroom-change','verified-workshop-result','public-exploration']);
const protectedKey=/identity|guardian|permission|capabilit|credential|password|affection|好感|亲密度|身份|监护|权限|凭证|密钥|核心/i;
const fields=new Set(['kind','key','operation','expected_revision','value','reason','evidence_ids','evidence_refs','journal_refs']);
const qqScope=value=>/^(?:group|private):\d{5,15}$/.test(value);
const archived=source=>/^qq-history-pages\/\d{5,15}\.jsonl$/.test(source)||/^runs\/[A-Za-z0-9_-]{1,100}\/events\.jsonl$/.test(source);
const normalized=value=>value.trim().replace(/\s+/g,' ');
function fail(reason,detail={}){throw Object.assign(Error(reason),{reflectionRejection:true,detail});}
function text(value,max,reason){if(typeof value!=='string'||!value.trim()||value.length>max)fail(reason);return normalized(value);}
function now(clock){const at=clock();if(!Number.isSafeInteger(at)||at<0)fail('invalid-reflection-time');return at;}
function currentView(row){
 if(!row)return null;
 const interpretation=typeof row.value==='string'?row.value:row.value?.interpretation??'',refs=Array.isArray(row.value?.source_refs)?row.value.source_refs:[];
 return {kind:row.kind,key:row.key,revision:row.revision,at:row.at,source:row.source,active:row.value?.active!==false,
  interpretation:String(interpretation).slice(0,300),interpretation_truncated:String(interpretation).length>300,
  reason:typeof row.value?.reason==='string'?row.value.reason.slice(0,200):null,evidence:row.evidence.slice(0,2),evidence_count:row.evidence.length,
  source_refs:refs.slice(0,2).map(({id,revision,at,scope,role,author})=>({id,revision,at,scope,role,author})),source_ref_count:refs.length};
}

function sourceRef(store,id,revision,at){
 if(typeof id!=='string'||!/^exp-[a-f0-9]{32}$/.test(id)||revision!==undefined&&(!Number.isSafeInteger(revision)||revision<1))fail('invalid-experience-reference');
 const record=store.get({id,...(revision===undefined?{}:{revision}),maxChars:1});
 if(!record.found)fail('experience-reference-unavailable',{evidence_id:id});
 const version=store.db.prepare('SELECT recorded_at FROM experience_versions WHERE experience_id=? AND id=?').get(id,record.revision);
 if(!Number.isSafeInteger(record.at)||record.at>at||!version||!Number.isSafeInteger(version.recorded_at)||version.recorded_at>at)fail('future-experience-reference',{evidence_id:id});
 const sources=store.db.prepare('SELECT DISTINCT source FROM experience_sources WHERE experience_id=? AND revision_id=? ORDER BY source').all(id,record.revision).map(r=>r.source);
 const confirmed=record.role==='assistant'&&!['sending','uncertain'].includes(record.state)&&(record.state==='sent'||sources.some(s=>['acknowledged-delivery','acknowledged-qq-outgoing','isolated-qq-outgoing'].includes(s)));
 const accepted=sources.filter(source=>record.role==='self'?own.has(source):qqScope(record.scope)&&(
  record.role==='user'&&(incoming.has(source)||archived(source))||record.role==='assistant'&&(outgoing.has(source)||archived(source))&&confirmed));
 if(!accepted.length)fail('experience-source-not-supported',{evidence_id:id});
 return {id:record.id,revision:record.revision,at:record.at,recorded_at:version.recorded_at,scope:record.scope,role:record.role,
  author:{id:record.author?.id??null,kind:record.author?.kind??'unknown'},evidence_kind:record.attribution?.evidence_kind??'unknown',
  sources:accepted.slice(0,4),...(accepted.length>4?{more_sources_available:true}:{}),
  ...(record.role==='self'&&typeof record.metadata?.execution_verified==='boolean'?{execution_verified:record.metadata.execution_verified}:{})};
}

function resolveBasis(store,journal,args,at){
 const direct=args.evidence_ids??[],explicit=args.evidence_refs??[],requested=args.journal_refs??[];
 if(!Array.isArray(direct)||direct.length>8||!Array.isArray(explicit)||explicit.length>8||!Array.isArray(requested)||requested.length>2||!direct.length&&!explicit.length&&!requested.length)fail('reflection-needs-existing-experience-or-journal');
 const refs=new Map(),journals=[];
 const add=ref=>{refs.set(ref.id+'\0'+ref.revision,ref);if(refs.size>8)fail('reflection-source-count-exceeds-eight');};
 for(const id of direct)add(sourceRef(store,id,undefined,at));
 for(const ref of explicit){
  if(!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).some(k=>!['id','revision'].includes(k))||!Number.isSafeInteger(ref.revision)||ref.revision<1)fail('invalid-experience-reference');
  add(sourceRef(store,ref.id,ref.revision,at));
 }
 const seen=new Set();
 for(const requestedJournal of requested){
  if(!requestedJournal||typeof requestedJournal!=='object'||Array.isArray(requestedJournal)||Object.keys(requestedJournal).some(k=>!['id','revision'].includes(k))||
    typeof requestedJournal.id!=='string'||!/^journal:[a-f0-9-]{36}$/.test(requestedJournal.id)||!Number.isSafeInteger(requestedJournal.revision)||requestedJournal.revision<1)fail('invalid-journal-reference');
  const key=requestedJournal.id+'\0'+requestedJournal.revision;if(seen.has(key))continue;seen.add(key);
  const entry=journal.get(requestedJournal.id,{revision:requestedJournal.revision});
  if(!entry.found||entry.revision!==requestedJournal.revision)fail('journal-reference-unavailable');
  if(!Number.isSafeInteger(entry.at)||entry.at>at||!Number.isSafeInteger(entry.created_at)||entry.created_at>at)fail('future-journal-reference');
  if(!Array.isArray(entry.facts?.evidence)||!entry.facts.evidence.length)fail('journal-has-no-original-experience');
  for(const ref of entry.facts.evidence)add(sourceRef(store,ref.id,ref.revision,entry.at));
  journals.push({id:entry.id,revision:entry.revision,at:entry.at,interpretation_is_not_source_fact:true});
 }
 return {source_refs:[...refs.values()].sort((a,b)=>a.id.localeCompare(b.id)||a.revision-b.revision),journal_refs:journals.sort((a,b)=>a.id.localeCompare(b.id)||a.revision-b.revision)};
}

function reflect(store,journal,args,clock){
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!fields.has(k)))fail('invalid-reflection-fields');
 if(!['interest','unfinished'].includes(args.kind)||!['record','correct','retire'].includes(args.operation))fail('unsupported-reflection-kind-or-operation');
 const supplied=text(args.key,80,'invalid-reflection-key'),key=supplied.startsWith('reflection:')?supplied:'reflection:'+supplied;
 if(protectedKey.test(key))fail('protected-reflection-key');
 if(!Number.isSafeInteger(args.expected_revision)||args.expected_revision<0)fail('expected-revision-required');
 const reason=text(args.reason,600,'bounded-reflection-reason-required'),at=now(clock),basis=resolveBasis(store,journal,args,at);
 const suppliedValue=args.value===undefined?undefined:text(args.value,1200,'bounded-self-interpretation-required');
 if(args.operation!=='retire'&&suppliedValue===undefined)fail('bounded-self-interpretation-required');
 store.db.exec('SAVEPOINT life_self_reflection');
 try{
  const current=store.getState({kind:args.kind,key,limit:1})[0]??null,currentRevision=current?.revision??0;
  if(currentRevision!==args.expected_revision){store.db.exec('RELEASE life_self_reflection');return {status:'conflict',reason:'reflection-version-conflict',kind:args.kind,key,current_revision:currentRevision,current:currentView(current)};}
  if(args.operation!=='record'&&!current)fail('no-prior-reflection-to-correct-or-retire');
  const interpretation=suppliedValue??(typeof current?.value==='string'?current.value:current?.value?.interpretation);
  if(typeof interpretation!=='string'||!interpretation.trim()||interpretation.length>1200)fail('bounded-self-interpretation-required');
  const active=args.operation!=='retire',old=typeof current?.value==='string'?current.value:current?.value?.interpretation;
  if(current&&old===interpretation&&(current.value?.active!==false)===active){
   store.db.exec('RELEASE life_self_reflection');return {status:'unchanged',kind:args.kind,key,current_revision:currentRevision,active,source:current.source,
    source_refs:current.value?.source_refs??[],journal_refs:current.value?.journal_refs??[],existing_evidence:current.evidence,current:currentView(current),
    notice:'No interpretation/active-state change; nothing written. Existing provenance is retained.'};
  }
  const value={interpretation,reason,active,operation:args.operation,previous_revision:currentRevision||null,reviewable:true,
   interpretation_is_not_source_fact:true,facts_are_source_references:true,...basis};
  if(JSON.stringify(value).length>6000)fail('reflection-too-large');
  const evidence=[...new Set(basis.source_refs.map(r=>r.id))].map(id=>({type:'message',id}));
  const saved=store.setState({kind:args.kind,key,value,evidence,at,source:'life-self-reflection'});
  store.db.exec('RELEASE life_self_reflection');
  return {status:'saved',kind:args.kind,key,current_revision:saved.revision,revision:saved.revision,previous_revision:currentRevision||null,active,operation:args.operation,
   at,source:'life-self-reflection',...basis,interpretation_is_not_source_fact:true,
   notice:'Source-linked self-interpretation saved. Original authors/versions remain unchanged; nothing sent, scheduled or published.'};
 }catch(error){store.db.exec('ROLLBACK TO life_self_reflection; RELEASE life_self_reflection');throw error;}
}

export function lifeSelfReflectionTools({store,journal,clock=()=>Date.now(),signal,canAct=()=>true}={}){
 if(!store?.db?.prepare||!store.db.exec||typeof store.get!=='function'||typeof store.getState!=='function'||typeof store.setState!=='function'||typeof journal?.get!=='function'||
   journal.store&&journal.store!==store||typeof clock!=='function'||typeof canAct!=='function')throw TypeError('Life reflection needs the existing shared stores and lifecycle guard');
 return [{name:'reflect_life_state',description:'Optionally form, revise or put aside one interest/unfinished thought from actual retained QQ experiences, saved own work, public exploration, or an explicit saved journal version. This is your interpretation, not a fact about the original speakers. Use a stable key and exact expected_revision (0 for new). The same experience may mean something different later; give the actual new reason. Repeated unchanged understanding needs no new version. record/correct are active; retire puts it aside. Does not alter identity, permissions, send, schedule or publish anything.',
  parameters:{type:'object',properties:{kind:{type:'string',enum:['interest','unfinished']},key:{type:'string',maxLength:80},operation:{type:'string',enum:['record','correct','retire']},
   expected_revision:{type:'integer',minimum:0},value:{type:'string',maxLength:1200,description:'Your own interpretation; required for record/correct, optional when retiring the prior interpretation.'},reason:{type:'string',maxLength:600},
   evidence_ids:{type:'array',items:{type:'string'},minItems:1,maxItems:8,description:'Existing experiences; each current version is pinned in the receipt. Use evidence_refs to select an exact version already read.'},
   evidence_refs:{type:'array',minItems:1,maxItems:8,items:{type:'object',properties:{id:{type:'string'},revision:{type:'integer',minimum:1}},required:['id','revision'],additionalProperties:false}},
   journal_refs:{type:'array',maxItems:2,minItems:1,items:{type:'object',properties:{id:{type:'string'},revision:{type:'integer',minimum:1}},required:['id','revision'],additionalProperties:false}}},
   required:['kind','key','operation','expected_revision','reason'],additionalProperties:false},
  handler:async args=>{
   signal?.throwIfAborted();if(await canAct()!==true)throw Error('Life reflection is paused or ended');signal?.throwIfAborted();
   // All basis checks/CAS/write below are synchronous in one shared-store
   // savepoint. There is no await after the lifecycle check or after commit.
   try{return JSON.stringify(reflect(store,journal,args,clock));}
   catch(error){if(error.reflectionRejection)return JSON.stringify({status:'rejected',reason:error.message,current_revision:null,...error.detail});throw error;}
  }}];
}

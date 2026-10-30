import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Workroom} from './workroom.mjs';
import {Workshop} from './workshop.mjs';
import {UnifiedCognition} from './cognition-tools.mjs';
import {conversationScope} from './conversation-scope.mjs';
import {LifeWorkshop} from './life-workshop.mjs';

const BOT='910410001',FATHER='910410002';
function fixture(t,{ready=true,run}={}){
 const root=mkdtempSync(join(tmpdir(),'whale-life-workshop-'));
 const workroom=new Workroom(join(root,'workroom.sqlite3')),cognition=new UnifiedCognition(root),runs=[];
 let eligible=true;
 const workshop=new Workshop({path:join(root,'workshop.sqlite3'),workroom,backend:{
  capabilities:()=>({ready,backend:'synthetic-local-backend',entrypoint_required:true,reason:ready?null:'Synthetic backend deliberately unavailable'}),
  run:async args=>{runs.push(args);if(run)return run(args);return {status:'completed',files:{...args.files,'result.txt':'A real fake-backend artifact'},evidence:{tool_results:[{status:'completed',output:'artifact saved'}]}};}
 }});
 const bridge=new LifeWorkshop({workroom,workshop,cognition,policy:{bot_id:BOT,father_id:FATHER},eligible:()=>eligible});
 t.after(async()=>{await workshop.close();workroom.close();cognition.close();});
 const call=async(name,args={},options={})=>{
  const tool=bridge.tools({id:'opportunity-1',...options}).find(tool=>tool.name===name);assert.ok(tool,name);
  return JSON.parse(await tool.handler(args));
 };
 return {root,workroom,workshop,cognition,bridge,runs,call,eligible(value){eligible=value;}};
}
const create=f=>f.call('own_workroom_create',{title:'A tiny own work',files:[{path:'index.html',text:'<p>A small thought</p>'},{path:'main.mjs',text:'console.log("fixture source only")'}]});
const submit=(f,project,version=1)=>f.call('own_workshop_submit',{project_id:project,expected_version:version,instruction:'Create the declared fixture artifact.',expected_outputs:['result.txt']});

test('own create/write/queue and actual fake-backend completion reappear as sourced results, without inventing execution from checks',async t=>{
 const f=fixture(t),created=await create(f),project=created.result.project_id;
 assert.equal(created.ok,true);assert.equal(created.result.visibility,'displayed');assert.equal(created.memory.source,'own-workroom-change');
 const own=conversationScope('private',BOT);assert.equal(f.workroom.project(own,project).head,1);
 const parent=conversationScope('private',FATHER);assert.equal(f.workroom.list(parent).length,0);
 let observations=f.cognition.store.db.prepare('SELECT source FROM experience_sources').all();
 assert.ok(observations.every(row=>row.source==='own-workroom-change'));
 assert.equal(f.runs.length,0);
 const written=await f.call('own_workroom_write',{project_id:project,expected_version:1,files:[{path:'notes.md',text:'A detail to revisit.'}]});
 assert.equal(written.result.version,2);
 const submitted=await f.call('own_workroom_submit',{project_id:project,expected_version:2,summary:'Saved for the local home.'});
 assert.equal(submitted.result.host_execution_implied,false);assert.equal(submitted.result.review_required,false);
 const queued=await submit(f,project,2);assert.equal(queued.state,'queued');assert.equal(queued.not_completed,true);
 const row=f.workshop.row(own,queued.job_id);assert.equal(row.requester,BOT);assert.equal(row.source_event,'life:opportunity-1');
 await f.workshop.pump();assert.equal(f.runs.length,1);
 const context=f.bridge.context(),job=context.jobs.find(job=>job.job_id===queued.job_id);
 assert.equal(job.state,'completed');assert.equal(job.result.version,3);assert.equal(job.result.execution_verified,true);
 assert.equal(f.workroom.read(own,project,'result.txt',3).text,'A real fake-backend artifact');
 const memory=f.cognition.store.get({id:job.result.evidence_id});assert.equal(memory.found,true);
 const facts=JSON.parse(memory.text);assert.equal(facts.source_event,'life:opportunity-1');assert.equal(facts.requester,BOT);assert.equal(facts.execution_verified,true);
 assert.equal(memory.scope,own.address);
 const before=f.cognition.store.counts().messages;f.bridge.context();assert.equal(f.cognition.store.counts().messages,before,'Repeated observation does not invent duplicate experiences');
 const status=await f.call('own_workshop_status',{job_id:queued.job_id});assert.equal(status.jobs[0].state,'completed');
 observations=f.cognition.store.db.prepare('SELECT source FROM experience_sources').all();assert.ok(observations.some(row=>row.source==='verified-workshop-result'));
});

test('expired, paused or aborted opportunities cannot create, write or queue through held tools',async t=>{
 const f=fixture(t),created=await create(f),project=created.result.project_id;
 const held=f.bridge.tools({id:'held-opportunity'}).find(tool=>tool.name==='own_workroom_write');
 f.eligible(false);await assert.rejects(()=>held.handler({project_id:project,expected_version:1,files:[{path:'notes.md',text:'Must not save'}]}),/ineligible/);
 assert.equal(f.workroom.project(f.bridge.scope,project).head,1);
 f.eligible(true);await assert.rejects(()=>f.call('own_workshop_submit',{project_id:project,expected_version:1,instruction:'No',expected_outputs:['result.txt']},{canAct:()=>false}),/ineligible/);
 await f.workshop.pause();await assert.rejects(()=>create(f),/paused/);assert.equal(f.workshop.list(f.bridge.scope).length,0);
 f.workshop.resumeService();const controller=new AbortController();controller.abort();
 await assert.rejects(()=>f.call('own_workroom_list',{}, {signal:controller.signal}),{name:'AbortError'});
 assert.equal(f.workroom.list(f.bridge.scope).length,1);assert.equal(f.runs.length,0);
});

test('existing CAS, soft deletion, blocked engine and explicit continuation remain intact',async t=>{
 const f=fixture(t,{ready:false}),created=await create(f),project=created.result.project_id;
 const write=()=>f.call('own_workroom_write',{project_id:project,expected_version:1,files:[{path:'notes.md',text:'one edit'}]});
 assert.equal((await write()).ok,true);const stale=await write();assert.equal(stale.ok,false);assert.match(stale.error,/Version conflict/);
 const blocked=await submit(f,project,2);assert.equal(blocked.state,'blocked');
 assert.equal(f.bridge.context().jobs[0].result,null);assert.equal(f.runs.length,0);
 await assert.rejects(()=>f.call('own_workshop_resume',{job_id:blocked.job_id,expected_version:1}),/Version conflict/);
 const resumed=await f.call('own_workshop_resume',{job_id:blocked.job_id,expected_version:2});
 const child=f.workshop.row(f.bridge.scope,resumed.job_id);assert.equal(child.parent,blocked.job_id);assert.equal(child.requester,BOT);assert.equal(child.source_event,'life:opportunity-1');
 assert.equal((await f.call('own_workroom_trash',{project_id:project,expected_version:2})).result.recoverable,true);
 assert.equal(f.bridge.context().projects.length,0);
 const restored=await f.call('own_workroom_restore',{project_id:project,version:1,expected_version:2});assert.equal(restored.result.version,3);
 assert.equal(f.workroom.read(f.bridge.scope,project,undefined,1).version,1);assert.equal(f.runs.length,0);
 assert.equal(f.cognition.store.db.prepare("SELECT count(*) n FROM experience_sources WHERE source='verified-workshop-result'").get().n,0);
});

test('own tools cannot inspect or control another scope or impersonate a guardian/requester',async t=>{
 const f=fixture(t,{ready:false}),other=conversationScope('private',FATHER);
 const foreign=f.workroom.create(other,{title:'Not mine',files:{'index.html':'<p>Private</p>','main.mjs':'console.log(1)'}});
 const job=f.workshop.submit(other,{project_id:foreign.project_id,expected_version:1,instruction:'Other task',expected_outputs:['result.txt'],source_event:'father-event',requester:FATHER});
 for(const name of ['own_workshop_status','own_workshop_control','own_workshop_resume','own_workshop_draft','own_workshop_restore_draft']){
  await assert.rejects(()=>f.call(name,{job_id:job.job_id,action:'cancel',expected_version:1}),/not found/);
 }
 const denied=await f.call('own_workroom_read',{project_id:foreign.project_id});assert.equal(denied.ok,false);
 await assert.rejects(()=>submit(f,foreign.project_id),/unavailable/);
 const ownCreated=await create(f),ownJob=f.workshop.submit(f.bridge.scope,{project_id:ownCreated.result.project_id,expected_version:1,instruction:'A foreign requester in this namespace',expected_outputs:['result.txt'],source_event:'human-event',requester:FATHER});
 await assert.rejects(()=>f.call('own_workshop_control',{job_id:ownJob.job_id,action:'cancel',requester:FATHER,guardian:true}),/Not an own/);
 assert.equal(f.workshop.row(f.bridge.scope,ownJob.job_id).state,'blocked');
 const actual=await f.call('own_workshop_submit',{project_id:ownCreated.result.project_id,expected_version:1,instruction:'Own task',expected_outputs:['result.txt'],requester:FATHER,source_event:'forged',guardian:true});
 const row=f.workshop.row(f.bridge.scope,actual.job_id);assert.equal(row.requester,BOT);assert.equal(row.source_event,'life:opportunity-1');
 assert.ok(f.bridge.context().jobs.every(job=>job.requester===BOT));assert.equal(f.bridge.context().projects.length,1);
});

test('a concurrent project edit leaves actual job conflict artifacts without claiming verified execution results',async t=>{
 let release,started;const gate=new Promise(resolve=>release=resolve),begin=new Promise(resolve=>started=resolve);
 const f=fixture(t,{run:async({files})=>{started();await gate;return {status:'completed',files:{...files,'result.txt':'conflicting result'},evidence:{tool_results:[{status:'completed'}]}};}});
 const created=await create(f),project=created.result.project_id,queued=await submit(f,project);await begin;
 await f.call('own_workroom_write',{project_id:project,expected_version:1,files:[{path:'notes.md',text:'New edit during execution'}]});
 release();await f.workshop.pump();const context=f.bridge.context();assert.equal(context.jobs[0].state,'conflict');
 assert.equal(context.jobs[0].result.execution_verified,false);assert.equal(f.workroom.project(f.bridge.scope,project).head,2);
 assert.equal(f.workshop.view(f.workshop.row(f.bridge.scope,queued.job_id)).result.artifacts['result.txt'],'conflicting result');
 assert.equal(f.cognition.store.db.prepare("SELECT count(*) n FROM experience_sources WHERE source='verified-workshop-result'").get().n,0);
});

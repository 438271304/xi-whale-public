import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {runScopedTurn} from './scoped-tools.mjs';
import {toolFault,toolFeedback,rejectedToolResult} from './tool-feedback.mjs';
import {LifeOpportunityLog} from './life-opportunity-log.mjs';
import {PrivateConversation} from './private-conversation.mjs';
import {Workroom,workroomTools} from './workroom.mjs';
import {Workshop} from './workshop.mjs';
import {QQSelfProfile} from './qq-self-profile.mjs';
import {conversationScope} from './conversation-scope.mjs';

const SECRET='SYNTHETIC_PRIVATE_DIAGNOSTIC_TOKEN';
const scope=conversationScope('private','932110001');
const tool=(name,handler,extra={})=>({name,description:'Synthetic tool',parameters:{type:'object',properties:{},additionalProperties:false},handler,...extra});
const call=(name,args={})=>({name,args}),last=req=>JSON.parse(req.input.filter(x=>x.type==='function_call_output').at(-1).output);
function scripted(steps){let id=0;return {respond:async req=>{
 assert.ok(steps.length,'No retry or unexpected generation');const choice=steps.shift(),next=typeof choice==='function'?choice(req):choice;
 if(typeof next==='string')return {response:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:next}]}]}};
 return {response:{status:'completed',output:(Array.isArray(next)?next:[next]).map(item=>({type:'function_call',call_id:'t'+(++id),name:item.name,arguments:item.raw??JSON.stringify(item.args)}))}};
}};}
const run=(steps,tools,extra={})=>runScopedTurn({client:scripted(steps),profile:'Synthetic',input:[{role:'user',content:'Synthetic task'}],tools,...extra});

test('dispatch feedback distinguishes JSON, fields and unavailable tools before a corrected action',async()=>{
 let writes=0;const records=[];
 const write=tool('save',()=>{writes++;return '{"saved":true}';},{parameters:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}});
 const steps=[call('not_registered'),req=>{assert.equal(last(req).error.code,'TOOL_UNAVAILABLE');return {name:'save',raw:'{'};},
  req=>{assert.equal(last(req).error.code,'ARGUMENT_JSON_INVALID');return call('save',{unexpected:SECRET});},
  req=>{const result=last(req);assert.equal(result.error.code,'ARGUMENT_FIELDS_INVALID');assert.equal(result.error.action_result,'not-started');assert.ok(!JSON.stringify(result).includes(SECRET));return call('save',{text:'corrected'});},
  req=>{assert.equal(last(req).saved,true);return 'done';}];
 await run(steps,[write],{onTool:value=>records.push(value)});assert.equal(writes,1);assert.deepEqual(records.map(r=>r.ok),[false,false,false,true]);assert.ok(!JSON.stringify(records.slice(0,3)).includes(SECRET));
});

test('actual workroom conflict provides the current version, then read/review and one corrected write succeeds',async t=>{
 const room=new Workroom(join(mkdtempSync(join(tmpdir(),'whale-feedback-work-')),'work.sqlite3'));t.after(()=>room.close());
 const own=room.create(scope,{title:'Synthetic project',files:{'index.html':'old'}});room.write(scope,own.project_id,1,[{path:'index.html',text:'someone updated'}]);
 const tools=workroomTools(room,scope,{authorize:()=>true});
 const steps=[call('workroom_write',{project_id:own.project_id,expected_version:1,files:[{path:'index.html',text:'stale'}]}),
  req=>{const result=last(req);assert.equal(result.ok,false);assert.equal(result.error.code,'VERSION_CONFLICT');assert.equal(result.error.current_version,2);return call('workroom_read',{project_id:own.project_id,path:'index.html'});},
  req=>{assert.equal(last(req).result.text,'someone updated');return call('workroom_write',{project_id:own.project_id,expected_version:2,files:[{path:'index.html',text:'reviewed update'}]});},
  req=>{assert.equal(last(req).ok,true);assert.equal(last(req).result.version,3);return 'done';}];
 await run(steps,tools);assert.equal(room.project(scope,own.project_id).head,3);
 const other=room.create(conversationScope('private','932110002'),{title:'Other scope'}),read=tools.find(t=>t.name==='workroom_read');
 const inaccessible=JSON.parse(await read.handler({project_id:other.project_id})),missing=JSON.parse(await read.handler({project_id:'00000000-0000-0000-0000-000000000000'}));
 assert.deepEqual(inaccessible,missing);assert.equal(missing.error.code,'RESOURCE_UNAVAILABLE');
 const paused=workroomTools(room,scope,{authorize:()=>false}).find(t=>t.name==='workroom_write');
 assert.equal(JSON.parse(await paused.handler({project_id:own.project_id,expected_version:3,files:[]})).error.code,'ACTION_PAUSED_OR_CONTEXT_ENDED');assert.equal(room.project(scope,own.project_id).head,3);
});

test('an unknown exception cannot self-select a safe category or expose details, while structured conflict remains intact',async()=>{
 const records=[],conflict={status:'conflict',reason:'existing-version-conflict',current_revision:2};
 const steps=[call('failure'),req=>{const result=last(req);assert.equal(result.status,'failed-outcome-unconfirmed');assert.equal(result.error.code,'TOOL_FAILURE_UNCLASSIFIED');assert.equal(result.error.automatic_retry,false);assert.ok(!JSON.stringify(result).includes(SECRET));return call('structured');},
  req=>{assert.deepEqual(last(req),conflict);return 'done';}];
 await run(steps,[tool('failure',()=>{throw Object.assign(Error(SECRET),{code:'VERSION_CONFLICT',path:SECRET,key:SECRET});}),tool('structured',()=>JSON.stringify(conflict))],{onTool:v=>records.push(v)});
 assert.ok(!JSON.stringify(records).includes(SECRET));assert.equal(toolFeedback(toolFault('VERSION_CONFLICT',{current_version:2,path:SECRET,key:SECRET})).path,undefined);
});

test('a real own-profile write failure keeps its uncertain receipt and never suggests replaying the setter',async t=>{
 let signature='before',sets=0;const self='900000004';
 const driver={callApi:async(name,args)=>{if(name==='get_login_info')return {user_id:self,nickname:'Synthetic'};if(name==='get_stranger_info')return {user_id:self,nickname:'Synthetic',long_nick:signature};if(name==='set_self_longnick'){sets++;signature=args.longNick;throw Error(SECRET);}throw Error('Unexpected synthetic API');}};
 const profile=new QQSelfProfile({path:':memory:',driver});t.after(()=>profile.close());const before=await profile.read(),records=[];
 const steps=[call('self_profile_update',{expected_version:before.version,signature:'changed'}),req=>{const result=last(req);assert.equal(result.status,'uncertain');assert.equal(result.error.code,'ACTION_OUTCOME_UNCERTAIN');assert.equal(result.error.state,'failed-or-uncertain');assert.equal(result.error.write_attempted,true);assert.equal(result.error.automatic_retry,false);assert.match(result.error.operation_id,/^[a-f0-9-]{36}$/);return call('self_profile_history');},
  req=>{assert.equal(last(req).operations[0].state,'failed-or-uncertain');return 'outcome needs inspection';}];
 await run(steps,profile.tools(),{onTool:v=>records.push(v)});assert.equal(sets,1);assert.equal(signature,'changed');assert.ok(!JSON.stringify(records).includes(SECRET));
 const pausedSteps=[call('self_profile_read'),req=>{assert.equal(last(req).error.code,'ACTION_PAUSED_OR_CONTEXT_ENDED');return 'stopped';}];
 await run(pausedSteps,profile.tools({canAct:()=>false}));assert.equal(sets,1);
});

test('handler success and failed recording remain distinct, with one fixed warning and no compensating action',async()=>{
 let actions=0,recorders=0;const warnings=[];
 const steps=[call('save'),req=>{const result=last(req);assert.equal(result.saved,true);assert.equal(result.version,1);assert.equal(result.tool_feedback_warnings[0].code,'TOOL_RESULT_RECORDING_FAILED');assert.ok(!JSON.stringify(result).includes(SECRET));return 'saved; recorder needs attention';}];
 await run(steps,[tool('save',()=>{actions++;return '{"saved":true,"version":1}';})],{onTool:()=>{recorders++;throw Error(SECRET);},onWarning:value=>warnings.push(value)});
 assert.equal(actions,1);assert.equal(recorders,1);assert.deepEqual(warnings,[{tool:'save',code:'TOOL_RESULT_RECORDING_FAILED',phase:'postprocessing',count:1}]);
});

test('failed recording never turns a dispatch rejection into a returned-handler claim, and two warnings both remain visible',async()=>{
 let invoked=0;const warnings=[];
 const steps=[call('save',{wrong:SECRET}),req=>{const result=last(req);assert.equal(result.error.action_result,'not-started');assert.equal(result.tool_feedback_warnings[0].action_result,'see_reported_result');return call('save');},
  req=>{const result=last(req);assert.equal(result.saved,true);assert.deepEqual(result.tool_feedback_warnings.map(w=>w.code),['TOOL_RESULT_RECORDING_FAILED','TOOL_EXPANSION_FAILED']);return 'done';}];
 await run(steps,[tool('save',()=>{invoked++;return '{"saved":true}';},{expandsTools:()=>{throw Error(SECRET);}})],{onTool:()=>{throw Error(SECRET);},onWarning:value=>warnings.push(value)});
 assert.equal(invoked,1);assert.deepEqual(warnings.map(w=>w.code),['TOOL_RESULT_RECORDING_FAILED','TOOL_RESULT_RECORDING_FAILED','TOOL_EXPANSION_FAILED']);assert.deepEqual(warnings.map(w=>w.count),[1,2,3]);assert.ok(!JSON.stringify(warnings).includes(SECRET));
});

test('a terminal definition explains its order, retains recording warnings, and never executes later calls',async()=>{
 let terminals=0,later=0,recorders=0;const warnings=[];
 const steps=[req=>{assert.match(req.tools.find(t=>t.name==='finish').description,/immediately ends the turn/);assert.match(req.tools.find(t=>t.name==='finish').description,/later calls in the same batch will not execute/);return [call('finish'),call('later')];}];
 const result=await run(steps,[tool('finish',()=>{terminals++;return 'saved';},{endsTurn:true,terminalResult:'finished'}),tool('later',()=>{later++;return 'never';})],{onTool:()=>{recorders++;throw Error(SECRET);},onWarning:value=>warnings.push(value)});
 assert.equal(result,'finished');assert.equal(terminals,1);assert.equal(later,0);assert.equal(recorders,1);assert.equal(warnings.length,1);assert.equal(warnings[0].code,'TOOL_RESULT_RECORDING_FAILED');
});

test('workshop model view keeps status and local receipt while original local diagnostic remains available',async t=>{
 const root=mkdtempSync(join(tmpdir(),'whale-feedback-job-')),room=new Workroom(join(root,'work.sqlite3'));
 const workshop=new Workshop({path:join(root,'jobs.sqlite3'),workroom:room,backend:{capabilities:()=>({ready:false,backend:'synthetic',reason:SECRET}),run:()=>{throw Error('Must not execute');}}});t.after(async()=>{await workshop.close();room.close();});
 const project=room.create(scope,{title:'Synthetic job'}),job=workshop.submit(scope,{project_id:project.project_id,expected_version:1,instruction:'Synthetic',expected_outputs:['result.txt'],source_event:'synthetic',requester:scope.id});
 const raw=workshop.row(scope,job.job_id),view=workshop.view(raw);assert.equal(raw.error,SECRET);assert.equal(view.state,'blocked');assert.equal(view.error_feedback.local_receipt.id,job.job_id);assert.ok(!JSON.stringify(view).includes(SECRET));
 assert.equal(workshop.db.prepare('SELECT error FROM workshop_jobs WHERE id=?').get(job.job_id).error,SECRET);
});

test('fixed capacity and task-state preconditions retain an actionable category without matching exception text',async t=>{
 const room=new Workroom(join(mkdtempSync(join(tmpdir(),'whale-feedback-limits-')),'work.sqlite3'),{limits:{versions:1,projectsPerScope:1}});t.after(()=>room.close());
 const project=room.create(scope,{title:'One version'}),tools=workroomTools(room,scope,{authorize:()=>true});
 const result=JSON.parse(await tools.find(t=>t.name==='workroom_write').handler({project_id:project.project_id,expected_version:1,files:[{path:'index.html',text:'blocked at limit'}]}));
 assert.equal(result.error.code,'LIMIT_REACHED');assert.equal(room.project(scope,project.project_id).head,1);
 assert.throws(()=>room.create(scope,{title:'Over configured count'}),error=>error.feedbackCode==='LIMIT_REACHED');
 const task=room.dispatch(scope,{title:'Existing task',brief:'Synthetic'});
 assert.throws(()=>room.review(scope,task.task_id,false,'Not submitted'),error=>error.feedbackCode==='TASK_STATE_CONFLICT');
});

test('aborted handler failure is recorded once before interruption; no later batch call or generation executes',async()=>{
 const controller=new AbortController(),records=[];let started=0,later=0;
 const steps=[[call('starting'),call('later')]];
 await assert.rejects(run(steps,[tool('starting',()=>{started++;controller.abort();throw Error(SECRET);}),tool('later',()=>{later++;return 'never';})],{signal:controller.signal,onTool:value=>records.push(value)}),{name:'AbortError'});
 assert.equal(started,1);assert.equal(later,0);assert.equal(records.length,1);assert.equal(records[0].ok,false);assert.ok(!JSON.stringify(records).includes(SECRET));
});

test('existing opportunity and conversation recorders retain uncertain outcome without pretending the invocation returned',()=>{
 const db=new DatabaseSync(':memory:'),log=new LifeOpportunityLog(db,{clock:()=>1000});
 try{
  db.exec('CREATE TABLE generation_tool_events(peer TEXT,event TEXT,tool TEXT,status TEXT,refs TEXT,at INTEGER)');
  const conversation={db,clock:()=>1000},uncertain=JSON.stringify(rejectedToolResult(toolFault('ACTION_OUTCOME_UNCERTAIN',{state:'failed-or-uncertain',write_attempted:true,operation_id:'11111111-1111-4111-8111-111111111111'})));
  log.start('synthetic-uncertain',{toolNames:['self_profile_update','qzone_publish']});
  log.recordTool('synthetic-uncertain',{name:'self_profile_update',ok:false,result:uncertain});
  PrivateConversation.prototype.recordTool.call(conversation,'private:932110001','synthetic-1','self_profile_update',uncertain,false);
  const qzone=JSON.stringify({ok:false,state:'uncertain',may_have_published:true,not_retried:true});
  log.recordTool('synthetic-uncertain',{name:'qzone_publish',ok:true,result:qzone});
  PrivateConversation.prototype.recordTool.call(conversation,'private:932110001','synthetic-2','qzone_publish',qzone,true);
  const result=log.read('synthetic-uncertain');assert.equal(result.tool_uncertain_count,2);assert.equal(result.tool_failed_count,0);assert.equal(result.events.find(e=>e.kind==='tool').invocation_ok,false);assert.deepEqual(result.durable_kinds,[]);
  assert.deepEqual(db.prepare('SELECT status FROM generation_tool_events').all().map(r=>r.status),['uncertain','uncertain']);
  log.recordTool('synthetic-uncertain',{name:'self_profile_update',ok:false,result:JSON.stringify({message:SECRET+' uncertain'})});
  assert.equal(log.read('synthetic-uncertain').tool_failed_count,1);assert.equal(log.read('synthetic-uncertain').tool_uncertain_count,2);assert.ok(!JSON.stringify(log.read('synthetic-uncertain')).includes(SECRET));
 }finally{db.close();}
});

test('a failed warning callback falls back to one fixed local alert without reentering the recorder',async()=>{
 const captured=[],original=console.warn;let recorders=0;
 console.warn=value=>captured.push(value);
 try{await run([call('finish')],[tool('finish',()=>'{"saved":true}',{endsTurn:true})],{onTool:()=>{recorders++;throw Error(SECRET);},onWarning:()=>{throw Error(SECRET);}});}
 finally{console.warn=original;}
 assert.equal(recorders,1);assert.equal(captured.length,1);const value=JSON.parse(captured[0]);assert.equal(value.event,'scoped-tool-warning');assert.equal(value.count,1);assert.ok(!captured[0].includes(SECRET));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CuriosityLife} from './curiosity-life.mjs';
import {LifeWorkshop} from './life-workshop.mjs';
import {Workroom} from './workroom.mjs';
import {Workshop} from './workshop.mjs';
import {UnifiedCognition} from './cognition-tools.mjs';
import {imageMutationTools} from './scoped-tools.mjs';
const BOT='900000004',GROUP='900000002';
const last=req=>JSON.parse(req.input.filter(x=>x.type==='function_call_output').at(-1).output);
const act=(name,args={})=>({name,args});
const conversationFixture=()=>{const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE turns(peer TEXT,event TEXT,role TEXT,text TEXT,at INTEGER,state TEXT,PRIMARY KEY(peer,event,role))');return db;};

test('a life opportunity discovers own creative tools, makes a real stored draft, queues work and next opportunity reflects its actual result',async t=>{
 const root=mkdtempSync(join(tmpdir(),'whale-creative-opportunity-')),memory=new UnifiedCognition(root),workroom=new Workroom(join(root,'workroom.sqlite3'));
 let now=Date.parse('2036-10-17T10:00:00+08:00'),release,steps=[],calls=0,project,job;
 const gate=new Promise(r=>release=r),workshop=new Workshop({path:join(root,'workshop.sqlite3'),workroom,clock:()=>now,backend:{capabilities:()=>({ready:true,backend:'synthetic',entrypoint_required:true}),run:async a=>{await gate;return {status:'completed',files:{...a.files,'result.txt':'Synthetic execution result'},evidence:{tool_results:[{status:'completed'}]}};}}});
 const conversationDb=conversationFixture();
 const service={paused:false,closed:false,cognition:memory,listening:{status:()=>({active:false})},engine:{db:conversationDb,queues:new Map(),revisions:new Map(),profile:'Synthetic Xi; no private conversations'},initiate:()=>{throw Error('No external send allowed');}};
 const client={canInitiate:()=>true,generationSettings:()=>({model:'deepseek-flash',reasoningEffort:'high',maxTokens:8192}),respond:async req=>{
  assert.ok(steps.length,'No unexpected model calls');const item=steps.shift(),a=typeof item==='function'?item(req):item;
  return {response:{id:'step-'+(++calls),status:'completed',output:[{type:'function_call',name:a.name,call_id:'c'+calls,arguments:JSON.stringify(a.args)}]},attempts:[]};
 }};
 let life;const bridge=new LifeWorkshop({workroom,workshop,cognition:memory,policy:{bot_id:BOT},clock:()=>now,eligible:()=>life.eligible()});
 life=new CuriosityLife({path:join(root,'life.sqlite3'),service,social:{inbound:()=>0},world:{getWatched:()=>({groups:[GROUP]}),sendToTarget:()=>{throw Error('No QQ');}},policy:{bot_id:BOT,group_id:GROUP},client,tools:[],creative:{context:()=>bridge.context(),tools:c=>bridge.tools(c)},clock:()=>now});
 t.after(async()=>{try{release();await life.close();await workshop.close();}finally{conversationDb.close();workroom.close();memory.close();}});life.resume();
 steps=[req=>{assert.equal(req.max_output_tokens,8192);assert.equal(req.model,'deepseek-flash');assert.equal(req.reasoning.effort,'high');assert.ok(req.tools.some(t=>t.name==='open_own_workshop'));assert.ok(!req.tools.some(t=>t.name==='own_workroom_create'));return act('open_own_workshop',{reason:'I want to try a small tide button.'});},
  req=>{assert.equal(req.max_output_tokens,32768);assert.equal(req.model,'deepseek-flash');assert.equal(req.reasoning.effort,'high');assert.ok(req.tools.some(t=>t.name==='own_workroom_create'));return act('own_workroom_create',{title:'Tide button',files:[{path:'index.html',text:'<button>Tide</button>'},{path:'main.mjs',text:'console.log("synthetic")'}]});},
  req=>{const r=last(req);assert.equal(r.ok,true);assert.equal(r.memory.source,'own-workroom-change');project=r.result.project_id;return act('own_workshop_submit',{project_id:project,expected_version:1,instruction:'Produce the fixture output.',expected_outputs:['result.txt']});},
  req=>{const r=last(req);job=r.job_id;assert.equal(r.state,'queued');assert.equal(r.not_completed,true);return act('keep_quiet');}];
 const first=await life.tick();assert.equal(first.status,'creative-workspace-updated');assert.equal(life.recent()[0].state,'completed');assert.equal(bridge.context().projects.length,1);assert.notEqual(bridge.context().jobs[0].state,'completed');
 release();await workshop.pump();assert.equal(bridge.context().jobs.find(j=>j.job_id===job).state,'completed');
 now+=31*60000;steps=[req=>{assert.equal(req.max_output_tokens,8192);const data=JSON.parse(req.input.find(x=>x.role==='user').content),completed=data.own_creative.jobs.find(j=>j.job_id===job);
  assert.equal(completed.result.execution_verified,true);assert.equal(data.own_creative.projects[0].project_id,project);
  return act('write_life_journal',{kind:'activity',evidence_ids:[completed.result.evidence_id],interpretation:{feeling:'The saved test output made the little project feel less unfinished.'}});},act('keep_quiet')];
 await life.tick();assert.equal(memory.journal.recent({days:7,limit:3}).entries.length,1);
 assert.equal(workroom.list(bridge.scope).length,1,'The next opportunity did not silently start a duplicate project');
 assert.ok(imageMutationTools.has('own_workroom_write'));assert.ok(imageMutationTools.has('own_workshop_submit'));
 now+=31*60000;steps=[act('open_own_workshop',{reason:'One more saved step.'}),act('own_workroom_write',{project_id:project,expected_version:2,files:[{path:'note.txt',text:'A durable unfinished idea.'}]}),...Array.from({length:10},()=>act('own_workroom_read',{project_id:project}))];
 const bounded=await life.tick();assert.equal(bounded.status,'creative-continuation-saved');assert.equal(bounded.completed_project,false);assert.equal(life.recent()[0].state,'unfinished');
 assert.equal(workroom.read(bridge.scope,project,'note.txt').text,'A durable unfinished idea.');assert.equal(workroom.read(bridge.scope,project).version,3);
});

test('creative saving during public reading does not close its source collection or replace the saved discovery',async t=>{
 const root=mkdtempSync(join(tmpdir(),'whale-creative-reading-')),memory=new UnifiedCognition(root),workroom=new Workroom(join(root,'workroom.sqlite3'));
 const now=Date.parse('2036-10-17T10:00:00+08:00');let n=0,reads=0,life;
 const workshop=new Workshop({path:join(root,'workshop.sqlite3'),workroom,backend:{capabilities:()=>({ready:false}),run:()=>{throw Error('No execution');}}});
 const bridge=new LifeWorkshop({workroom,workshop,cognition:memory,policy:{bot_id:BOT},clock:()=>now,eligible:()=>life.eligible()});
 const steps=[act('choose_activity',{topic:'Tides',why:'Compare the colours of tides.'}),act('open_own_workshop',{reason:'Save a small sketch while reading.'}),
  act('own_workroom_create',{title:'Tide sketch',files:[{path:'index.html',text:'<p>A draft</p>'}]}),act('public_fetch',{url:'https://example.com/tides'}),
  req=>{assert.equal(last(req).status,'ok');return act('save_discovery',{summary:'Synthetic source: tides rise and fall.'});},act('keep_quiet')];
 const client={canInitiate:()=>true,respond:async req=>{assert.ok(steps.length);const s=steps.shift(),a=typeof s==='function'?s(req):s;return {response:{status:'completed',output:[{type:'function_call',name:a.name,arguments:JSON.stringify(a.args),call_id:'mix-'+(++n)}]}};}};
 const conversationDb=conversationFixture();
 const service={paused:false,closed:false,cognition:memory,engine:{db:conversationDb,queues:new Map(),revisions:new Map(),profile:'Synthetic'},listening:{status:()=>({active:false})}};
 life=new CuriosityLife({path:join(root,'life.sqlite3'),service,social:{inbound:()=>now},world:{getWatched:()=>({groups:[GROUP]})},policy:{bot_id:BOT,group_id:GROUP},client,clock:()=>now,creative:{context:()=>bridge.context(),tools:c=>bridge.tools(c)},tools:[{name:'public_fetch',description:'Synthetic',parameters:{type:'object',properties:{url:{type:'string'}},required:['url']},handler:()=>{reads++;return JSON.stringify({status:'ok',sources:[{url:'https://example.com/tides',title:'Synthetic tides',excerpt:'Tides rise and fall.'}]});}}]});
 t.after(async()=>{try{await life.close();await workshop.close();}finally{conversationDb.close();workroom.close();memory.close();}});life.resume();
 const result=await life.tick();assert.notEqual(result.status,'failed');assert.equal(reads,1);assert.equal(life.recent()[0].state,'completed');assert.equal(life.recent()[0].topic,'Tides');assert.equal(life.recent()[0].summary,'Synthetic source: tides rise and fall.');assert.equal(bridge.context().projects.length,1);
});

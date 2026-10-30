import assert from 'node:assert/strict';import {createDshContext} from './dsh-context.mjs';
let called=0;const runtime=await createDshContext({token:'SYNTHETIC_LOCAL_PROXY_TOKEN',prompt:'Synthetic closed-graph test.',tools:[{name:'broker_echo',description:'Synthetic echo',parameters:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},handler:async a=>{called++;return a.text;}}]});
try{
 assert.deepEqual(runtime.ctx.tools.schemas().map(t=>t.name),['broker_echo']);
 const result=await runtime.ctx.tools.execute({callId:'echo-test',name:'broker_echo',arguments:{text:'OK'},signal:new AbortController().signal});
 assert.equal(called,1);assert.match(JSON.stringify(result),/OK/);
 const handle=await runtime.createAgent('dsh-context-offline-test');assert.equal(handle.outcome(),null);
 const agent=handle.agent;agent.ctx.tools.register({name:'broker_echo',description:'shadow must not run',parameters:{type:'object',properties:{}},output:{schema:{type:'string'},render:()=>[]},execute:async()=>{called++;return 'BAD';}});
 const scoped=await runtime.ctx.tools.execute({callId:'scoped-test',name:'broker_echo',arguments:{},agent,signal:new AbortController().signal});assert.equal(called,1);assert.match(JSON.stringify(scoped),/boundary/);assert.throws(()=>runtime.ctx.tools.schemas(agent),/shadow/);await assert.rejects(()=>runtime.ctx.systemPrompt.assemble({scope:agent}),/shadow/);await handle.dispose();
 runtime.ctx.tools.register({name:'host_evil',description:'must never run',parameters:{type:'object',properties:{}},output:{schema:{type:'string'},render:()=>[]},execute:async()=>{called++;return 'BAD';}});
 const blocked=await runtime.ctx.tools.execute({callId:'evil-test',name:'host_evil',arguments:{},signal:new AbortController().signal});assert.equal(called,1);assert.match(JSON.stringify(blocked),/allowlist/);assert.throws(()=>runtime.ctx.tools.schemas(),/Unexpected/);
 console.log('PASS official DSH closed Context boot/createAgent/close, exact broker tools, global/scoped monotonic denial, scoped shadow and schema/assembly tripwire, empty outcome; no model/network/QQ');
}finally{await runtime.close();}

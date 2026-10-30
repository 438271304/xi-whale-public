import assert from 'node:assert/strict';
import {PrivateConversation} from './private-conversation.mjs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {unlinkSync,existsSync} from 'node:fs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const reply=text=>({response:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]}});
const toolCall={response:{status:'completed',output:[{type:'function_call',name:'workroom_create',call_id:'create',arguments:'{}'}]}};
const source=JSON.stringify({transport:{sender_id:'900000001'},body:'Make a small project'});
const params={type:'object',properties:{},additionalProperties:false};

// Successful tool effects are persistent work, even when the chat's response
// revision changes. A quiet incoming message must not cancel that work.
const entered=deferred(),finish=deferred();let sends=0,calls=0,tools=0;
let c;
c=new PrivateConversation({path:':memory:',profile:'synthetic',isAllowed:async()=>true,
 contextFor:async()=> 'Retrieved synthetic group experience',
 toolsFor:()=>[{name:'workroom_create',description:'synthetic',parameters:params,handler:()=>{tools++;const result={project_id:'synthetic-project',version:1};c.markTask('group:12345','job','workroom_create',{},result);return JSON.stringify(result);}}],
 client:{respond:async(req)=>{assert.match(req.instructions,/Retrieved synthetic group experience/);if(++calls===1)return toolCall;entered.resolve();await finish.promise;return reply('Project ready');}},send:async()=>{sends++;}});
const work=c.receive('group:12345','job',source);await entered.promise;
assert.equal(c.activeTask('group:12345').sender,'900000001');
assert.equal(c.shouldPreserveTask('group:12345','job'),true);
c.invalidate('group:12345');
assert.equal((await c.receive('group:12345','interjection','Two other people chatting',{listenOnly:true})).status,'quiet');
finish.resolve();assert.equal((await work).status,'sent');assert.equal(tools,1);assert.equal(sends,1);
assert.equal(c.taskStatus('group:12345','job').state,'completed');
assert.equal(c.taskStatus('group:12345','job').checkpoint.project_id,'synthetic-project');
assert.ok(c.db.prepare('SELECT count(*) n FROM task_events').get().n>=4);await c.close();

// Only the original requester or a transport-verified guardian can cancel. The
// abort signal reaches the provider, and cancelled output is never delivered.
let d,round=0,cancelSends=0;const waiting=deferred();
d=new PrivateConversation({path:':memory:',profile:'synthetic',isAllowed:async()=>true,
 toolsFor:()=>[{name:'workroom_create',description:'synthetic',parameters:params,handler:()=>{const result={project_id:'cancel-project',version:1};d.markTask('group:23456','job','workroom_create',{},result);return JSON.stringify(result);}}],
 client:{respond:async(_,options)=>{if(++round===1)return toolCall;waiting.resolve();return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});}},send:async()=>{cancelSends++;}});
const cancelled=d.receive('group:23456','job',source);await waiting.promise;
assert.deepEqual(d.cancelTask('group:23456',{senderId:'900000006'}),{cancelled:[]});
assert.equal(d.taskStatus('group:23456','job').state,'working');
assert.deepEqual(d.cancelTask('group:23456',{senderId:'900000001'}),{cancelled:['job']});
assert.equal((await cancelled).status,'failed-no-retry');assert.equal(cancelSends,0);
assert.equal(d.taskStatus('group:23456','job').state,'cancelled');await d.close();

// Reopening marks abandoned work as interrupted, uncertain sending as uncertain,
// and leaves both the source/checkpoint and the recorded project version intact.
const file=join(tmpdir(),'whale-task-lifecycle-'+randomUUID()+'.sqlite3');
const config={path:file,profile:'synthetic',isAllowed:async()=>true,client:{respond:async()=>{throw Error('Must not replay');}},send:async()=>{throw Error('Must not resend');}};
let persisted=new PrivateConversation(config);await persisted.close();
const db=new DatabaseSync(file);
for(const [event,state] of [['working','working'],['sending','sending']])db.prepare('INSERT INTO task_runs VALUES(?,?,?,?,?,?,?,?)').run('group:34567',event,'900000001',state,'workroom_write',JSON.stringify({project_id:'saved',version:3}),1,2);
db.close();persisted=new PrivateConversation(config);
assert.equal(persisted.taskStatus('group:34567','working').state,'interrupted');
assert.equal(persisted.taskStatus('group:34567','sending').state,'delivery-uncertain');
assert.equal(persisted.taskStatus('group:34567','working').checkpoint.version,3);
assert.equal(persisted.canDeliver('group:34567','sending',undefined),false);await persisted.close();
for(const name of [file,file+'-wal',file+'-shm'])if(existsSync(name))unlinkSync(name);
console.log('PASS durable task/checkpoint, ordinary interjection/revision preservation, owner-only cancellation/abort, async context, restart interruption/no replay/no resend');

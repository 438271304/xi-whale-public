import assert from 'node:assert/strict';
import {PrivateConversation} from './private-conversation.mjs';
const response={response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'hello'}]}]}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let calls=0,sends=0;const entered=deferred();
const c=new PrivateConversation({path:':memory:',profile:'public',isAllowed:async()=>true,
 client:{respond:async(_,options)=>{calls++;entered.resolve();return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});}},send:async()=>{sends++;}});
const first=c.receive('12345','a','one');await entered.promise;
const queued=c.receive('12345','b','two');await c.pause();
assert.equal(calls,1);assert.equal(sends,0);await first;await queued;
assert.equal((await c.receive('12345','c','paused')).status,'paused');
c.client={respond:async()=>response};c.resume();
assert.equal((await c.receive('12345','d','resumed')).status,'sent');
await Promise.all([c.close(),c.close()]);

// A provider ignoring abort must still never deliver after pause/resume.
const held=deferred(), started=deferred();let leaked=0;
const d=new PrivateConversation({path:':memory:',profile:'public',isAllowed:async()=>true,
 client:{respond:async()=>{started.resolve();return held.promise;}},send:async()=>{leaked++;}});
const turn=d.receive('12345','a','old');await started.promise;const pause=d.pause();d.resume();held.resolve(response);
await pause;await turn;assert.equal(leaked,0);await d.close();

// Pause must wait for a transport already in flight; other peers can work concurrently.
const gate=deferred(),sending=deferred();let sent=0;
const e=new PrivateConversation({path:':memory:',profile:'public',isAllowed:async()=>true,
 client:{respond:async()=>response},send:async peer=>{sent++;if(peer==='12345'){sending.resolve();await gate.promise;}}});
const a=e.receive('12345','1','A');await sending.promise;
assert.equal((await e.receive('23456','1','B')).status,'sent');
let drained=false;const draining=e.pause().then(()=>drained=true);await new Promise(r=>setImmediate(r));assert.equal(drained,false);
gate.resolve();await a;await draining;assert.equal(sent,2);await e.close();
console.log('PASS lifecycle: cancellation, queued turn invalidation, stale result after resume, in-flight send drain, cross-peer concurrency, idempotent close; fake provider/transport only');

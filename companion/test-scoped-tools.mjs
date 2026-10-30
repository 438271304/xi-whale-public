import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scopedTools,runScopedTurn} from './scoped-tools.mjs';
const base=mkdtempSync(join(tmpdir(),'whale-tools-'));let queries=[];
const tools=scopedTools({base,scope:{kind:'private',id:'12345'},history:async(s,a)=>{queries.push(a);return 'only-A';}});
const b=scopedTools({base,scope:{kind:'private',id:'23456'},history:async()=>{throw Error('Never accessed');}});
await b.find(t=>t.name==='write_note').handler({path:'diary.md',text:'B_SECRET'});
let n=0;const requests=[];
const client={respond:async req=>{requests.push(structuredClone(req));n++;return {response:{output:n===1?[
 {type:'function_call',call_id:'one',name:'read_note',arguments:JSON.stringify({path:'../private-23456/diary.md'})},
 {type:'function_call',call_id:'two',name:'search_history',arguments:JSON.stringify({keyword:'test',conversation:'private:23456'})},
 {type:'function_call',call_id:'three',name:'search_history',arguments:JSON.stringify({keyword:'test'})},
 ]:[{type:'message',role:'assistant',content:[{type:'output_text',text:'scoped reply'}]}]}};}};
assert.equal(await runScopedTurn({client,profile:'public',input:[{role:'user',content:'hello'}],tools}),'scoped reply');
assert.equal(queries.length,1);assert.equal(queries[0].conversation,'private:12345');
assert.ok(!JSON.stringify(requests).includes('B_SECRET'));assert.ok(JSON.stringify(requests[1]).includes('rejected or failed'));
let loop=0;await assert.rejects(runScopedTurn({client:{respond:async()=>({response:{output:[{type:'function_call',call_id:'loop-'+loop++,name:'list_notes',arguments:'{}'}]}})},profile:'public',input:[],tools,maxRounds:2}),/budget/);
const c=new AbortController();c.abort();await assert.rejects(runScopedTurn({client,profile:'public',input:[],tools,signal:c.signal}));
console.log('PASS actual scoped tool loop: cross-peer paths/args rejected, bound history, canary absent, round cap, abort; fake provider');

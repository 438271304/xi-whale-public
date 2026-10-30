import assert from 'node:assert/strict';
import {GroupBatch} from './group-batch.mjs';
const delivered=[];const b=new GroupBatch(async m=>{delivered.push(m);return {status:'ok'};},{delayMs:10,maxWaitMs:40});
const m=(group_id,id)=>({message_type:'group',group_id,message_id:id,message:[]});
await Promise.all([b.receive(m(12345,1)),b.receive(m(12345,2)),b.receive(m(23456,3))]);
assert.deepEqual(delivered.map(x=>x.map(y=>y.message_id)),[[1,2],[3]]);
const pending=b.receive(m(12345,4));b.cancel();assert.equal((await pending).status,'batch-cancelled');
await b.close();assert.equal((await b.receive(m(12345,5))).status,'closed');
console.log('PASS same-group coalescing, separate groups, pause cancellation and closed intake');

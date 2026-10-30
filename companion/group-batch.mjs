// Coalesce nearby group messages after permission/duplicate checks. Never mix groups.
export class GroupBatch{
 constructor(deliver,{delayMs=1000,maxWaitMs=3000}={}){this.deliver=deliver;this.delayMs=delayMs;this.maxWaitMs=maxWaitMs;this.batches=new Map();this.active=new Set();this.closed=false;}
 receive(message){
  if(this.closed)return Promise.resolve({status:'closed'});
  if(message.message_type!=='group')return this.track(this.deliver([message]));
  const key=String(message.group_id);let batch=this.batches.get(key);
  const size=JSON.stringify(message.message??[]).length+200;
  if(batch&&batch.size+size>8000){this.flush(key);batch=null;}
  if(!batch){batch={messages:[],resolvers:[],first:Date.now(),timer:null,size:0};this.batches.set(key,batch);}
  batch.size+=size;
  batch.messages.push(message);
  const result=new Promise(resolve=>batch.resolvers.push(resolve));
  clearTimeout(batch.timer);
  const delay=typeof this.delayMs==='function'?this.delayMs(message):this.delayMs;
  batch.timer=setTimeout(()=>this.flush(key),Math.max(0,Math.min(delay,this.maxWaitMs-(Date.now()-batch.first))));
  if(batch.messages.length>=8)this.flush(key);
  return result;
 }
 track(promise){const p=Promise.resolve(promise).catch(()=>({status:'batch-failed-no-retry'}));this.active.add(p);p.finally(()=>this.active.delete(p));return p;}
 flush(key){
  const b=this.batches.get(key);if(!b)return;clearTimeout(b.timer);this.batches.delete(key);
  this.track(this.deliver(b.messages)).then(result=>b.resolvers.forEach(r=>r(result)));
 }
 cancel(){for(const b of this.batches.values()){clearTimeout(b.timer);b.resolvers.forEach(r=>r({status:'batch-cancelled'}));}this.batches.clear();}
 async close(){this.closed=true;this.cancel();await Promise.allSettled([...this.active]);}
}

// Idempotent offline import. No source modification, model calls or event delivery.
import {readdirSync,readFileSync,existsSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {conversationScope} from './conversation-scope.mjs';
export function migrateScopedHistory(history,dataRoot){
 const counts={};const add=s=>counts[s]=(counts[s]??0)+1;
 function lines(file,consume){
  if(lstatSync(file).isSymbolicLink())throw Error('History link refused');
  for(const line of readFileSync(file,'utf8').split('\n')){
   if(!line.trim())continue;
   try{consume(JSON.parse(line));}catch{add('invalid-or-partial-line');}
  }
 }
 const runs=join(dataRoot,'runs');
 if(existsSync(runs))for(const d of readdirSync(runs,{withFileTypes:true})){
  if(!d.isDirectory()||d.isSymbolicLink())continue;
  const file=join(runs,d.name,'events.jsonl');
  if(existsSync(file))lines(file,row=>add(history.importEvent(row,'runs/'+d.name+'/events.jsonl')));
 }
 const pages=join(dataRoot,'qq-history-pages');
 if(existsSync(pages))for(const file of readdirSync(pages)){
  if(!/^\d{5,15}\.jsonl$/.test(file))continue;
  const scope=conversationScope('group',file.slice(0,-6));
  lines(join(pages,file),page=>{
   if(!Array.isArray(page.messages))throw Error('Malformed page');
   for(const m of page.messages){
    if(String(m.group_id)!==scope.id||!Number.isSafeInteger(m.message_id)||!Number.isFinite(m.time)){add('invalid-server-record');continue;}
    const body=Array.isArray(m.message)?m.message.map(s=>s.type==='text'?String(s.data?.text??''):'['+s.type+']').join(''):String(m.raw_message??'');
    const text=JSON.stringify({sender_id:String(m.user_id),body});
    if(text.length>100000){add('oversize-server-record');continue;}
    // Two representations may differ. Keep server and event-log evidence distinct;
    // search totals count records, not unique QQ messages across representations.
    add(history.insert(scope,'server:'+m.message_id,text,new Date(m.time*1000).toISOString(),'qq-history-pages/'+file));
   }
  });
 }
 return {counts,coverage:'Scoped historical records; event and server representations may overlap. No unscoped notes imported, no all-time completeness claim.'};
}

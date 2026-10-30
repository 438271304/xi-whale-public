import {randomUUID,createHash} from 'node:crypto';
import {publicQuery} from './public-exploration.mjs';
const terminal=new Set(['completed','cancelled']);
// Public questions only. The source identity stays local and is not a search query.
export class ExplorationFollowups{
 constructor(db,{clock=()=>Date.now()}={}){this.db=db;this.clock=clock;db.exec("CREATE TABLE IF NOT EXISTS exploration_followups(id TEXT PRIMARY KEY,dedupe TEXT UNIQUE,topic TEXT,question TEXT,source_scope TEXT,source_event TEXT,sender_id TEXT,state TEXT,activity_id TEXT,result TEXT,created INTEGER,updated INTEGER);UPDATE exploration_followups SET state='interrupted' WHERE state='running';");}
 decode(row){return row?{...row,result:row.result?JSON.parse(row.result):null}:null;}
 get(id){return this.decode(this.db.prepare('SELECT * FROM exploration_followups WHERE id=?').get(id));}
 list({limit=12}={}){return this.db.prepare('SELECT * FROM exploration_followups ORDER BY updated DESC LIMIT ?').all(Math.min(30,Math.max(1,limit))).map(r=>this.decode(r));}
 enqueue({topic,question,scope,event,senderId}){
  topic=publicQuery(topic);question=publicQuery(question);
  const address=typeof scope==='string'?scope:scope.kind+':'+scope.id;
  if(!/^(?:group|private):\d{5,15}$/.test(address)||! /^-?\d{1,20}$/.test(String(event))||! /^\d{5,15}$/.test(String(senderId)))throw Error('A current transport source is required');
  const dedupe=createHash('sha256').update(address+'\0'+event+'\0'+topic+'\0'+question).digest('hex'),prior=this.db.prepare('SELECT id FROM exploration_followups WHERE dedupe=?').get(dedupe);if(prior)return {...this.get(prior.id),duplicate:true};
  const id=randomUUID(),now=this.clock();this.db.prepare("INSERT INTO exploration_followups VALUES(?,?,?,?,?,?,?,'queued',NULL,NULL,?,?)").run(id,dedupe,topic,question,address,String(event),String(senderId),now,now);
  return {...this.get(id),scheduled_for:'next eligible existing daytime exploration opportunity; not started or answered yet'};
 }
 next(){return this.decode(this.db.prepare("SELECT * FROM exploration_followups WHERE state='queued' ORDER BY created,id LIMIT 1").get());}
 start(id,activity){const result=this.db.prepare("UPDATE exploration_followups SET state='running',activity_id=?,updated=? WHERE id=? AND state='queued'").run(activity,this.clock(),id);if(!result.changes)throw Error('Follow-up is no longer queued');return this.get(id);}
 finish(id,{activity,evidenceId,summary,outcome='partial'}){
  if(!['answered','partial'].includes(outcome)||typeof evidenceId!=='string'||!evidenceId||typeof summary!=='string'||!summary.trim())throw Error('An exploration needs actual saved evidence and an honest outcome');
  const result=this.db.prepare("UPDATE exploration_followups SET state='completed',result=?,updated=? WHERE id=? AND state='running' AND activity_id=?").run(JSON.stringify({outcome,summary:summary.slice(0,2400),evidence_id:evidenceId,meaning:'one evidence-backed exploration attempt; partial does not mean the question was solved'}),this.clock(),id,activity);
  if(!result.changes)throw Error('Follow-up is no longer running');return this.get(id);
 }
 interrupt(id,reason='interrupted'){this.db.prepare("UPDATE exploration_followups SET state=?,result=?,updated=? WHERE id=? AND state='running'").run(reason==='interrupted'?'interrupted':'blocked',JSON.stringify({reason,notice:'No completion is claimed; explicit resume can create another attempt'}),this.clock(),id);return this.get(id);}
 authorizeControl(id,{senderId,guardian=false}={}){
  const row=this.get(id);if(!row)throw Error('Unknown public follow-up');if(!guardian&&String(senderId)!==row.sender_id)throw Error('Only the originating person or a verified guardian can control this follow-up');
  return row;
 }
 control(id,action,authorization={}){
  const row=this.authorizeControl(id,authorization);
  if(!['pause','cancel','resume'].includes(action))throw Error('Invalid follow-up action');
  if(row.state==='running')throw Error('Pause the current exploration service before controlling a running attempt');
  if(terminal.has(row.state)&&action!=='cancel')throw Error('A completed/cancelled attempt is not silently replayed; create a fresh current request');
  const state=action==='resume'?'queued':action==='pause'?'paused':'cancelled';this.db.prepare('UPDATE exploration_followups SET state=?,updated=? WHERE id=?').run(state,this.clock(),id);return this.get(id);
 }
 tools(scope,{message,authorize,guardian=false,controlActive}={}){
  const decl=(name,description,properties,required,handler)=>({name,description,parameters:{type:'object',properties,required,additionalProperties:false},handler:async args=>{if(authorize&&!await authorize())throw Error('Exploration control paused or denied');return JSON.stringify(await handler(args));}});
  return [decl('queue_public_exploration','Persist one public-topic follow-up you genuinely intend to explore later. Use actual public search/read tools now when appropriate; use this before promising later work. Stores the current source, runs at an existing eligible daytime opportunity, and does not itself read, solve or send anything. Never include private chat text, names, account data or credentials.',{topic:{type:'string',maxLength:128},question:{type:'string',maxLength:128}},['topic','question'],a=>this.enqueue({...a,scope,event:message.message_id,senderId:message.user_id})),
   decl('public_exploration_tasks','Read persistent public follow-ups and their evidence/outcomes. queued is not started, completed+partial is not a solved question; interrupted/blocked need explicit resume.',{},[],()=>this.list()),
   decl('control_public_exploration','Pause/cancel or explicitly resume your own/guardian-authorized public follow-up. Completed or cancelled attempts are not replayed.',{id:{type:'string'},action:{type:'string',enum:['pause','cancel','resume']}},['id','action'],a=>(controlActive??((id,action,auth)=>this.control(id,action,auth)))(a.id,a.action,{senderId:message.user_id,guardian}))];
 }
}

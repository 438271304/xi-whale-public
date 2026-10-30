import {readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {homeTools} from './home-tools.mjs';
import {publicReading} from './public-reading.mjs';
import {publicExploration} from './public-exploration.mjs';
import {ConversationWorkspace} from './conversation-scope.mjs';
import {Workroom,workroomTools} from './workroom.mjs';
import {Workshop,workshopTools} from './workshop.mjs';
import {NativeWorkshopBackend} from './workshop-native.mjs';
import {DshWorkshopBackend,RoutedWorkshopBackend} from './workshop-dsh.mjs';
import {BilibiliPublic} from './bilibili-public.mjs';
import {TiebaClaw} from './tieba-claw.mjs';
import {LifeWorkshop} from './life-workshop.mjs';

// The home is deliberately public. Only the family group can publish its card;
// private chats may save a draft inside their own notes, never silently publish it.
export function conversationExtras({workspace,notesRoot,familyGroup,fetcher=fetch,workroomPath,policy={},publicClient,tiebaTokenReader}){
 const workroom=workroomPath?new Workroom(workroomPath):null;
 const native=workroom?new NativeWorkshopBackend({root:join(dirname(workroomPath),'workshop-runs')}):null;
 const workshop=workroom?new Workshop({path:join(dirname(workroomPath),'workshop.sqlite3'),workroom,backend:new RoutedWorkshopBackend({native,dsh:new DshWorkshopBackend({native})})}):null;
 const bili=workroom?new BilibiliPublic({root:dirname(workroomPath),client:publicClient}):null;
 // Dedicated account credential only; never borrow a browser cookie, a model
 // key or a token supplied by tool arguments. A newly added file takes effect
 // on the next normal service restart. Absence remains visibly unconfigured.
 const tiebaSecret=workroomPath?join(dirname(workroomPath),'credentials','tieba-token.txt'):null;
 const tieba=new TiebaClaw({tokenReader:tiebaTokenReader??(tiebaSecret&&existsSync(tiebaSecret)?()=>{
  const data=readFileSync(tiebaSecret);if(data.length>4096)throw Error('Invalid dedicated token');return data.toString('utf8').trim();
 }:undefined)});
 let ownCreative=null,closed=false;
 const shelf=publicReading({fetcher});
 const home=homeTools([{name:'write_file',handler:async({path,content})=>{
  if(path!=='projects/home/card.json')throw Error('Only the home card is writable');
  const file=join(workspace,path),tmp=file+'.'+randomUUID()+'.tmp';mkdirSync(dirname(file),{recursive:true});
  try{writeFileSync(tmp,content,{flag:'wx'});renameSync(tmp,file);}finally{if(existsSync(tmp))unlinkSync(tmp);}
  return '[written] public home card';
 }}],{fetcher});
 const provide=(scope,context)=>{
  const tools=[home.find(t=>t.name==='home_read'),shelf];
  tools.push(...publicExploration({client:publicClient,signal:context?.signal}));
  if(bili)tools.push(...bili.tools({signal:context?.signal}));
  tools.push(...tieba.tools({signal:context?.signal}));
  if(scope.kind==='group'&&scope.id===String(familyGroup))tools.push(home.find(t=>t.name==='home_update'));
  else tools.push({name:'home_draft',description:'Save an idea for your public home card privately in this conversation. This does not change the public page or share private content.',parameters:{type:'object',properties:{text:{type:'string',maxLength:2000}},required:['text'],additionalProperties:false},handler:({text})=>{
   if(typeof text!=='string'||text.length>2000)throw Error('Invalid draft');
   new ConversationWorkspace(notesRoot,scope).write('home-draft.md',text);return 'Draft saved only in this conversation. The public home page has not changed.';
  }});
  if(workroom)tools.push(...workroomTools(workroom,scope,context,policy));
  if(workshop)tools.push(...workshopTools(workshop,scope,context,policy));
  if(ownCreative)tools.push({name:'own_workroom_status',description:'Read your own independently chosen creative projects and actual asynchronous job status across chats. This is your separate personal creative space, not another person’s private project. Queued/check-only is not completed execution.',parameters:{type:'object',properties:{},additionalProperties:false},handler:async()=>{
   if(context?.authorize&&!await context.authorize())throw Error('Conversation paused');return JSON.stringify(ownCreative.context());
  }},{name:'own_workroom_read',description:'Read a saved file/version in your own personal creative space. Does not edit or execute. Keep unfinished and actually run work distinct.',parameters:{type:'object',properties:{project_id:{type:'string'},path:{type:'string'},version:{type:'integer',minimum:1},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:10000}},required:['project_id'],additionalProperties:false},handler:async a=>{
   if(context?.authorize&&!await context.authorize())throw Error('Conversation paused');return JSON.stringify(workroom.read(ownCreative.scope,a.project_id,a.path,a.version,{offset:a.offset,limit:a.limit}));
  }});
  return tools;
 };
 provide.tasks=scope=>workshop?.list(scope).map(({id,project,base_version,state,checkpoint,error,updated})=>({job_id:id,project_id:project,base_version,state,checkpoint,error,updated}))??[];
 provide.pause=()=>workshop?.pause();provide.resume=()=>workshop?.resumeService();
 provide.bindCognition=cognition=>{if(bili)bili.cognition=cognition;tieba.bindCognition(cognition);if(workroom&&workshop&&policy.bot_id)ownCreative=new LifeWorkshop({workroom,workshop,cognition,policy,eligible:()=>!workshop.paused&&!workshop.closed});if(workshop)workshop.onResult=async(scope,job)=>cognition.store.recordMessage({scope,event:'workshop:'+job.id,role:'self',text:JSON.stringify({job_id:job.id,project_id:job.project,state:job.state,result:job.result}),at:Date.now(),source:'verified-workshop-result'});};
 provide.ownCreativeContext=()=>ownCreative?.context()??{available:false,notice:'Own creative stores are not connected.'};
 provide.ownCreativeTools=context=>ownCreative?.tools(context)??[];
 provide.publicTools=({signal}={})=>[...publicExploration({client:publicClient,signal}),...(bili?bili.tools({signal}):[]),...tieba.tools({signal})];
  provide.ownHomeTools=()=>[home.find(tool=>tool.name==='home_read')];
 // Display connected adapters only. Execution readiness verifies large binaries
 // and belongs to an actual tool request, not every UI/status refresh. Unknown
 // readiness is deliberate; prior result metadata is displayed separately.
 provide.capabilityStatus=()=>{
  const item=(configured,available,autonomous,blocker=null)=>({configured,available:closed?false:available,autonomous,blocker:closed?'service-closed':blocker});
  const frames=!!bili&&typeof bili.sampler==='function'&&!!bili.analyzer,speech=!!bili?.speech;
  const claw=typeof tieba.tokenReader==='function';
  return {
   public_web:item(true,null,true),
   // The fixed Claw adapter grants no ordinary Tieba-wide access claim.
   ordinary_tieba:item(null,null,null),
   claw:item(claw,claw?null:false,true,claw?null:'credential-reader-not-configured'),
   bilibili_subtitles:item(!!bili,bili&&!bili.closed?null:false,!!bili,bili?null:'reader-not-connected'),
   bilibili_frames:item(frames,!frames||bili.closed?false:null,!!bili,!frames?'reader-not-connected':null),
   bilibili_speech:item(speech,!speech||bili.closed?false:null,!!bili,!speech?'reader-not-connected':null),
   own_workshop:item(!!workshop,!workshop||workshop.closed||workshop.paused?false:null,!!ownCreative,workshop?.paused?'workshop-paused':null),
  };
 };
 provide.close=async()=>{closed=true;await workshop?.close();await bili?.close();workroom?.close();};return provide;
}
export function importStickerSeeds(media,{manifest,assets}){
 // Exactly the seven previously deployed PNGs, not every research download.
 const approved=new Set(['deepseek-bao-jing-shui-jiao','deepseek-bixin','deepseek-bu-lai','deepseek-da-ku','deepseek-jushou-dazhaohu','deepseek-touding-wenhao','deepseek-zhangkai-shuangshou-huanhu']);
 const rows=JSON.parse(readFileSync(manifest,'utf8')).filter(row=>approved.has(row.id));let count=0;
 if(rows.length!==approved.size||new Set(rows.map(r=>r.id)).size!==approved.size)throw Error('Approved sticker manifest incomplete');
 for(const row of rows){
  if(!/^[a-z0-9-]+$/.test(row.id))throw Error('Invalid approved seed name');
  media.importApprovedSeed(readFileSync(join(assets,row.id+'.png')),String(row.description).slice(0,100));count++;
 }
 return {seeds:count};
}

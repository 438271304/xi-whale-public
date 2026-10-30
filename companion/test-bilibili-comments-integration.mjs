import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BilibiliPublic} from './bilibili-public.mjs';
import {CuriosityLife} from './curiosity-life.mjs';
import {UnifiedCognition} from './cognition-tools.mjs';
import {LifeContinuity} from './life-continuity.mjs';
import {LifeProgress} from './life-progress.mjs';
import {ExplorationFollowups} from './exploration-followups.mjs';

const BV='BV1Xa4y1u7jG',BOT='930110001',GROUP='930120001',NOW=Date.parse('2036-10-18T12:00:00+08:00');
const comment=(id,text='A synthetic public observation.',root='0',parent='0')=>({id,root_id:root,parent_id:parent,
 author:{id:'930130001',name:'Synthetic commenter'},at:1600000000000,text,context_only:false,text_truncated:false});
const raw=item=>({rpid_str:item.id,oid_str:'93001',type:1,mid_str:item.author.id,root_str:item.root_id,parent_str:item.parent_id,
 ctime:item.at/1000,member:{mid:item.author.id,uname:item.author.name},content:{message:item.text},replies:[]});
const read={name:'bilibili_comments',args:{video:BV}};
const choose={name:'choose_activity',args:{topic:'A public video discussion',why:'I want to read what the actual commenters noticed.'}};
const save={name:'save_discovery',args:{summary:'The returned synthetic commenter noticed a small change; this does not establish what the whole video shows.'}};
const quiet={name:'keep_quiet',args:{}};
const output=req=>JSON.parse(req.input.filter(x=>x.type==='function_call_output').at(-1).output);

function lifeFixture(t,{empty=false,refused=false}={}){
 const root=mkdtempSync(join(tmpdir(),'whale-comments-chain-')),cognition=new UnifiedCognition(root,{botId:BOT,clock:()=>NOW});
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE turns(peer TEXT,event TEXT,role TEXT,text TEXT,at INTEGER,state TEXT)');
 let plan=[],sequence=0,networkCalls=0,sends=0;
 const request=async url=>{networkCalls++;
  if(url.includes('/view?'))return Buffer.from(JSON.stringify({code:0,data:{aid:93001,bvid:BV}}));
  return Buffer.from(JSON.stringify(refused?{code:-101}:{code:0,data:{page:{num:1,size:20,count:empty?0:25},replies:empty?null:[raw(comment('301'))]}}));
 };
 const reader=new BilibiliPublic({root,client:{},request});
 // Match conversationExtras.bindCognition: it happens after construction.
 reader.cognition=cognition;
 const client={canInitiate:()=>true,respond:async req=>{
  assert.ok(plan.length,'Only scripted model responses are permitted');const item=plan.shift(),action=typeof item==='function'?item(req):item;
  return {response:{id:'synthetic-'+(++sequence),status:'completed',output:[{type:'function_call',name:action.name,call_id:'call-'+sequence,arguments:JSON.stringify(action.args)}]}};
 }};
 const service={paused:false,closed:false,cognition,engine:{db,queues:new Map(),revisions:new Map(),profile:'Synthetic identity'},initiate:async()=>{sends++;throw Error('No QQ send permitted');}};
 const world={getWatched:()=>({groups:[GROUP]}),driver:{callApi:async name=>{assert.equal(name,'get_friend_list');return [];}}};
 const life=new CuriosityLife({path:join(root,'life.sqlite3'),service,world,client,policy:{bot_id:BOT,group_id:GROUP},
  social:{inbound:()=>NOW},tools:({signal})=>reader.tools({signal}),topics:()=>[],clock:()=>NOW});
 life.resume();t.after(async()=>{await life.close();await reader.close();cognition.close();db.close();});
 return {life,reader,cognition,plan(...items){plan=items;},done(){assert.equal(plan.length,0);assert.equal(sends,0);},get networkCalls(){return networkCalls;}};
}

test('actual shared Bilibili tool -> autonomous read -> public experience -> saved discovery retains source scope',async t=>{
 const f=lifeFixture(t);let observed,saved;
 f.plan(req=>{assert.ok(req.tools.some(x=>x.name==='bilibili_comments'));return choose;},read,
  req=>{observed=output(req);assert.equal(observed.evidence_level,'public-comments');assert.equal(observed.content.video_read,false);return save;},
  req=>{saved=output(req);assert.equal(saved.saved,true);return quiet;});
 await f.life.tick();f.done();assert.equal(f.networkCalls,2);
 const evidence=f.life.db.prepare('SELECT level,details FROM life_reading_evidence').get();assert.equal(evidence.level,'public-comments');
 assert.equal(JSON.parse(evidence.details).read_scope.page,1);
 const source=f.cognition.store.get({id:observed.experience_ref.id});assert.equal(source.found,true);assert.equal(source.scope,'unknown');assert.equal(source.role,'self');
 const returned=JSON.parse(source.text);assert.equal(returned.comments[0].author.id,'930130001');assert.equal(returned.comments[0].at,1600000000000);
 assert.ok(source.sources.some(x=>x.source==='public-exploration'));
 const discovery=f.cognition.store.get({id:saved.evidence_id});assert.ok(JSON.parse(discovery.text).sources.some(x=>x.level==='public-comments'));
 assert.equal(f.life.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,0);
 assert.equal(f.reader.capabilities().comments,true);
 // A normal chat handler uses exactly the same source reader and late-bound memory.
 const chat=JSON.parse(await f.reader.tools()[0].handler({video:BV}));assert.equal(chat.cached,true);
 assert.equal(chat.experience_ref.id,observed.experience_ref.id);assert.equal(f.cognition.store.get({id:chat.experience_ref.id}).version_count,1);
});

for(const mode of ['empty','refused'])test(mode+' comments cannot satisfy save_discovery or create a public-reading experience',async t=>{
 const f=lifeFixture(t,{[mode]:true});
 f.plan(choose,read,req=>{const result=output(req);assert.equal(result.status,mode==='empty'?'empty':'failed');assert.deepEqual(result.sources,[]);return save;},
  req=>{const result=output(req);assert.equal(result.saved,false);assert.equal(result.reason,'actual-reading-required');return quiet;});
 await f.life.tick();f.done();assert.equal(f.life.db.prepare('SELECT count(*) n FROM discoveries').get().n,0);
 assert.equal(f.cognition.store.db.prepare("SELECT count(*) n FROM experiences WHERE event LIKE 'bilibili-comments:%'").get().n,0);
});

function progressFixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE activities(id TEXT PRIMARY KEY,topic TEXT,motivation TEXT,state TEXT,summary TEXT,created INTEGER,updated INTEGER);CREATE TABLE discoveries(id TEXT PRIMARY KEY,activity TEXT,url TEXT,title TEXT,excerpt TEXT,at INTEGER)');
 const continuity=new LifeContinuity(db),progress=new LifeProgress(db);new ExplorationFollowups(db);let n=0;
 const add=(id,comments,{bvid=BV,page=1,root_id=null,empty=false}={})=>{
  db.prepare('INSERT INTO activities VALUES(?,?,?,?,?,?,?)').run(id,'Synthetic discussion','','completed','',++n,n);
  const result={status:empty?'empty':'ok',evidence_level:empty?'none':'public-comments',comments,read_scope:{page,root_id,next_page:page+1,all_comments_read:false}};
  const url='https://api.bilibili.com/x/v2/reply'+(root_id?'/reply':'')+'?oid='+bvid+'&pn='+page+(root_id?'&root='+root_id:'');
  db.prepare('INSERT INTO discoveries VALUES(?,?,?,?,?,?)').run('source-'+id,id,url,'Synthetic comments',JSON.stringify({bvid,comments}),n);
  continuity.recordReading('source-'+id,id,'bilibili_comments',result);return progress.inspect(id);
 };
 return {db,progress,add};
}

test('preview/root-context/page reorder and metadata changes do not create new comment material',t=>{
 const f=progressFixture(t),root=comment('301'),reply=comment('302','Synthetic reply.','301','301');
 assert.equal(f.add('first',[root,reply]).counts['new-material'],1);
 const repeated=f.add('detail',[{...reply,author:{...reply.author,name:'Renamed public display'}},{...root,context_only:true}],{root_id:'301'});
 assert.equal(repeated.counts['same-material'],1);assert.equal(repeated.sources[0].scope.read_scope.root_id,'301');
 assert.equal(f.add('page-two',[reply,root],{page:2}).counts['same-material'],1);
});

test('new reply or changed visible text advances even when most root context overlaps',t=>{
 const f=progressFixture(t),root=comment('301','Large synthetic context '.repeat(40)),old=comment('302','Old reply','301','301');
 f.add('one',[root,old]);const fresh=comment('303','New actual reply','301','302');
 assert.equal(f.add('two',[root,old,fresh],{root_id:'301'}).counts['new-material'],1);
 assert.equal(f.add('three',[root,{...old,text:'Corrected synthetic reply'},fresh],{page:2}).counts['new-material'],1);
 assert.equal(f.add('shorter',[{...root,text:root.text.slice(0,50),text_truncated:true}],{page:3}).counts['same-material'],1);
 assert.equal(f.add('actually-edited-shorter',[{...old,text:'Old',text_truncated:false}],{page:4}).counts['new-material'],1);
});

test('identical text in another video remains separate and root/page attempts remain distinct',t=>{
 const f=progressFixture(t),item=comment('301');f.add('one',[item]);
 assert.equal(f.add('two',[item],{bvid:'BV1GJ411x7h7'}).counts['new-material'],1);
 for(const args of [{video:BV,root_id:'301',page:1},{video:BV,root_id:'302',page:1},{video:BV,root_id:'301',page:2}])f.progress.recordAttempt('two',{tool:'bilibili_comments',args,result:{status:'ok'}});
 assert.equal(f.progress.inspect('two').repeated_requests,0);
 assert.equal(f.add('invalid-empty',[item],{empty:true}).counts['unverified-material'],1);
});

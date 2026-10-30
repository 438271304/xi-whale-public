import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LifeContinuity} from './life-continuity.mjs';
import {LifeShareAudience} from './life-share-audience.mjs';
import {conversationScope} from './conversation-scope.mjs';
import {transportMessage} from './group-message.mjs';

// Real SQLite migrations and persistent restart, synthetic discoveries only.
// This module has no transport, provider, private record or network dependency.
const family={recipient:'family',target_kind:'group',target_id:'910520001',recipient_reason:'A small discovery for the family together.'};
const father={recipient:'father',target_kind:'private',target_id:'910510002',recipient_reason:'This fits the public topic Dad enjoys.'};
const mother={recipient:'mother',target_kind:'private',target_id:'910510003',recipient_reason:'I want to tell Mom about this detail.'};
const fields=row=>Object.fromEntries(['recipient','target_kind','target_id','recipient_reason'].map(key=>[key,row[key]]));
function fixture(t,{legacy=false}={}){
 const path=join(mkdtempSync(join(tmpdir(),'whale-life-audience-')),'life.sqlite3');
 let db=new DatabaseSync(path),now=Date.parse('2036-10-17T12:00:00+08:00');
 db.exec('CREATE TABLE activities(id TEXT PRIMARY KEY,topic TEXT,summary TEXT); CREATE TABLE discoveries(id TEXT PRIMARY KEY,activity TEXT,url TEXT,title TEXT,excerpt TEXT,at INTEGER)');
 if(legacy){
  db.exec('CREATE TABLE life_share_intents(id TEXT PRIMARY KEY,activity TEXT UNIQUE NOT NULL,evidence TEXT NOT NULL,text TEXT NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,next_review INTEGER NOT NULL,attempt TEXT,receipt TEXT)');
  for(const state of ['queued','sending','sent','uncertain']){
   const id='old-'+state;db.prepare('INSERT INTO activities VALUES(?,?,?)').run(id,'Old synthetic topic','Old saved summary');
   db.prepare('INSERT INTO life_share_intents(id,activity,evidence,text,digest,state,reason,created,updated,next_review,attempt,receipt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,id,'old-evidence','A preserved old draft','old-digest',state,'old-reason',100,200,0,'old-attempt','{"message_id":42}');
  }
 }
 let life=new LifeContinuity(db,{clock:()=>now});
 t.after(()=>db.close());
 return {get db(){return db;},get life(){return life;},advance(){now+=31*60000;},
  activity(id){db.prepare('INSERT INTO activities VALUES(?,?,?)').run(id,'Synthetic public topic','A genuinely stored fixture summary');return id;},
  restart(){db.close();db=new DatabaseSync(path);life=new LifeContinuity(db,{clock:()=>now});return life;}
 };
}

test('a genuine old schema migrates without replacing intents/receipts and survives an idempotent restart',t=>{
 const f=fixture(t,{legacy:true});
 for(const state of ['queued','sending','sent','uncertain']){
  const row=f.life.get('old-'+state);
  assert.deepEqual(fields(row),{recipient:'family',target_kind:null,target_id:null,recipient_reason:null});
  assert.equal(row.text,'A preserved old draft');assert.equal(row.digest,'old-digest');
  assert.equal(row.receipt,'{"message_id":42}');assert.equal(row.attempt,'old-attempt');
  assert.equal(row.created,100);assert.equal(row.updated,200);
  assert.equal(row.state,state==='sending'?'uncertain':state);
 }
 assert.deepEqual(f.life.pending().map(row=>row.id),['old-queued']);
 const columns=f.db.prepare('PRAGMA table_info(life_share_intents)').all().map(row=>row.name);
 assert.ok(['recipient','target_kind','target_id','recipient_reason'].every(name=>columns.includes(name)));
 const before=f.db.prepare('SELECT * FROM life_share_intents ORDER BY id').all();
 f.restart();assert.deepEqual(f.db.prepare('SELECT * FROM life_share_intents ORDER BY id').all(),before);
});

test('old/default family intent binds its unresolved target once without redirecting or inventing a new intention',t=>{
 const f=fixture(t,{legacy:true}),old=f.life.get('old-queued');
 assert.throws(()=>f.life.bindTarget(old.id,{target_kind:'private',target_id:'910510002'}),/agree/);
 const bound=f.life.bindTarget(old.id,{target_kind:'group',target_id:family.target_id});
 assert.equal(bound.recipient,'family');assert.equal(bound.target_id,family.target_id);assert.equal(bound.target_kind,'group');
 assert.equal(bound.recipient_reason,null);assert.equal(bound.text,old.text);assert.equal(bound.id,old.id);
 assert.deepEqual(fields(f.life.pending()[0]),fields(bound));
 assert.throws(()=>f.life.bindTarget(old.id,{target_kind:'group',target_id:'910520002'}),/unresolved queued/);
 assert.throws(()=>f.life.bindTarget(old.id,{target_kind:'group',target_id:family.target_id}),/unresolved queued/);
 const legacyDefault=f.life.queue(f.activity('default'),'fixture-evidence','Saved default-family text');
 assert.deepEqual(fields(legacyDefault),{recipient:'family',target_kind:null,target_id:null,recipient_reason:null});
 assert.equal(f.life.bindTarget(legacyDefault.id,{target_kind:'group',target_id:family.target_id}).target_id,family.target_id);
});

test('queued reconsideration can deliberately switch father/mother/family while retaining one intent and validating before changing text',t=>{
 const f=fixture(t),activity=f.activity('current'),initial=f.life.queue(activity,'fixture-evidence','First draft',father);
 assert.deepEqual(fields(f.life.pending()[0]),father);
 const duplicate=f.life.queue(activity,'another-evidence','A competing draft',mother);
 assert.deepEqual(duplicate,initial);assert.equal(f.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,1);
 let offered=f.life.pending();
 const changed=f.life.reconsider(initial.id,{decision:'later',reason:'A fresh audience choice.',text:'A revised public discovery.',...mother},offered);
 assert.equal(changed.id,initial.id);assert.deepEqual(fields(changed),mother);assert.equal(changed.state,'queued');
 assert.equal(changed.text,'A revised public discovery.');assert.equal(changed.activity,activity);
 const before=f.life.get(initial.id);
 assert.throws(()=>f.life.reconsider(initial.id,{decision:'share',reason:'Invalid combination',text:'Must not replace the draft',recipient:'family',target_kind:'private',target_id:mother.target_id},offered),/agree/);
 assert.deepEqual(f.life.get(initial.id),before,'Audience validation failure must not partially update the message');
 assert.throws(()=>f.life.reconsider(initial.id,{decision:'share',reason:'Label-only change',recipient:'father'},offered),/explicit target/);
 f.advance();offered=f.life.pending();
 const group=f.life.reconsider(initial.id,{decision:'share',reason:'Now for everyone.',...family},offered);
 assert.deepEqual(fields(group),family);assert.equal(group.id,initial.id);
 assert.equal(f.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,1);
});

test('sent and uncertain intents cannot be redirected, rebound or requeued even through a previously offered snapshot',t=>{
 for(const state of ['sent','uncertain']){
  const f=fixture(t),activity=f.activity('terminal-'+state),intent=f.life.queue(activity,'fixture-evidence','Saved text',father),offered=f.life.pending();
  f.life.begin(intent.id,'synthetic-attempt');f.life.settle(intent.id,state,{message_id:900});
  const before=f.life.get(intent.id);
  assert.throws(()=>f.life.reconsider(intent.id,{decision:'share',reason:'A stale redirect',...mother},offered),/pending discovery/);
  assert.throws(()=>f.life.bindTarget(intent.id,{target_kind:'private',target_id:mother.target_id}),/unresolved queued/);
  assert.deepEqual(f.life.queue(activity,'new-evidence','Do not resend to another person',mother),before);
  assert.deepEqual(f.life.get(intent.id),before);assert.equal(f.life.pending().length,0);
 }
});

test('persistent restart changes an in-flight send to uncertain and retains its exact recipient/target',t=>{
 const f=fixture(t),activity=f.activity('in-flight'),intent=f.life.queue(activity,'fixture-evidence','A saved sharing intention',mother),offered=f.life.pending();
 f.life.begin(intent.id,'attempt-before-crash');f.restart();
 const restored=f.life.get(intent.id);assert.equal(restored.state,'uncertain');assert.deepEqual(fields(restored),mother);
 assert.equal(restored.attempt,'attempt-before-crash');assert.equal(restored.reason,'restart-during-delivery-no-automatic-retry');
 assert.equal(f.life.pending().length,0);
 assert.throws(()=>f.life.reconsider(intent.id,{decision:'later',reason:'Must remain frozen',...father},offered),/pending discovery/);
});

test('new explicit audiences require a matching kind and nonempty numeric string ID',t=>{
 const f=fixture(t),activity=f.activity('invalid');
 const invalid=[{...family,target_kind:'private'},{...father,target_kind:'group'},{...mother,target_id:''},{...mother,target_id:' 910510003'},
  {...mother,target_id:'not-a-number'},{...mother,target_id:910510003},{...mother,target_id:null},{recipient:'family',target_kind:null,target_id:null},
  {...family,recipient:'anyone'},{...mother,recipient_reason:''}];
 for(const target of invalid)assert.throws(()=>f.life.queue(activity,'fixture-evidence','A draft',target));
 assert.equal(f.db.prepare('SELECT count(*) n FROM life_share_intents').get().n,0);
 const intent=f.life.queue(activity,'fixture-evidence','A valid family draft',family);assert.deepEqual(fields(intent),family);
});

const AUD_POLICY={bot_id:'920610001',father_id:'920610002',mother_id:'920610003',group_id:'920620001',peer_bot_ids:['920610004']};
const AUD_GROUP=conversationScope('group',AUD_POLICY.group_id),AUD_FATHER=conversationScope('private',AUD_POLICY.father_id),AUD_MOTHER=conversationScope('private',AUD_POLICY.mother_id);
const AUD_OTHER=conversationScope('group','920620002');
function audienceFixture(t){
 const root=mkdtempSync(join(tmpdir(),'whale-share-experience-')),path=join(root,'life.sqlite3'),turnPath=join(root,'turns.sqlite3');
 let db,conversationDb,life,audience,now=Date.parse('2036-10-17T12:00:00+08:00'),sequence=0;
 function open(){
  db=new DatabaseSync(path);conversationDb=new DatabaseSync(turnPath);
  db.exec('CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,topic TEXT,summary TEXT)');
  conversationDb.exec('CREATE TABLE IF NOT EXISTS turns(peer TEXT,event TEXT,role TEXT,text TEXT,at INTEGER,state TEXT,PRIMARY KEY(peer,event,role))');
  life=new LifeContinuity(db,{clock:()=>now});audience=new LifeShareAudience({db,conversationDb,policy:AUD_POLICY,clock:()=>now});
 }
 open();t.after(()=>{db.close();conversationDb.close();});
 return {get db(){return db;},get conversationDb(){return conversationDb;},get audience(){return audience;},get now(){return now;},
  later(ms=1000){now+=ms;},at(value){now=Date.parse(value);},restart(){db.close();conversationDb.close();open();},
  share({scope=AUD_GROUP,state='sent',legacy=false,assistant=true}={}){
   const id='activity-'+(++sequence),attempt='share-'+sequence;
   db.prepare('INSERT INTO activities VALUES(?,?,?)').run(id,'Synthetic public topic','Synthetic saved discovery');
   const target=legacy?undefined:{recipient:scope.kind==='group'?'family':scope.id===AUD_POLICY.father_id?'father':'mother',target_kind:scope.kind,target_id:scope.id,recipient_reason:'Synthetic deliberate choice'};
   const intent=life.queue(id,'synthetic-evidence','Synthetic saved sharing text '+sequence,target);
   life.begin(intent.id,attempt);if(state!=='sending')life.settle(intent.id,state,state==='sent'?{message_id:sequence}:null);
   if(assistant)conversationDb.prepare("INSERT INTO turns VALUES(?,?,'assistant',?,?,?)").run(scope.address,'proactive:'+attempt,'Synthetic sent sharing text',now,state);
   return life.get(intent.id);
  },
  message({scope=AUD_GROUP,sender=AUD_POLICY.father_id,text='普通聊天',atSelf=false,atOther=null,replyTo=null,role='user',patch={},transportPatch={}}={}){
   const event=String(10000+(++sequence));
   const message={message_type:scope.kind,group_id:Number(scope.id),user_id:Number(sender),message_id:Number(event),time:now/1000,
    message:[...(atSelf?[{type:'at',data:{qq:AUD_POLICY.bot_id}}]:[]),...(atOther?[{type:'at',data:{qq:atOther}}]:[]),
     ...(replyTo?[{type:'reply',data:{id:'999'}}]:[]),{type:'text',data:{text}}]};
   const data=transportMessage(message,{scope,botId:AUD_POLICY.bot_id,resolveReply:()=>({sender_id:replyTo,conversation:scope.address})});
   Object.assign(data,patch);Object.assign(data.transport,transportPatch);
   conversationDb.prepare('INSERT INTO turns VALUES(?,?,?,?,?,?)').run(scope.address,event,role,JSON.stringify(data),now,'completed');
   return event;
  }
 };
}

test('recipient experience counts sent and unknown receipts across restart without changing intents',t=>{
 const f=audienceFixture(t);f.share();f.later();f.share({state:'uncertain'});
 const before=f.db.prepare('SELECT * FROM life_share_intents ORDER BY id').all();
 let view=f.audience.inspect(AUD_GROUP);assert.equal(view.can_send,false);assert.equal(view.unanswered_count,2);assert.equal(view.reason,'awaiting-human-response');
 assert.equal(view.last_human_response_at,null);assert.deepEqual(view.recent_feedback,[]);
 f.restart();view=f.audience.inspect(AUD_GROUP);assert.equal(view.can_send,false);assert.equal(view.unanswered_count,2);
 assert.deepEqual(f.db.prepare('SELECT * FROM life_share_intents ORDER BY id').all(),before);
});

test('an in-flight current delivery does not count until it settles; restart uncertainty counts',t=>{
 const f=audienceFixture(t);f.share();f.later();f.share({state:'sending'});
 assert.equal(f.audience.inspect(AUD_GROUP).unanswered_count,1);assert.equal(f.audience.inspect(AUD_GROUP).can_send,true);
 f.restart();assert.equal(f.audience.inspect(AUD_GROUP).unanswered_count,2);assert.equal(f.audience.inspect(AUD_GROUP).can_send,false);
});

test('legacy unbound family rows count only for configured group without binding old targets',t=>{
 const f=audienceFixture(t);f.share({legacy:true,assistant:false});f.later();f.share({legacy:true,state:'uncertain',assistant:false});
 assert.equal(f.audience.inspect(AUD_GROUP).unanswered_count,2);assert.equal(f.audience.inspect(AUD_OTHER).unanswered_count,0);
 assert.equal(f.audience.inspect(AUD_FATHER).unanswered_count,0);
 for(const row of f.db.prepare('SELECT target_kind,target_id FROM life_share_intents').all())assert.deepEqual({...row},{target_kind:null,target_id:null});
});

test('private correspondent resets only their own audience, never another parent or a forged sender',t=>{
 const f=audienceFixture(t);f.share({scope:AUD_FATHER});f.later();f.share({scope:AUD_FATHER,state:'uncertain'});
 assert.equal(f.audience.inspect(AUD_FATHER).can_send,false);assert.equal(f.audience.inspect(AUD_MOTHER).can_send,true);assert.equal(f.audience.inspect(AUD_GROUP).can_send,true);
 f.later();f.message({scope:AUD_MOTHER,sender:AUD_POLICY.mother_id,text:'普通私聊'});
 f.message({scope:AUD_FATHER,sender:AUD_POLICY.mother_id,text:'不是这个私聊的发话人'});
 assert.equal(f.audience.inspect(AUD_FATHER).can_send,false);
 f.later();f.message({scope:AUD_FATHER,text:'今晚回来吃饭'});const view=f.audience.inspect(AUD_FATHER);
 assert.equal(view.can_send,true);assert.equal(view.unanswered_count,0);assert.equal(view.last_human_response_at,f.now);assert.deepEqual(view.recent_feedback,[]);
});

test('bots, assistant claims, cross-scope metadata, notices and ordinary group exchanges never reset',t=>{
 const f=audienceFixture(t);f.share();f.later();f.share();
 const cases=[{sender:AUD_POLICY.peer_bot_ids[0],text:'牛逼',atSelf:true},{sender:AUD_POLICY.bot_id,text:'牛逼',atSelf:true},
  {text:'说通俗一点',atSelf:true,role:'assistant'},{text:'说通俗一点',atSelf:true,transportPatch:{conversation:AUD_OTHER.address}},
  {text:'说通俗一点',atSelf:true,transportPatch:{event_kind:'notice'}},{text:'今晚吃什么'},{text:'吃面吧',sender:AUD_POLICY.mother_id},
  {text:'牛逼',atOther:AUD_POLICY.mother_id},{text:'牛逼',replyTo:AUD_POLICY.mother_id},
  {text:'牛逼',transportPatch:{attention:'direct'},patch:{routing:{attention:'direct',sender_kind:'peer-bot'}}}];
 for(const value of cases){f.later();f.message(value);assert.equal(f.audience.inspect(AUD_GROUP).can_send,false);}
 assert.equal(f.audience.inspect(AUD_GROUP).last_human_response_at,null);assert.deepEqual(f.audience.inspect(AUD_GROUP).recent_feedback,[]);
});

for(const addressing of [{atSelf:true},{replyTo:AUD_POLICY.bot_id},{text:'汐，你刚才讲的我没看懂'}])test('verified group addressing resets after two shares: '+JSON.stringify(addressing),t=>{
 const f=audienceFixture(t);f.share();f.later();f.share();f.later(11*60000);f.message({text:'听不懂',...addressing});
 const view=f.audience.inspect(AUD_GROUP);assert.equal(view.can_send,true);assert.equal(view.unanswered_count,0);assert.equal(view.last_human_response_at,f.now);
});

test('only an attributable short reaction within ten minutes resets without an explicit address',t=>{
 const f=audienceFixture(t);f.share();f.later();f.share();f.later(10*60000);const event=f.message({text:'牛逼'});
 let view=f.audience.inspect(AUD_GROUP);assert.equal(view.can_send,true);assert.equal(view.recent_feedback[0].event,event);assert.equal(view.recent_feedback[0].text,'牛逼');assert.deepEqual(view.preferences,[]);
 f.later();f.share();f.later();f.share();f.later(10*60000+1);f.message({text:'牛逼'});
 view=f.audience.inspect(AUD_GROUP);assert.equal(view.can_send,false);assert.equal(view.recent_feedback.length,1);
});

test('an intervening bot reply or people talking to each other makes a short reaction unattributable',t=>{
 for(const intervening of [{sender:AUD_POLICY.peer_bot_ids[0],text:'这是我的新作品'},
  {sender:AUD_POLICY.mother_id,text:'明天一起吃饭吗'},{sender:AUD_POLICY.mother_id,text:'好的',atOther:AUD_POLICY.father_id}]){
  const f=audienceFixture(t);f.share();f.later();f.share();f.later();f.message(intervening);f.later();f.message({text:'牛逼'});
  const view=f.audience.inspect(AUD_GROUP);assert.equal(view.can_send,false);assert.deepEqual(view.recent_feedback,[]);
 }
});

test('explicit feedback persists, stays tied to its speaker and latest contrary request replaces only that key',t=>{
 const f=audienceFixture(t);const initial=f.message({sender:AUD_POLICY.mother_id,atSelf:true,text:'以后说通俗一点，少用术语，不要连续发'});
 let view=f.audience.refresh(AUD_GROUP);assert.equal(view.preferences.length,3);
 assert.ok(view.preferences.every(p=>p.sender_id===AUD_POLICY.mother_id&&p.event===initial&&p.scope===AUD_GROUP.address&&p.source==='explicit-human-request'));
 f.later();const dad=f.message({atSelf:true,text:'多讲技术细节，可以用专业术语'});
 view=f.audience.inspect(AUD_GROUP);assert.equal(view.preferences.length,5);assert.equal(view.preferences.find(p=>p.sender_id===AUD_POLICY.mother_id&&p.key==='language').value,'plain');
 assert.equal(view.preferences.find(p=>p.sender_id===AUD_POLICY.father_id&&p.key==='language').event,dad);
 f.restart();view=f.audience.inspect(AUD_GROUP);assert.equal(view.preferences.length,5);
 f.later();const changed=f.message({sender:AUD_POLICY.mother_id,atSelf:true,text:'说得专业一点，可以用术语，可以连续发'});
 view=f.audience.inspect(AUD_GROUP);assert.equal(view.preferences.length,5);
 assert.ok(view.preferences.filter(p=>p.sender_id===AUD_POLICY.mother_id).every(p=>p.event===changed));
 assert.deepEqual(view.preferences.filter(p=>p.sender_id===AUD_POLICY.mother_id).map(p=>p.value).sort(),['allowed','continuous-allowed','technical']);
 assert.deepEqual(f.audience.inspect(AUD_MOTHER).preferences,[],'A group preference must not be silently transferred to private scope');
});

test('feedback is deduplicated, capped at five for composition, and preferences survive newer praise and restart',t=>{
 const f=audienceFixture(t);const instruction=f.message({atSelf:true,text:'少用术语'});f.audience.inspect(AUD_GROUP);
 for(let i=0;i<7;i++){f.later();f.message({atSelf:true,text:'牛逼'});f.audience.inspect(AUD_GROUP);}
 const before=f.db.prepare('SELECT count(*) n FROM life_share_feedback').get().n;
 for(let i=0;i<4;i++)f.audience.inspect(AUD_GROUP);
 assert.equal(f.db.prepare('SELECT count(*) n FROM life_share_feedback').get().n,before);assert.equal(before,8);
 f.restart();const view=f.audience.inspect(AUD_GROUP);assert.equal(view.recent_feedback.length,5);assert.ok(view.recent_feedback.every(row=>row.text==='牛逼'));
 assert.equal(view.preferences.length,1);assert.equal(view.preferences[0].event,instruction);assert.equal(view.preferences[0].value,'less');
});

test('direct quoted/reported requests do not become the speaker own preference',t=>{
 const f=audienceFixture(t);
 for(const text of ['妈妈说少用术语','如果你以后少用术语就好了','不是说不要连续发','我不需要你少用术语','“不要连续发”是妈妈说的','牛逼']){
  f.later();f.message({atSelf:true,text});
 }
 assert.deepEqual(f.audience.inspect(AUD_GROUP).preferences,[]);
});

test('a blocked recipient still refreshes older feedback, including through a persistent bounded sample',t=>{
 const f=audienceFixture(t);const event=f.message({scope:AUD_FATHER,text:'少用术语'});f.later();f.share({scope:AUD_FATHER});f.later();f.share({scope:AUD_FATHER,state:'uncertain'});
 let view=f.audience.inspect(AUD_FATHER);assert.equal(view.can_send,false);assert.equal(view.preferences[0].event,event);assert.equal(view.recent_feedback[0].event,event);
 f.later(8*86400000);f.restart();view=f.audience.inspect(AUD_FATHER);assert.equal(view.preferences[0].event,event);assert.ok(view.last_human_response_at<f.now-7*86400000);
});

test('Beijing midnight starts a new audience opportunity; response and feedback persistence have no nightly expiry',t=>{
 const f=audienceFixture(t);f.at('2036-10-17T23:58:00+08:00');f.message({scope:AUD_FATHER,text:'不要连续发'});f.later();f.share({scope:AUD_FATHER});f.later();f.share({scope:AUD_FATHER,state:'uncertain'});
 f.at('2036-10-17T23:59:59.999+08:00');assert.equal(f.audience.inspect(AUD_FATHER).can_send,false);
 f.at('2036-10-18T00:00:00+08:00');const view=f.audience.inspect(AUD_FATHER);assert.equal(view.can_send,true);assert.equal(view.unanswered_count,0);assert.equal(view.preferences[0].value,'wait-for-reply');
 // This module is only the audience gate. Existing transport quiet hours still
 // prevent a midnight send; it does not own a scheduler or permission bypass.
 f.share({scope:AUD_FATHER});f.later();f.share({scope:AUD_FATHER});assert.equal(f.audience.inspect(AUD_FATHER).can_send,false);
});

test('scope validation rejects mismatches before collecting evidence',t=>{
 const f=audienceFixture(t);
 for(const scope of [null,'group:920620001',{kind:'group',id:'x'},{...AUD_GROUP,address:AUD_OTHER.address},{...AUD_GROUP,key:AUD_OTHER.key},{kind:'channel',id:AUD_GROUP.id}])assert.throws(()=>f.audience.inspect(scope),/scope/i);
 assert.equal(f.db.prepare('SELECT count(*) n FROM life_share_feedback').get().n,0);
});

test('explicit comprehension, ordinary reply length and unnecessary self-description feedback keep source evidence',t=>{
 const f=audienceFixture(t);
 const cases=[
  {text:'我怎么看不懂你在说什么',scope:AUD_GROUP,sender:AUD_POLICY.mother_id,key:'language',value:'plain'},
  {text:'越来越深奥了',scope:AUD_GROUP,sender:AUD_POLICY.mother_id,key:'language',value:'plain'},
  {text:'正常交流太长',scope:AUD_FATHER,sender:AUD_POLICY.father_id,key:'length',value:'concise'},
  {text:'这一句话就没必要，直接说下一句就是很好的回答',scope:AUD_GROUP,sender:AUD_POLICY.father_id,key:'meta',value:'less'},
 ];
 for(const item of cases){
  f.later();const event=f.message({...item,atSelf:item.scope.kind==='group'}),view=f.audience.inspect(item.scope);
  const preference=view.preferences.find(row=>row.sender_id===item.sender&&row.key===item.key);
  assert.equal(preference.value,item.value);assert.equal(preference.event,event);assert.equal(preference.at,f.now);assert.equal(preference.scope,item.scope.address);
  assert.equal(view.recent_feedback[0].text,item.text);assert.equal(view.recent_feedback[0].event,event);
 }
 f.restart();assert.equal(f.audience.inspect(AUD_FATHER).preferences.find(row=>row.key==='length').value,'concise');
 f.later();f.message({scope:AUD_FATHER,text:'回答详细一点'});
 assert.equal(f.audience.inspect(AUD_FATHER).preferences.find(row=>row.key==='length').value,'detailed');
 f.later();f.message({atSelf:true,text:'可以自我说明'});
 assert.equal(f.audience.inspect(AUD_GROUP).preferences.find(row=>row.sender_id===AUD_POLICY.father_id&&row.key==='meta').value,'explain');
});

test('welcoming more shares coexists with plain short replies and never relaxes the unanswered limit',t=>{
 const f=audienceFixture(t);f.message({scope:AUD_FATHER,text:'说通俗一点，回答简短一点，不要连续发，可以多分享，我喜欢看你分享'});
 let view=f.audience.inspect(AUD_FATHER);assert.equal(view.preferences.length,4);
 assert.equal(view.preferences.find(row=>row.key==='language').value,'plain');assert.equal(view.preferences.find(row=>row.key==='length').value,'concise');
 assert.equal(view.preferences.find(row=>row.key==='cadence').value,'wait-for-reply');assert.equal(view.preferences.find(row=>row.key==='sharing').value,'welcome');
 f.later();f.share({scope:AUD_FATHER});f.later();f.share({scope:AUD_FATHER});view=f.audience.inspect(AUD_FATHER);
 assert.equal(view.can_send,false);assert.equal(view.unanswered_count,2);
});

test('cost reactions are retained as bounded source text without invented spending, mood or style preferences',t=>{
 const f=audienceFixture(t);f.share();f.later();f.share();f.later();const event=f.message({text:'token在燃烧'});
 const view=f.audience.inspect(AUD_GROUP);assert.equal(view.can_send,true);assert.equal(view.recent_feedback[0].event,event);
 assert.equal(view.recent_feedback[0].text,'token在燃烧');assert.deepEqual(view.preferences,[]);
});

test('a future conversation-clock timestamp cannot erase otherwise settled unanswered sends',t=>{
 const f=audienceFixture(t);f.share();f.later();f.share({state:'uncertain'});
 f.conversationDb.prepare("UPDATE turns SET at=? WHERE role='assistant'").run(f.now+86400000);
 const view=f.audience.inspect(AUD_GROUP);assert.equal(view.can_send,false);assert.equal(view.unanswered_count,2);
});

test('legacy activity shares need matching same-scope proactive turns and terminal delivery evidence',t=>{
 const f=audienceFixture(t);
 f.db.exec('CREATE TABLE activity_shares(id TEXT PRIMARY KEY,activity TEXT,digest TEXT,state TEXT,at INTEGER)');
 const old=(id,{scope=AUD_GROUP,state='sent',turnState=state,turn=true}={})=>{
  f.db.prepare('INSERT INTO activity_shares VALUES(?,?,?,?,?)').run(id,'synthetic-old-activity','synthetic-digest',state,f.now);
  if(turn)f.conversationDb.prepare("INSERT INTO turns VALUES(?,?,'assistant',?,?,?)").run(scope.address,'proactive:'+id,'Synthetic historical share',f.now,turnState);
 };
 old('legacy-sent');f.later();old('legacy-uncertain',{state:'uncertain'});
 old('other-scope',{scope:AUD_OTHER});old('no-turn',{turn:false});old('not-attempted',{state:'sending'});old('turn-deferred',{turnState:'deferred'});
 // Proactive turns from another subsystem have no life activity evidence.
 f.conversationDb.prepare("INSERT INTO turns VALUES(?,?,'assistant',?,?,'sent')").run(AUD_GROUP.address,'proactive:social-only','Synthetic other kind of initiation',f.now);
 const before=f.db.prepare('SELECT * FROM activity_shares ORDER BY id').all();
 assert.equal(f.audience.inspect(AUD_GROUP).unanswered_count,2);assert.equal(f.audience.inspect(AUD_GROUP).can_send,false);
 assert.equal(f.audience.inspect(AUD_OTHER).unanswered_count,1);assert.equal(f.audience.inspect(AUD_FATHER).unanswered_count,0);
 f.restart();assert.equal(f.audience.inspect(AUD_GROUP).unanswered_count,2);
 assert.deepEqual(f.db.prepare('SELECT * FROM activity_shares ORDER BY id').all(),before);
 f.later();old('last-legacy');f.later();f.message({text:'越来越深奥了'});
 const view=f.audience.inspect(AUD_GROUP);assert.equal(view.can_send,true);assert.equal(view.preferences[0].value,'plain');
});

test('an intent and its old activity ledger entry count once while an unpaired bound intent still counts',t=>{
 const f=audienceFixture(t);
 f.db.exec('CREATE TABLE activity_shares(id TEXT PRIMARY KEY,activity TEXT,digest TEXT,state TEXT,at INTEGER)');
 const paired=f.share();f.db.prepare('INSERT INTO activity_shares VALUES(?,?,?,?,?)').run(paired.attempt,paired.activity,paired.digest,'sent',f.now);
 assert.equal(f.audience.inspect(AUD_GROUP).unanswered_count,1);
 f.later();f.share({state:'uncertain',assistant:false});
 assert.equal(f.audience.inspect(AUD_GROUP).unanswered_count,2);assert.equal(f.audience.inspect(AUD_FATHER).unanswered_count,0);
});

test('contextual but attributable ordinary-length criticism is retained verbatim without inventing a preference rule',t=>{
 const f=audienceFixture(t),text='合成反馈：这次正常交流有一点太长，具体怎么调整下次再聊。';
 const event=f.message({scope:AUD_FATHER,text}),view=f.audience.inspect(AUD_FATHER);
 assert.equal(view.recent_feedback[0].event,event);assert.equal(view.recent_feedback[0].text,text);assert.deepEqual(view.preferences,[]);
 f.message({scope:AUD_GROUP,text,atOther:AUD_POLICY.mother_id});assert.deepEqual(f.audience.inspect(AUD_GROUP).recent_feedback,[]);
});

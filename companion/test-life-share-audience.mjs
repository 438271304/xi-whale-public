import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LifeContinuity} from './life-continuity.mjs';

// Real SQLite migrations and persistent restart, synthetic discoveries only.
// This module has no transport, provider, private record or network dependency.
const family={recipient:'family',target_kind:'group',target_id:'910520001',recipient_reason:'A small discovery for the family together.'};
const father={recipient:'father',target_kind:'private',target_id:'910510002',recipient_reason:'This fits the public topic Dad enjoys.'};
const mother={recipient:'mother',target_kind:'private',target_id:'910510003',recipient_reason:'I want to tell Mom about this detail.'};
const fields=row=>Object.fromEntries(['recipient','target_kind','target_id','recipient_reason'].map(key=>[key,row[key]]));
function fixture(t,{legacy=false}={}){
 const path=join(mkdtempSync(join(tmpdir(),'whale-life-audience-')),'life.sqlite3');
 let db=new DatabaseSync(path),now=Date.parse('2026-10-30T12:00:00+08:00');
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

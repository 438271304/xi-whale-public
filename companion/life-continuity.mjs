import {randomUUID, createHash} from 'node:crypto';
import {findNativeFaces,selectNativeFaces} from './qq-face-output.mjs';

// Storage validation is not send authorization: LifeShareMedia still rechecks
// public provenance and the actual bytes immediately before the one transport.
function jsonData(value,depth=0){
  if(depth>8)throw Error('Invalid saved media plan');
  if(value===null||typeof value==='string'||typeof value==='boolean'||Number.isSafeInteger(value))return value;
  if(Array.isArray(value)){
    if(value.length>8||Reflect.ownKeys(value).some(key=>key!=='length'&&!(typeof key==='string'&&String(Number(key))===key&&Number.isSafeInteger(Number(key))&&Number(key)>=0&&Number(key)<value.length)))throw Error('Invalid saved media array');
    return Array.from({length:value.length},(_,i)=>{const p=Object.getOwnPropertyDescriptor(value,String(i));if(!p||!Object.hasOwn(p,'value'))throw Error('Invalid saved media array');return jsonData(p.value,depth+1);});
  }
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).some(key=>typeof key!=='string'))throw Error('Invalid saved media object');
  return Object.fromEntries(Reflect.ownKeys(value).sort().map(key=>{const p=Object.getOwnPropertyDescriptor(value,key);if(!p.enumerable||!Object.hasOwn(p,'value'))throw Error('Invalid saved media field');return [key,jsonData(p.value,depth+1)];}));
}
const keys=(value,wanted)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...wanted].sort().join('|');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function savedMedia(plan){
  if(plan===null||plan===undefined)return null;
  const value=jsonData(plan),serialized=JSON.stringify(value);
  if(serialized.length>2500||value.schema!==1||!keys(value,['schema','metadata',...(value.native_face_ids!==undefined?['native_face_ids']:[]),...(value.public_image_id!==undefined?['public_image_id']:[])]))throw Error('Invalid saved media plan');
  const expected=[];
  if(value.native_face_ids!==undefined){
    const faces=selectNativeFaces(value.native_face_ids);expected.push('native_faces','native_face_map');
    if(JSON.stringify(value.native_face_ids)!==JSON.stringify(faces.map(face=>face.id))||JSON.stringify(jsonData(faces))!==JSON.stringify(value.metadata?.native_faces)||JSON.stringify(jsonData(findNativeFaces('',0).source))!==JSON.stringify(value.metadata?.native_face_map))throw Error('Invalid saved native face metadata');
  }
  if(value.public_image_id!==undefined){
    expected.push('public_image');const image=value.metadata?.public_image,source=image?.source;
    if(typeof value.public_image_id!=='string'||!/^[a-f0-9-]{36}$/.test(value.public_image_id)||!keys(image,['mime','sha256','source'])||!hash(image.sha256))throw Error('Invalid saved public image metadata');
    if(source?.kind==='approved-legacy-sticker'){
      if(image.mime!=='image/png'||!keys(source,['kind','seed_id'])||!/^deepseek-(?:bao-jing-shui-jiao|bixin|bu-lai|da-ku|jushou-dazhaohu|touding-wenhao|zhangkai-shuangshou-huanhu)$/.test(source.seed_id))throw Error('Invalid legacy image metadata');
    }else if(source?.kind==='fixed-public-catalog'){
      if(image.mime!=='image/jpeg'||!keys(source,['kind','filename','manifest_sha256','download_sha256','prepared_sha256','metadata_stripped','first_frame_only','author_known'])||
        typeof source.filename!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}\.(?:png|jpe?g|webp|gif)$/i.test(source.filename)||source.filename.includes('..')||
        !hash(source.manifest_sha256)||!hash(source.download_sha256)||source.prepared_sha256!==image.sha256||source.metadata_stripped!==true||typeof source.first_frame_only!=='boolean'||source.author_known!==false)throw Error('Invalid catalog image metadata');
    }else throw Error('Unsupported saved public image provenance');
  }
  if(!expected.length||!keys(value.metadata,expected))throw Error('Invalid saved attachment metadata');
  return serialized;
}
const digest = (text,media=null) => createHash('sha256').update(media===null?text.replace(/\s+/g,''):'life-media-expression-v1\0'+text.replace(/\s+/g,'')+'\0'+media).digest('hex');
const expressionBinding=prior=>({intent_id:prior.id,revision:prior.revision,digest:prior.digest,recipient:prior.recipient,target_kind:prior.target_kind,target_id:prior.target_id,recipient_reason:prior.recipient_reason});
const active = row => row.value?.active !== false;
const bounded = (value, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error('A bounded nonempty value is required');
  return value.trim();
};
const audienceFields=['recipient','target_kind','target_id','recipient_reason'];
const targetKinds={family:'group',father:'private',mother:'private'};
const legacyAudience=()=>({recipient:'family',target_kind:null,target_id:null,recipient_reason:null});
function audience(value,{prior=null,allowUnbound=false}={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!audienceFields.includes(key)))throw Error('Invalid sharing audience');
  const merged={...(prior??legacyAudience()),...value};
  const named=Object.hasOwn(targetKinds,merged.recipient),dynamic=typeof merged.recipient==='string'?/^(group|private):([1-9]\d{4,14})$/.exec(merged.recipient):null;
  if(!named&&!dynamic)throw Error('Choose a configured family alias or listed social target');
  const kind=named?targetKinds[merged.recipient]:dynamic[1];
  if(dynamic&&merged.target_id!==dynamic[2])throw Error('Listed recipient and target ID must agree');
  if(prior&&merged.recipient!==prior.recipient&&(!Object.hasOwn(value,'target_kind')||!Object.hasOwn(value,'target_id')))throw Error('A changed recipient needs an explicit target');
  if(!(allowUnbound&&merged.recipient==='family'&&merged.target_kind===null&&merged.target_id===null)){
    if(merged.target_kind!==kind||typeof merged.target_id!=='string'||!/^\d+$/.test(merged.target_id))throw Error('Recipient and target kind/ID must agree');
  }
  if(Object.hasOwn(value,'recipient_reason'))merged.recipient_reason=bounded(value.recipient_reason,400);
  return merged;
}

// A durable continuation of the existing life opportunity, not a new scheduler.
export class LifeContinuity {
  constructor(db, {clock = () => Date.now()} = {}) {
    this.db = db;
    this.clock = clock;
    db.exec(`
      CREATE TABLE IF NOT EXISTS life_intentions(
        activity TEXT PRIMARY KEY, basis TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS life_reading_evidence(
        discovery TEXT PRIMARY KEY, activity TEXT NOT NULL, tool TEXT NOT NULL,
        level TEXT NOT NULL, details TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS life_share_intents(
        id TEXT PRIMARY KEY, activity TEXT UNIQUE NOT NULL, evidence TEXT NOT NULL,
        text TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, reason TEXT NOT NULL,
        created INTEGER NOT NULL, updated INTEGER NOT NULL, next_review INTEGER NOT NULL,
        attempt TEXT, receipt TEXT,
        recipient TEXT NOT NULL DEFAULT 'family', target_kind TEXT, target_id TEXT, recipient_reason TEXT
      );
    `);
    // In-place migration keeps every old intent/attempt/receipt. Unresolved old
    // family targets are bound by the caller at delivery, never guessed here.
    db.exec('BEGIN IMMEDIATE');
    try{
      const columns=new Set(db.prepare('PRAGMA table_info(life_share_intents)').all().map(column=>column.name));
      for(const [name,type] of [['recipient',"TEXT NOT NULL DEFAULT 'family'"],['target_kind','TEXT'],['target_id','TEXT'],['recipient_reason','TEXT'],['revision','INTEGER NOT NULL DEFAULT 1'],['media_plan','TEXT']]){
        if(!columns.has(name))db.exec('ALTER TABLE life_share_intents ADD COLUMN '+name+' '+type);
      }
      db.exec("UPDATE life_share_intents SET state='uncertain',revision=revision+1, reason='restart-during-delivery-no-automatic-retry' WHERE state='sending'; COMMIT");
    }catch(error){db.exec('ROLLBACK');throw error;}
  }

  candidates(states) {
    return states.filter(row => ['interest', 'unfinished', 'idea'].includes(row.kind) && active(row))
      .map(({kind, key, revision, value, evidence, at}) => ({kind, key, revision, value, evidence, at}));
  }

  choose(activity, {why, sourceState, candidates = [], followup = null}) {
    const basis = {type: 'new-curiosity', source_state: null, followup_id: followup?.id ?? null};
    if (sourceState !== undefined) {
      const row = candidates.find(r => r.kind === sourceState?.kind && r.key === sourceState?.key && r.revision === sourceState?.revision);
      if (!row) throw Error('Choose a currently offered active state and its exact revision');
      basis.type = 'continuing-own-interest';
      basis.source_state = row;
    } else if (followup) basis.type = 'public-followup';
    this.db.prepare('INSERT INTO life_intentions VALUES(?,?,?,?)').run(activity, JSON.stringify(basis), bounded(why, 400), this.clock());
    return basis;
  }

  intention(activity) {
    const row = this.db.prepare('SELECT * FROM life_intentions WHERE activity=?').get(activity);
    return row ? {...row, basis: JSON.parse(row.basis)} : null;
  }

  recordReading(discovery, activity, tool, result) {
    let level = 'unknown';
    if (tool.endsWith('_search') || result.evidence_level === 'search-lead') level = 'search-lead';
    else if (tool === 'public_fetch') level = 'page-text';
    else if (['bilibili_read','bilibili_listen'].includes(tool)) level = result.content?.subtitle_read ? 'subtitles' :
      result.content?.speech_transcript?.segments?.some(segment => segment.state === 'transcribed' && segment.text?.trim()) ? 'speech-transcript' :
      result.content?.sampled_frames?.some(frame => frame.status === 'vision-ok') ? 'sampled-frames' : 'metadata-only';
    else if (result.evidence_level === 'thread-posts') level = 'thread-posts';
    // Persist the observed scope, never a model's claim that it watched/heard more.
    const c = result.content;
    const details = {retrieved_at: result.retrieved_at ?? null, content: c ? {
      metadata_read: c.metadata_read === true, subtitle_read: c.subtitle_read === true,
      subtitle_truncated: c.subtitle_truncated ?? null,
      sampled_frames: (c.sampled_frames ?? []).map(({time, status, sha256}) => ({time, status, sha256})),
      speech_transcript: c.speech_transcript ? {
        kind: c.speech_transcript.kind,
        model_id: c.speech_transcript.evidence?.model_id,
        media_sha256: c.speech_transcript.media_sha256,
        model_sha256: c.speech_transcript.evidence?.model_sha256,
        coverage: c.speech_transcript.evidence?.coverage,
        unprocessed_ranges: c.speech_transcript.evidence?.unprocessed_ranges,
        alignment: c.speech_transcript.alignment,
        non_speech_understood: false
      } : null,
      audio_understood: false, whole_video_watched: false
    } : null,
      next_offset: result.next_offset ?? null, limitations: result.limitations ?? [], whole_video_watched: false,
      thread_id: result.thread_id ?? null, parent_post_id: result.parent_post_id ?? null,
      read_scope: result.read_scope ?? null, gaps: result.gaps ?? []};
    this.db.prepare('INSERT INTO life_reading_evidence VALUES(?,?,?,?,?)')
      .run(discovery, activity, tool, level, JSON.stringify(details));
    return level;
  }

  sources(activity) {
    return this.db.prepare(`SELECT d.url,d.title,d.excerpt,r.tool,r.level,r.details
      FROM discoveries d JOIN life_reading_evidence r ON r.discovery=d.id WHERE d.activity=?`).all(activity)
      .map(row => ({...row, details: JSON.parse(row.details)}));
  }

  queue(activity, evidence, text, recipient) {
    text = bounded(text, 500);
    if (typeof evidence !== 'string' || !evidence) throw Error('A saved discovery evidence ID is required');
    const prior = this.db.prepare('SELECT * FROM life_share_intents WHERE activity=?').get(activity);
    if (prior) return this.get(prior.id); // One intent per discovery; uncertain/sent never re-queued.
    const target=recipient===undefined?legacyAudience():audience(recipient);
    const id = randomUUID(), now = this.clock();
    this.db.prepare("INSERT INTO life_share_intents (id,activity,evidence,text,digest,state,reason,created,updated,next_review,attempt,receipt,recipient,target_kind,target_id,recipient_reason) VALUES(?,?,?,?,?,'queued','wanted-to-share',?,?,?,NULL,NULL,?,?,?,?)")
      .run(id, activity, evidence, text, digest(text), now, now, now,target.recipient,target.target_kind,target.target_id,target.recipient_reason);
    return this.get(id);
  }

  get(id) {const row=this.db.prepare('SELECT * FROM life_share_intents WHERE id=?').get(id);return row?{...row,media_plan:row.media_plan===null?null:JSON.parse(row.media_plan)}:null;}

  pending({rotate = false} = {}) {
    if (typeof rotate !== 'boolean') throw Error('Invalid pending sharing rotation');
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + 1800000)) throw Error('Invalid sharing opportunity time');
    const offer = () => {
      const rows = this.db.prepare(`SELECT s.*,a.topic,a.summary FROM life_share_intents s JOIN activities a ON a.id=s.activity
        WHERE s.state='queued' AND s.next_review<=? ORDER BY s.next_review,s.updated,s.created,s.id LIMIT 5`).all(now);
      // Materialize the complete offered set first: a failed source read must not
      // advance a candidate which could not actually be provided to this turn.
      const offered = rows.map(row => ({id: row.id, activity: row.activity, evidence_id: row.evidence, topic: row.topic,
        summary: row.summary, draft: row.text, age_minutes: Math.max(0, Math.floor((now - row.created) / 60000)),
        reason: row.reason,recipient:row.recipient,target_kind:row.target_kind,target_id:row.target_id,recipient_reason:row.recipient_reason,
        sources: this.sources(row.activity).map(({url, title, level}) => ({url, title, level}))}));
      if (rotate) {
        // Same standard opportunity interval as reconsider/defer. This is only
        // an offer lease; no state, target, draft or updated time is changed.
        const update = this.db.prepare("UPDATE life_share_intents SET next_review=? WHERE id=? AND state='queued' AND next_review=?");
        for (const row of rows) if (update.run(now + 1800000, row.id, row.next_review).changes !== 1) throw Error('Sharing candidates changed before rotation');
      }
      return offered;
    };
    if (!rotate) return offer();
    // Atomic selection + all leases, including when called inside a larger
    // existing transaction. Nothing can be half-rotated on a failed update.
    this.db.exec('SAVEPOINT life_share_rotation');
    try {const offered = offer(); this.db.exec('RELEASE life_share_rotation'); return offered;}
    catch (error) {this.db.exec('ROLLBACK TO life_share_rotation; RELEASE life_share_rotation'); throw error;}
  }

  reconsider(id, args, offered) {
    const current=this.get(id);
    if (!offered.some(row => row.id === id) || current?.state !== 'queued') throw Error('Choose a currently pending discovery');
    let {decision,reason,text}=args;
    if(Object.hasOwn(args,'media_plan')||Object.hasOwn(args,'attachments'))throw Error('Only a new prepared expression can choose attachments');
    if (!['share', 'later', 'discard'].includes(decision)) throw Error('Invalid sharing decision');
    reason = bounded(reason, 400);
    const patch=Object.fromEntries(audienceFields.filter(field=>Object.hasOwn(args,field)).map(field=>[field,args[field]]));
    const target=audience(patch,{prior:Object.fromEntries(audienceFields.map(field=>[field,current[field]])),
      allowUnbound:current.recipient==='family'&&current.target_kind===null&&current.target_id===null});
    text=text===undefined?current.text:bounded(text,500);
    const media=text!==current.text||audienceFields.some(field=>target[field]!==current[field])?null:savedMedia(current.media_plan);
    const changed=this.db.prepare("UPDATE life_share_intents SET revision=revision+1,text=?,digest=?,media_plan=?,state=?,reason=?,updated=?,next_review=?,recipient=?,target_kind=?,target_id=?,recipient_reason=? WHERE id=? AND state='queued' AND recipient=? AND target_kind IS ? AND target_id IS ? AND revision=?")
      .run(text,digest(text,media),media,decision === 'discard' ? 'discarded' : 'queued', reason, this.clock(), this.clock() + 1800000,
        target.recipient,target.target_kind,target.target_id,target.recipient_reason,id,current.recipient,current.target_kind,current.target_id,current.revision);
    if(!changed.changes)throw Error('Sharing intention changed; reconsider the current record');
    return this.get(id);
  }

  bindTarget(id,{target_kind,target_id}){
    const current=this.get(id);
    if(current?.state!=='queued'||current.target_kind!==null||current.target_id!==null)throw Error('Only an unresolved queued target can be bound');
    const target=audience({target_kind,target_id},{prior:Object.fromEntries(audienceFields.map(field=>[field,current[field]]))});
    const changed=this.db.prepare("UPDATE life_share_intents SET revision=revision+1,target_kind=?,target_id=?,updated=? WHERE id=? AND state='queued' AND target_kind IS NULL AND target_id IS NULL AND recipient=?")
      .run(target.target_kind,target.target_id,this.clock(),id,current.recipient);
    if(!changed.changes)throw Error('Sharing target changed; no redirect performed');
    return this.get(id);
  }

  defer(id, reason) {
    this.db.prepare("UPDATE life_share_intents SET revision=revision+1,state='queued',reason=?,updated=?,next_review=? WHERE id=? AND state IN ('queued','sending')")
      .run(reason, this.clock(), this.clock() + 1800000, id);
  }

  prepareExpression(prior, {decision, text, reason,media_plan=null,binding=null}) {
    if (!['share','later','keep_private'].includes(decision)) throw Error('Invalid expression decision');
    if(prior?.state!=='queued')throw Error('Sharing expression is no longer pending');
    if(binding!==null&&JSON.stringify(jsonData(binding))!==JSON.stringify(jsonData(expressionBinding(prior))))throw Error('Prepared expression belongs to another intent, recipient or revision');
    if(media_plan!==null&&binding===null)throw Error('Media expression needs its exact intent binding');
    reason = bounded(reason, 240);
    text = decision === 'share' ? bounded(text, 360) : prior.text;
    const previous=savedMedia(prior.media_plan),media=decision==='share'?savedMedia(media_plan):previous;
    const changed = this.db.prepare("UPDATE life_share_intents SET revision=revision+1,text=?,digest=?,media_plan=?,state=?,reason=?,updated=?,next_review=? WHERE id=? AND state='queued' AND digest=? AND media_plan IS ? AND recipient=? AND target_kind IS ? AND target_id IS ? AND recipient_reason IS ? AND revision=?")
      .run(text,digest(text,media),media,decision==='keep_private'?'discarded':'queued',reason,this.clock(),this.clock()+1800000,
        prior.id,prior.digest,previous,prior.recipient,prior.target_kind,prior.target_id,prior.recipient_reason,prior.revision);
    if (changed.changes !== 1) throw Error('Sharing intention changed during expression preparation');
    return this.get(prior.id);
  }

  deferSnapshot(prior, reason) {
    return this.db.prepare("UPDATE life_share_intents SET revision=revision+1,reason=?,updated=?,next_review=? WHERE id=? AND state='queued' AND revision=?")
      .run(reason,this.clock(),this.clock()+1800000,prior.id,prior.revision).changes===1;
  }

  deferAttempt(id, attempt, reason) {
    return this.db.prepare("UPDATE life_share_intents SET revision=revision+1,state='queued',reason=?,updated=?,next_review=? WHERE id=? AND state='sending' AND attempt=?")
      .run(reason,this.clock(),this.clock()+1800000,id,attempt).changes===1;
  }

  begin(id, attempt, revision = null) {
    if (!this.db.prepare("UPDATE life_share_intents SET revision=revision+1,state='sending',attempt=?,updated=? WHERE id=? AND state='queued' AND (? IS NULL OR revision=?)")
      .run(attempt, this.clock(), id, revision, revision).changes) throw Error('Share is no longer pending');
  }

  settle(id, state, receipt = null) {
    if (!['sent', 'uncertain'].includes(state)) throw Error('Invalid delivery settlement');
    this.db.prepare("UPDATE life_share_intents SET revision=revision+1,state=?,receipt=?,updated=? WHERE id=? AND state='sending'")
      .run(state, receipt ? JSON.stringify(receipt) : null, this.clock(), id);
  }
}

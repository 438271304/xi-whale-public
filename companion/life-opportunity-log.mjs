// Execution metadata only. Content and durable receipts remain in their own stores.
// Registered tool names come from application definitions, never model arguments.
import {isUncertainToolResult} from './tool-feedback.mjs';
const statuses = new Set(['completed','incomplete','failed','cancelled','unknown','ok','saved','recorded','published','uncertain','failed-before-send','conflict','rejected','invalid','skipped','duplicate','unchanged','changed-elsewhere','requires-revision','not-found','unavailable','unconfigured','interrupted','queued','running','blocked','not-applicable','not-completed','unverified-result','recording-failed','reaction-not-saved']);
const finishStatuses = new Set(['finished','completed','failed','interrupted','cancelled','partial','unknown','resting','kept-private-or-quiet','kept-private-after-expression','creative-space-checked','creative-workspace-updated','creative-continuation-saved','partial-progress-saved','life-progress-saved','life-reflection-saved','person-understanding-saved','inner-state-saved','saved-share-deferred','saved','sent','published','uncertain-no-retry','deferred','discarded','not-timely','not-pending-no-send','own-corner-opened','own-corner-read','public-sticker-catalog-read','public-sticker-collected','public-sticker-viewed','corner-published','corner-uncertain','corner-publishing','corner-preparing','corner-failed-before-send']);
const failureCategories = new Set(['generation-failed','delivery-uncertain','local-code-error','budget-blocked','generation-timeout','cancelled','generation-output-limit','provider-rate-limit','provider-request-rejected','provider-unavailable','tool-round-limit','invalid-model-reply','incomplete-model-response','tool-setup-failed','receipt-storage-failed','unknown-failure']);
const phases = new Set(['generation','send','tool-setup','receipt','opportunity']);
const errorTypes = new Set(['AbortError','TimeoutError','TypeError','RangeError','ReferenceError','GenerationError','ResponseProtocolError','Error','OtherError']);
const rejected = new Set(['conflict','rejected','invalid','requires-revision','changed-elsewhere']);
const failed = new Set(['failed','failed-before-send','unavailable','unconfigured','interrupted','cancelled','recording-failed']);
const noChange = new Set(['skipped','duplicate','unchanged','not-found','not-applicable','not-completed','unverified-result']);
const successful = new Set(['ok','saved','recorded','published','completed']);
const creativeWrites = new Set(['own_workroom_create','own_workroom_write','own_workroom_restore','own_workroom_submit','own_workshop_submit','own_workshop_resume','own_workshop_restore_draft']);
const integer = (value, min = 0, max = 1_000_000_000) => Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
const member = (set, value, fallback = null) => typeof value === 'string' && set.has(value) ? value : fallback;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const parse = raw => {try {return object(typeof raw === 'string' ? (raw.length <= 262144 ? JSON.parse(raw) : null) : raw);} catch {return null;}};
const evidence = value => typeof value === 'string' && /^exp-[a-f0-9]{32}$/.test(value);
const opaqueId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$/.test(value);

function safeFailure(value) {
 if (value == null) return null;
 const input = object(value) ?? {};
 return {category:member(failureCategories,input.category,'unknown-failure'),phase:member(phases,input.phase),
  error_type:member(errorTypes,input.error_type,'OtherError'),http_status:integer(input.http_status,100,599),attempt_count:integer(input.attempt_count,0,100)};
}

function toolMetadata(name, raw, invocationOk) {
 const value = parse(raw), returnedStatus = member(statuses,value?.status) ?? member(statuses,value?.state);
 let outcome = invocationOk ? 'returned' : 'failed';
 if(isUncertainToolResult(value,invocationOk))outcome='uncertain';
 else if (invocationOk && value) {
  if (rejected.has(returnedStatus)) outcome = 'rejected';
  else if (value.ok === false || value.saved === false || failed.has(returnedStatus)) outcome = 'failed';
  else if (value.duplicate === true || noChange.has(returnedStatus)) outcome = 'no-change';
  else if (value.ok === true || successful.has(returnedStatus)) outcome = 'reported-success';
 }
 const durable = [];
 // An invocation returning normally is not a durable write. Recognize only
 // actual receipt shapes from known handlers, with negative states taking precedence.
 if (invocationOk && value && !['failed','rejected','uncertain','no-change'].includes(outcome)) {
  if (name === 'save_discovery' && value.saved === true && evidence(value.evidence_id)) {
   durable.push('discovery-saved');
   if (value.reflection?.status === 'saved' && integer(value.reflection.revision,1)) durable.push('self-reflection-saved');
   if (value.journal?.status === 'saved' && value.journal.found === true && integer(value.journal.revision,1)) durable.push('journal-saved');
  }
  if (name === 'reflect_life_state' && returnedStatus === 'saved' && value.source === 'life-self-reflection' && integer(value.revision,1)) durable.push('self-reflection-saved');
  if (name === 'reflect_person_impression' && returnedStatus === 'saved' && value.source === 'person-impressions' && integer(value.revision,1)) durable.push('person-impression-saved');
  if (name === 'write_life_journal' && returnedStatus === 'saved' && value.found === true && integer(value.revision,1)) durable.push('journal-saved');
  if (name === 'update_inner_state' && returnedStatus === 'saved' && value.saved === true && integer(value.revision,1)) durable.push('inner-state-saved');
  if (creativeWrites.has(name) && value.memory?.status === 'recorded' && value.memory.source === 'own-workroom-change' && evidence(value.memory.evidence_id)) durable.push('creative-version-saved');
  // A status read can verify a previously completed job; it does not imply a new execution.
  if (name === 'own_workshop_status' && Array.isArray(value.jobs) && value.jobs.some(job => job?.state === 'completed' && job.memory?.status === 'recorded' && job.memory.source === 'verified-workshop-result' && evidence(job.memory.evidence_id))) durable.push('creative-result-confirmed');
  if (name === 'leave_in_my_corner' && returnedStatus === 'published' && ['home','qzone'].includes(value.channel) && opaqueId(value.post_id)) durable.push('corner-published');
  if (name === 'reconcile_corner' && returnedStatus === 'published' && value.refresh === 'confirmed' && opaqueId(value.post_id)) durable.push('corner-receipt-confirmed');
 }
 return {name,invocation_ok:invocationOk,returned_status:returnedStatus,outcome,durable_kinds:durable};
}

export class LifeOpportunityLog {
 constructor(db,{clock = () => Date.now()} = {}) {
  this.db = db; this.clock = clock;
  db.exec(`CREATE TABLE IF NOT EXISTS life_opportunity_events (
   opportunity TEXT NOT NULL, sequence INTEGER NOT NULL, kind TEXT NOT NULL,
   at INTEGER NOT NULL, elapsed_ms INTEGER NOT NULL, detail TEXT NOT NULL,
   PRIMARY KEY(opportunity,sequence));
   CREATE INDEX IF NOT EXISTS life_opportunity_events_time ON life_opportunity_events(at);`);
 }
 start(id,{maxRounds = null,toolNames = []} = {}) {
  if (!opaqueId(id)) throw Error('A bounded opportunity ID is required');
  if (this.db.prepare('SELECT 1 FROM life_opportunity_events WHERE opportunity=? LIMIT 1').get(id)) return this.read(id);
  const names = [...new Set(Array.isArray(toolNames) ? toolNames.filter(name => typeof name === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(name)).slice(0,160) : [])];
  const now = this.now();
  this.db.prepare('INSERT INTO life_opportunity_events VALUES(?,0,?,?,0,?)').run(id,'start',now,JSON.stringify({max_rounds:integer(maxRounds,1,100),tool_names:names}));
  return this.read(id);
 }
 now() {
  const now = this.clock();
  if (!Number.isSafeInteger(now) || now < 0) throw Error('A valid opportunity clock is required');
  return now;
 }
 append(id,kind,detail) {
  if (!opaqueId(id)) throw Error('A bounded opportunity ID is required');
  if (!this.db.prepare('SELECT 1 FROM life_opportunity_events WHERE opportunity=? LIMIT 1').get(id)) this.start(id);
  if (this.db.prepare("SELECT 1 FROM life_opportunity_events WHERE opportunity=? AND kind='finish' LIMIT 1").get(id)) return false;
  const row = this.db.prepare('SELECT MIN(at) AS started,MAX(sequence) AS sequence FROM life_opportunity_events WHERE opportunity=?').get(id);
  const now = this.now();
  this.db.prepare('INSERT INTO life_opportunity_events VALUES(?,?,?,?,?,?)').run(id,row.sequence+1,kind,now,Math.max(0,now-row.started),JSON.stringify(detail));
  return true;
 }
 recordStep(id,detail = {}) {
  // This counts provider responses. Recovery may generate an extra response
  // within a loop round, and its flag remains true on subsequent loop rounds.
  return this.append(id,'step',{round:integer(detail?.round,1,100),recovery:detail?.recovery === true,
   response_status:member(statuses,detail?.response_status,'unknown'),
   incomplete_reason:member(new Set(['max_output_tokens','content_filter']),detail?.incomplete_reason),
   output_tokens:integer(detail?.output_tokens),tool_count:integer(detail?.tool_count,0,1000)});
 }
 recordTool(id,{name,result,ok} = {}) {
  // Deliberately never access args, even for logging or failure classification.
  const first = this.db.prepare("SELECT detail FROM life_opportunity_events WHERE opportunity=? AND kind='start'").get(id);
  const allowed = first ? parse(first.detail)?.tool_names : [];
  const safeName = Array.isArray(allowed) && allowed.includes(name) ? name : 'unknown_tool';
  return this.append(id,'tool',toolMetadata(safeName,safeName === 'unknown_tool' ? null : result,ok === true));
 }
 finish(id,{status = 'unknown',failure = null} = {}) {
  this.append(id,'finish',{status:member(finishStatuses,status,'unknown'),failure:safeFailure(failure)});
  return this.read(id);
 }
 read(id) {
  if (!opaqueId(id)) return null;
  const rows = this.db.prepare('SELECT sequence,kind,at,elapsed_ms,detail FROM life_opportunity_events WHERE opportunity=? ORDER BY sequence').all(id);
  if (!rows.length) return null;
  const events = rows.map(({detail,...row}) => ({...row,...JSON.parse(detail)}));
  const steps = events.filter(row => row.kind === 'step'), tools = events.filter(row => row.kind === 'tool'), final = events.find(row => row.kind === 'finish');
  return {id,started_at:rows[0].at,updated_at:rows.at(-1).at,finished_at:final?.at ?? null,elapsed_ms:rows.at(-1).elapsed_ms,
   max_rounds:events[0].max_rounds,generation_count:steps.length,tool_count:tools.length,
   tool_failed_count:tools.filter(row => row.outcome === 'failed').length,tool_rejected_count:tools.filter(row => row.outcome === 'rejected').length,
   tool_uncertain_count:tools.filter(row => row.outcome === 'uncertain').length,
   durable_kinds:[...new Set(tools.flatMap(row => row.durable_kinds))],status:final?.status ?? 'running',failure:final?.failure ?? null,
   // Registry contents need not be repeated in callers or model context.
   events:events.filter(row => row.kind !== 'start')};
 }
 context({limit = 3,maxChars = 1600,excludeId = null} = {}) {
  const count = integer(limit,0,6) ?? 3, budget = integer(maxChars,2,20000) ?? 1600;
  const output = {recent_unfinished:[],notice:'Execution metadata only. Saved progress is separate from overall completion; read its original store before continuing. Do not repeat a successful write or uncertain delivery.'};
  const candidates = this.db.prepare(`SELECT opportunity FROM life_opportunity_events
   GROUP BY opportunity ORDER BY MAX(at) DESC,MAX(rowid) DESC LIMIT 60`).all();
  for (const {opportunity} of candidates) {
   if (output.recent_unfinished.length >= count) break;
   if (opportunity === excludeId) continue;
   const row = this.read(opportunity);
   if (row.finished_at !== null && !row.failure && !['failed','interrupted','cancelled','partial','unknown','creative-continuation-saved','partial-progress-saved','life-progress-saved','uncertain-no-retry','corner-uncertain','corner-publishing','corner-preparing','corner-failed-before-send'].includes(row.status)) continue;
   const summary = {id:row.id,at:new Date(row.updated_at).toISOString(),status:row.status,
    generations:row.generation_count,tools:row.tool_count,tool_failures:row.tool_failed_count,tool_rejections:row.tool_rejected_count,
    durable_kinds:row.durable_kinds,failure_category:row.failure?.category ?? null};
   const proposed = {...output,recent_unfinished:[...output.recent_unfinished,summary]};
   if (JSON.stringify(proposed).length <= budget) output.recent_unfinished.push(summary);
   else if (!output.recent_unfinished.length) {
    // Keep one useful row under a small budget before sacrificing all progress.
    const compact = {id:summary.id,at:summary.at,status:summary.status,durable_kinds:summary.durable_kinds,failure_category:summary.failure_category};
    if (JSON.stringify({recent_unfinished:[compact]}).length <= budget) return {recent_unfinished:[compact]};
   }
  }
  if (JSON.stringify(output).length <= budget) return output;
  return JSON.stringify({recent_unfinished:[]}).length <= budget ? {recent_unfinished:[]} : {};
 }
}

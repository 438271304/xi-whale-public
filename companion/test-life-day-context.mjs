import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ExperienceMemory} from './experience-memory.mjs';
import {LifeHeartbeat} from './life-heartbeat.mjs';
import {LifeJournal} from './life-journal.mjs';
import {DayContinuity, DAY_CONTINUITY_PROMPT} from './life-day-context.mjs';

const changes = db => db.prepare('SELECT total_changes() n').get().n;
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
function fixture(t, {persistent = false} = {}) {
  const directory = persistent ? mkdtempSync(join(tmpdir(), 'whale-day-context-')) : null;
  let now = Date.parse('2036-10-16T23:59:00+08:00'), db, store, heartbeat, journal, day, sequence = 0;
  function open() {
    db = new DatabaseSync(directory ? join(directory, 'life.sqlite3') : ':memory:');
    db.exec(`CREATE TABLE IF NOT EXISTS discoveries(id TEXT PRIMARY KEY,activity TEXT,url TEXT,title TEXT,excerpt TEXT,at INTEGER);
      CREATE TABLE IF NOT EXISTS life_reading_evidence(discovery TEXT PRIMARY KEY,activity TEXT,tool TEXT,level TEXT,details TEXT);
      CREATE TABLE IF NOT EXISTS life_progress_attempts(id TEXT PRIMARY KEY,activity TEXT,tool TEXT,request_fingerprint TEXT,status TEXT,reason_category TEXT,continuation TEXT,at INTEGER);`);
    store = new ExperienceMemory({path: directory ? join(directory, 'memory.sqlite3') : ':memory:', clock: () => now});
    heartbeat = new LifeHeartbeat({db, store, clock: () => now}); journal = heartbeat.journal;
    day = new DayContinuity({db, store, journal, clock: () => now});
  }
  open(); t.after(() => {db.close(); store.close();});
  return {get db() {return db;}, get store() {return store;}, get journal() {return journal;}, get day() {return day;}, get now() {return now;},
    at(value) {now = typeof value === 'string' ? Date.parse(value) : value;},
    opportunity(id, state = 'finished') {db.prepare('INSERT INTO life_heartbeats VALUES(?,?,?,?,?,?,?)').run(id, now, state, state === 'thinking' ? null : 'explore', 'Synthetic choice', null, null);},
    source(id = 'discovery-' + (++sequence), at = now) {db.prepare('INSERT INTO discoveries VALUES(?,?,?,?,?,?)').run(id, 'activity-' + id, 'https://example.org/public', 'Synthetic public source', 'SOURCE_BODY_MUST_NOT_ENTER_DAY_CONTEXT', at);
      db.prepare('INSERT INTO life_reading_evidence VALUES(?,?,?,?,?)').run(id, 'activity-' + id, 'public_fetch', 'page-text', '{}'); return id;},
    attempt(id, status = 'failed', at = now) {db.prepare('INSERT INTO life_progress_attempts VALUES(?,?,?,?,?,?,?,?)').run(id, 'activity-' + id, 'public_fetch', 'synthetic-hash', status, status === 'ok' ? null : 'reader-unavailable', '{}', at);},
    evidence(event = 'source-' + (++sequence)) {return store.recordMessage({scope: 'unknown', event, role: 'self', text: 'SOURCE_BODY_MUST_NOT_ENTER_DAY_CONTEXT', at: now, source: 'public-exploration'});},
    diary(evidence, feeling = '昨天的潮汐问题还让我惦记。') {return journal.record({kind: 'activity', evidence_ids: [evidence.id], interpretation: {feeling}});},
    work(id, {verified = false, own = true, at = now} = {}) {return store.recordMessage({scope: verified ? 'private:910710001' : 'unknown', event: (verified ? 'own-workshop-result:' : 'own-workroom-change:') + id, role: 'self', at,
      source: verified ? 'verified-workshop-result' : 'own-workroom-change', text: JSON.stringify({title: 'A paper animation', action: 'workshop_submit', state: verified ? 'completed' : 'queued', execution_verified: verified, private_brief: 'PRIVATE_BRIEF_MUST_NOT_ENTER_CONTEXT', files: ['INTERNAL_FILE_LIST']}),
      metadata: {source_event: own ? 'life:own-opportunity' : 'human-request', project_id: 'project-' + id, version: 2, execution_verified: verified}});},
    post(id, state = 'published', at = now) {db.prepare('INSERT INTO life_corner_posts VALUES(?,?,?,?,?,?,?,?)').run(id, 'journal-reference-' + id, 1, state === 'published' ? 'Explicitly published own text.' : 'UNCONFIRMED_DRAFT_MUST_NOT_ENTER_CONTEXT', at, 'home', state, '{}');},
    restart() {assert.ok(directory); db.close(); store.close(); open();},
  };
}

test('Beijing midnight changes diary day while 07:00 does not invent waking or replace the previous opportunity with the current one', t => {
  const f = fixture(t); f.at('2036-10-16T23:58:00+08:00'); f.opportunity('last-night');
  f.at('2036-10-16T23:59:00+08:00'); const evidence = f.evidence(), journal = f.diary(evidence); f.source();
  f.at('2036-10-17T00:00:00+08:00'); let view = f.day.context();
  assert.equal(view.beijing_date, '2036-10-17'); assert.equal(view.yesterday_date, '2036-10-16');
  assert.equal(view.beijing_hour, 0); assert.equal(view.days.today.journals.records.length, 0);
  assert.equal(view.days.yesterday.journals.records[0].id, journal.id); assert.equal(view.crossed_day_since_last_opportunity, true);
  f.at('2036-10-17T07:00:00+08:00'); f.opportunity('now-starting', 'thinking'); view = f.day.context();
  assert.equal(view.beijing_hour, 7); assert.equal(view.last_opportunity.id, 'last-night');
  assert.equal(view.last_opportunity.elapsed_seconds, 25320); assert.equal(view.current_started_opportunity.id, 'now-starting');
  assert.equal(view.current_started_opportunity.elapsed_seconds, 0); assert.equal(view.last_recorded_action.elapsed_seconds, 25260);
  assert.equal(view.last_opportunity.time_basis, 'opportunity-started-at'); assert.equal(view.days.today.journals.records.length, 0);
  assert.match(DAY_CONTINUITY_PROMPT, /不是睡醒证明/); assert.match(view.notice, /不扣心情或关系分/);
});

test('old diary and unfinished thought remain discoverable across blank days without daily backfill or full chat bodies', t => {
  const f = fixture(t); f.at('2036-10-07T20:00:00+08:00'); f.opportunity('old');
  const evidence = f.evidence(), journal = f.diary(evidence);
  f.store.setState({kind: 'unfinished', key: 'reflection:tides', value: {active: true, interpretation: 'Compare two specific tide observations.'}, evidence: [{type: 'message', id: evidence.id}], at: f.now, source: 'activity-reflection'});
  f.at('2036-10-17T07:00:00+08:00'); const view = f.day.context();
  assert.equal(view.latest_journal_day, '2036-10-07'); assert.equal(view.latest_recorded_day, '2036-10-07');
  assert.equal(view.days.today.journals.records.length, 0); assert.equal(view.days.yesterday.journals.records.length, 0);
  assert.deepEqual(view.days.earlier_recorded_days.map(row => row.day), ['2036-10-07']);
  assert.equal(view.days.earlier_recorded_days[0].journals.records[0].id, journal.id);
  assert.equal(view.unfinished.records[0].key, 'reflection:tides'); assert.equal(view.unfinished.records[0].revision, 1);
  assert.equal(view.coverage.gap_activity_known, false); assert.doesNotMatch(JSON.stringify(view), /SOURCE_BODY_MUST_NOT_ENTER_DAY_CONTEXT/);
  assert.equal(f.store.counts().state_versions, 2);
});

test('future and unknown timestamps cannot become last real activity, an elapsed gap or a current diary', t => {
  const f = fixture(t); f.at('2036-10-16T12:00:00+08:00'); f.opportunity('valid'); f.source('valid-source');
  const evidence = f.evidence(), validJournal = f.diary(evidence);
  const cutoff = Date.parse('2036-10-17T07:00:00+08:00'); f.at(cutoff + 3600000);
  f.opportunity('future'); f.source('future-source'); f.attempt('future-attempt'); f.work('future'); f.post('future-post'); f.diary(f.evidence(), 'Future record must be excluded.');
  f.source('unknown-source', 'unknown'); f.attempt('unknown-attempt', 'failed', 'unknown');
  f.at(cutoff); const view = f.day.context();
  assert.equal(view.last_opportunity.id, 'valid'); assert.ok(view.last_recorded_action.at <= cutoff);
  assert.equal(view.latest_journal_day, '2036-10-16'); assert.equal(view.days.yesterday.journals.records[0].id, validJournal.id);
  assert.equal(view.days.today.own_work.records.length, 0); assert.equal(view.days.today.corner_records.records.length, 0);
  assert.doesNotMatch(JSON.stringify(view), /future-source|unknown-source|future-attempt|unknown-attempt|Future record must/);
  f.at(NaN); assert.throws(() => f.day.context(), /Invalid day continuity clock/);
});

test('restart preserves real source references and marks an interrupted opportunity honestly', t => {
  const f = fixture(t, {persistent: true}); f.opportunity('last-running', 'thinking');
  const journal = f.diary(f.evidence()); const source = f.source();
  f.at('2036-10-17T07:00:00+08:00'); f.restart(); const view = f.day.context();
  assert.equal(view.last_opportunity.id, 'last-running'); assert.equal(view.last_opportunity.state, 'interrupted');
  assert.equal(view.current_started_opportunity, null);
  assert.equal(view.days.yesterday.journals.records[0].id, journal.id);
  assert.equal(view.days.yesterday.exploration_sources.records[0].id, source);
  f.restart(); assert.deepEqual(f.day.context(), view);
});

test('own creative changes, completed receipts and corner states retain their actual evidence limits', t => {
  const f = fixture(t); const queued = f.work('queued'), completed = f.work('completed', {verified: true}); f.work('human-work', {verified: true, own: false});
  f.post('published'); f.post('uncertain', 'uncertain'); const view = f.day.context();
  const work = view.days.today.own_work.records;
  assert.equal(work.length, 2); assert.equal(work.find(row => row.id === queued.id).execution_verified, false);
  assert.equal(work.find(row => row.id === completed.id).execution_verified, true);
  const posts = view.days.today.corner_records.records;
  assert.equal(posts.find(row => row.id === 'published').published_confirmed, true);
  assert.equal(posts.find(row => row.id === 'uncertain').published_confirmed, false);
  assert.equal(posts.find(row => row.id === 'uncertain').public_text_excerpt, null);
  assert.ok(posts.every(row => row.time_basis === 'publication-record-created-at'));
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE_BRIEF|INTERNAL_FILE_LIST|UNCONFIRMED_DRAFT/);
});

test('a revised yesterday diary keeps its day and source version while its actual revision time belongs to today', t => {
  const f = fixture(t), evidence = f.evidence(), journal = f.diary(evidence);
  f.at('2036-10-17T07:00:00+08:00');
  const revised = f.journal.revise({id: journal.id, expected_revision: 1, reason: 'Correct my earlier interpretation.', interpretation: {association: 'A smaller question is still worth trying.'}});
  const view = f.day.context(), card = view.days.yesterday.journals.records[0];
  assert.equal(card.id, journal.id); assert.equal(card.revision, revised.revision); assert.equal(card.day, '2036-10-16');
  assert.equal(card.recorded_at, f.now); assert.equal(card.evidence[0].revision, evidence.revision);
  assert.equal(view.last_recorded_action.kind, 'journal-recorded'); assert.equal(view.last_recorded_action.elapsed_seconds, 0);
  assert.equal(view.days.today.journals.records.length, 0, 'A revised old entry is not a newly invented daily review');
});

test('constructor and repeated contexts create no tables or writes and expose bounded samples', t => {
  const f = fixture(t);
  for (let i = 0; i < 5; i++) {f.source(); f.attempt('attempt-' + i); f.diary(f.evidence(), 'A short real interpretation ' + i);}
  const before = {life: changes(f.db), memory: changes(f.store.db), lifeTables: tables(f.db), memoryTables: tables(f.store.db)};
  const reader = new DayContinuity({db: f.db, store: f.store, journal: f.journal, clock: () => f.now});
  const view = reader.context(); assert.deepEqual(reader.context(), view);
  for (const key of ['journals','exploration_sources','exploration_attempts']) {assert.equal(view.days.today[key].records.length, 3); assert.equal(view.days.today[key].more_records, true);}
  assert.deepEqual({life: changes(f.db), memory: changes(f.store.db), lifeTables: tables(f.db), memoryTables: tables(f.store.db)}, before);
  assert.ok(JSON.stringify(view).length < 16000, 'A small day view must not flood the model with whole histories');
});

test('missing optional life tables remain unknown without creating a database schema or invented day records', t => {
  const db = new DatabaseSync(':memory:'), store = new ExperienceMemory({path: ':memory:'}), journal = new LifeJournal({store});
  t.after(() => {db.close(); store.close();});
  const before = [changes(db), changes(store.db)], reader = new DayContinuity({db, store, journal, clock: () => Date.parse('2036-10-17T07:00:00+08:00')});
  const view = reader.context(); assert.equal(view.last_opportunity, null); assert.equal(view.last_recorded_action, null);
  assert.equal(view.latest_journal_day, null); assert.equal(view.coverage.heartbeat_store_available, false);
  assert.equal(view.coverage.stores_available.sources, false); assert.deepEqual(tables(db), []);
  assert.deepEqual([changes(db), changes(store.db)], before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {LifeContinuity} from './life-continuity.mjs';
import {ExplorationFollowups} from './exploration-followups.mjs';
import {LifeProgress, LIFE_PROGRESS_PROMPT} from './life-progress.mjs';

// Real SQLite and saved-source schema; no provider, QQ, network or production DB.
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE activities(id TEXT PRIMARY KEY,topic TEXT,motivation TEXT,state TEXT,summary TEXT,created INTEGER,updated INTEGER);
    CREATE TABLE discoveries(id TEXT PRIMARY KEY,activity TEXT,url TEXT,title TEXT,excerpt TEXT,at INTEGER);`);
  let now = 1000, sequence = 0;
  const continuity = new LifeContinuity(db, {clock: () => now});
  new ExplorationFollowups(db, {clock: () => now});
  const progress = new LifeProgress(db, {clock: () => now});
  const activity = (id, {state = 'unfinished', topic = 'A public curiosity', basis} = {}) => {
    now++;
    db.prepare('INSERT INTO activities VALUES(?,?,?,?,?,?,?)').run(id, topic, '', state, '', now, now);
    if (basis) db.prepare('INSERT INTO life_intentions VALUES(?,?,?,?)').run(id, JSON.stringify(basis), 'A synthetic interest', now);
    return id;
  };
  const source = (activity, {tool = 'public_fetch', url = 'https://example.org/article', text = 'A distinct saved paragraph.', result = {}, level} = {}) => {
    const id = 'source-' + (++sequence);
    db.prepare('INSERT INTO discoveries VALUES(?,?,?,?,?,?)').run(id, activity, url, 'A public source', text, ++now);
    continuity.recordReading(id, activity, tool, result);
    if (level) db.prepare('UPDATE life_reading_evidence SET level=? WHERE discovery=?').run(level, id);
    return id;
  };
  return {db, progress, activity, source, continuity};
}

test('reading summaries are read-only, bounded descriptions and never personality decisions', t => {
  const f = fixture(t), a = f.activity('first'); f.source(a);
  const before = f.db.prepare('SELECT total_changes() n').get().n;
  const summary = f.progress.inspect(a), context = f.progress.context();
  assert.equal(summary.progress, 'different-saved-material');
  assert.equal(summary.counts['new-material'], 1);
  assert.equal(context.coverage.older_activities_omitted, false);
  assert.deepEqual(summary.choices.map(x => x.choice), ['continue','change-angle','pause-or-new-curiosity']);
  assert.match(context.coverage.meaning, /not lifetime novelty/);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n, before);
  assert.match(LIFE_PROGRESS_PROMPT, /不替你判断喜不喜欢/);
});

test('same material survives whitespace changes, mirrors and tracking links with exact source references', t => {
  const f = fixture(t), first = f.activity('first');
  const id = f.source(first, {text: 'Same     material\nfrom a source.'});
  const next = f.activity('next'); f.source(next, {url: 'https://example.org/mirror?utm_source=new', text: 'Same material from a source.'});
  const result = f.progress.inspect(next);
  assert.equal(result.counts['same-material'], 1);
  assert.equal(result.progress, 'repeated-or-overlapping-material');
  assert.equal(result.sources[0].compared_with.discovery, id);
  assert.equal(result.sources[0].compared_with.activity, first);
  assert.equal(result.unfinished, true);
});

test('substantially different text at the same URL and a later page are real saved material differences', t => {
  const f = fixture(t); f.source(f.activity('one'), {text: 'The moon changes tidal timing.'});
  f.source(f.activity('two'), {text: 'A coastline redirects waves near the harbour.', result: {next_offset: 12000}});
  const result = f.progress.inspect('two');
  assert.equal(result.counts['new-material'], 1);
  assert.equal(result.sources[0].continuation.next_offset, 12000);
  assert.match(result.choices[0].basis, /unread position/);
  f.source(f.activity('three'), {text: 'Later paragraphs discuss a separate measurement.', result: {next_offset: null}});
  assert.equal(f.progress.inspect('three').counts['new-material'], 1);
});

test('long excerpt cutoff drift or a shifted overlapping passage is not promoted to a new finding', t => {
  const f = fixture(t), body = Array.from({length: 80}, (_, i) => 'Distinct sentence number ' + i + '.').join(' ');
  f.source(f.activity('one'), {text: body.slice(0, 1800)});
  f.source(f.activity('two'), {text: body.slice(20, 1820)});
  f.source(f.activity('three'), {text: body.slice(0, 1825)});
  assert.equal(f.progress.inspect('two').counts['overlapping-material'], 1);
  assert.equal(f.progress.inspect('three').counts['overlapping-material'], 1);
});

test('search leads and metadata stay limited; actual new reading scope is named honestly', t => {
  const f = fixture(t); f.source(f.activity('search'), {tool: 'public_search', text: 'A lead paragraph.'});
  assert.equal(f.progress.inspect('search').counts['new-lead'], 1);
  assert.equal(f.progress.inspect('search').progress, 'limited-source-evidence');
  f.source(f.activity('read'), {text: 'A lead paragraph.'});
  assert.equal(f.progress.inspect('read').counts['new-reading-scope'], 1);
  const url = 'https://www.bilibili.com/video/BVsynthetic/?p=1';
  f.source(f.activity('metadata'), {url, tool: 'bilibili_read', text: JSON.stringify({author: 'Public author', description: 'Video description', content: {metadata_read: true}})});
  assert.equal(f.progress.inspect('metadata').counts['new-metadata'], 1);
  const content = {subtitle_read: true, subtitle: [{from: 0, to: 5, text: 'An actual caption'}]};
  f.source(f.activity('caption'), {url, tool: 'bilibili_read', text: JSON.stringify({content}), result: {content}});
  const result = f.progress.inspect('caption');
  assert.equal(result.counts['new-reading-scope'], 1);
  assert.equal(result.sources[0].level, 'subtitles');
  assert.equal(result.sources[0].scope.whole_video_watched, false);
});

test('video retrieval times, transient limitations and ASR evidence metadata are not new content', t => {
  const f = fixture(t), transcript = {segments: [{state: 'transcribed', start_ms: 0, end_ms: 5000, text: 'Actual transcribed speech'}], evidence: {model_id: 'local', coverage: [[0, 5]], unprocessed_ranges: [[5, 100]]}};
  const add = (id, retrieved_at) => f.source(f.activity(id), {tool: 'bilibili_listen', text: JSON.stringify({author: 'Public author', transcript: {...transcript, retrieved_at}, limitations: [retrieved_at]}), result: {content: {speech_transcript: transcript}}});
  add('one', 'yesterday'); add('two', 'today');
  const result = f.progress.inspect('two');
  assert.equal(result.counts['same-material'], 1);
  assert.equal(result.sources[0].level, 'speech-transcript');
  assert.equal(result.sources[0].continuation.transcript_unprocessed, true);
  assert.equal(result.sources[0].scope.audio_understood, false);
  assert.deepEqual(result.sources[0].scope.speech_coverage, [[0, 5]]);
});

test('truncated structured video excerpt or missing reading evidence remains unverified', t => {
  const f = fixture(t);
  f.source(f.activity('cut'), {tool: 'bilibili_read', text: '{"content":{"subtitle_read":true,"subtitle":[', result: {content: {subtitle_read: true}}});
  assert.equal(f.progress.inspect('cut').counts['unverified-material'], 1);
  const a = f.activity('missing'), id = f.source(a);
  f.db.prepare('DELETE FROM life_reading_evidence WHERE discovery=?').run(id);
  assert.equal(f.progress.inspect(a).counts['unverified-material'], 1);
});

test('access failure and repeated attempts persist across restart without secrets or dislike inference', t => {
  const f = fixture(t), args = {url: 'https://example.org/article?token=DO_NOT_PERSIST_REQUEST'};
  const record = activity => f.progress.recordAttempt(activity, {tool: 'public_fetch', args, result: {status: 'failed', reason: '403 response containing DO_NOT_PERSIST_ERROR', sources: []}});
  record(f.activity('one')); record(f.activity('two'));
  const restarted = new LifeProgress(f.db), result = restarted.inspect('two');
  assert.equal(result.progress, 'source-unavailable');
  assert.equal(result.unavailable_attempts, 1);
  assert.equal(result.repeated_requests, 1);
  assert.equal(result.attempts[0].repeated_request_of.activity, 'one');
  assert.equal(result.attempts[0].reason_category, 'access-unavailable');
  assert.match(result.choices[1].basis, /nothing about liking/);
  assert.ok(result.choices.some(x => x.choice === 'continue'));
  assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM life_progress_attempts').all()), /DO_NOT_PERSIST/);
  assert.equal(f.db.prepare('SELECT state FROM activities WHERE id=?').get('two').state, 'unfinished');
});

test('empty and partial responses preserve unread positions without claiming source progress', t => {
  const f = fixture(t), a = f.activity('one');
  f.progress.recordAttempt(a, {tool: 'tieba_read', args: {thread_id: '1', page: 1}, result: {status: 'partial', sources: [], read_scope: {next_page: 2}}});
  const result = f.progress.inspect(a);
  assert.equal(result.counts['new-material'], 0);
  assert.equal(result.progress, 'no-saved-reading');
  assert.equal(result.attempts[0].continuation.next_page, 2);
  assert.equal(result.unfinished, true);
});

test('corrected original evidence changes comparisons on the next read without derived history rewrites', t => {
  const f = fixture(t), first = f.source(f.activity('one'), {text: 'The original material.'});
  f.source(f.activity('two'), {text: 'The original material.'});
  assert.equal(f.progress.inspect('two').counts['same-material'], 1);
  f.db.prepare('UPDATE discoveries SET excerpt=? WHERE id=?').run('A corrected different observation.', first);
  const before = f.db.prepare('SELECT total_changes() n').get().n;
  assert.equal(f.progress.inspect('two').counts['new-material'], 1);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n, before);
});

test('completed partial follow-up remains an unfinished question while quiet rest is not an unfinished job', t => {
  const f = fixture(t), a = f.activity('one', {state: 'completed'}); f.source(a);
  f.db.prepare('INSERT INTO exploration_followups VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('followup','dedupe','topic','question','group:12345','1','12345','completed',a,JSON.stringify({outcome: 'partial'}),1,2);
  assert.equal(f.progress.inspect(a).unfinished, true);
  f.activity('rest', {state: 'quiet', topic: null});
  assert.equal(f.progress.inspect('rest').unfinished, false);
});

test('first entry reads a bounded recent window, exposes omissions and links exact interest provenance', t => {
  const f = fixture(t), basis = {source_state: {kind: 'interest', key: 'reflection:ocean', revision: 2}};
  for (let i = 0; i < 30; i++) f.source(f.activity('old-' + i), {text: 'Old archived content ' + i});
  const a = f.activity('current', {basis});
  for (let i = 0; i < 42; i++) f.source(a, {text: 'Current observation ' + i});
  const before = f.db.prepare('SELECT total_changes() n').get().n;
  const result = f.progress.context({candidates: [{kind: 'interest', key: 'reflection:ocean', revision: 3}]});
  assert.equal(result.coverage.inspected_activities, 12);
  assert.equal(result.coverage.older_activities_omitted, true);
  assert.equal(result.recent.length, 8);
  assert.equal(result.recent[0].coverage.inspected_sources, 40);
  assert.equal(result.recent[0].coverage.sources_omitted, true);
  assert.equal(result.recent[0].sources.length, 4);
  assert.deepEqual(result.related_interests[0].activities, ['current']);
  assert.equal(result.recent[0].source_state.revision, 2);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n, before);
  assert.equal(f.db.prepare('SELECT count(*) n FROM life_progress_attempts').get().n, 0);
});

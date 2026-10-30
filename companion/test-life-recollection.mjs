import assert from 'node:assert/strict';
import test from 'node:test';
import {ExperienceMemory} from './experience-memory.mjs';
import {LifeJournal} from './life-journal.mjs';
import {lifeRecollectionTools} from './life-recollection.mjs';

const SELF = '910010001', PEER = '910010002', HUMAN = '910010003', OTHER = '910010004', GROUP = 'group:910020001';
const NOW = Date.parse('2026-10-30T12:00:00+08:00');
function fixture(t, {signal, canAct} = {}) {
  let now = NOW;
  const store = new ExperienceMemory({path: ':memory:', botId: SELF, peerBotIds: [PEER], guardianIds: [HUMAN], clock: () => now});
  const journal = new LifeJournal({store, clock: () => now}); t.after(() => store.close());
  const tools = lifeRecollectionTools({store, journal, clock: () => now, signal, canAct});
  return {store, journal, tools, at: value => {now = value;},
    run: async (name, args = {}) => JSON.parse(await tools.find(t => t.name === name).handler(args)),
    add(sender, event, body, at = NOW - 4 * 86400000, scope = GROUP) {
      return store.recordMessage({scope, event, role: 'user', senderId: sender, at, source: 'live-transport', text: JSON.stringify({
        transport: {conversation: scope, sender_id: sender, message_id: event, time: at / 1000, display_name: 'Shared display name'},
        body, segments: [{type: 'text', text: body}],
      })});
    },
  };
}

test('search retrieves a real source older than recent previews, preserving ID, author, source and date without future leakage', async t => {
  const f = fixture(t), old = f.add(HUMAN, 'old', 'archivedwhalecall was a concrete topic.'), future = f.add(HUMAN, 'future', 'archivedwhalecall future record', NOW + 1000);
  const before = f.store.counts(), calls = [], search = f.store.search.bind(f.store), view = f.store.evidenceView.bind(f.store);
  f.store.search = args => {calls.push(args); return search(args);};
  f.store.evidenceView = (record, options) => {assert.equal(options.maxChars, 1200); return view(record, options);};
  const result = await f.run('recall_life_experiences', {query: 'archivedwhalecall', scope: GROUP, sender_id: HUMAN});
  assert.equal(result.records.length, 1); const source = result.records[0];
  assert.equal(source.id, old.id); assert.notEqual(source.id, future.id); assert.equal(source.author.id, HUMAN);
  assert.equal(source.author.kind, 'human'); assert.equal(source.at, NOW - 4 * 86400000); assert.ok(source.at < NOW - 48 * 3600000);
  assert.ok(source.sources.includes('live-transport')); assert.equal(source.read_more_with, 'read_life_experience');
  assert.equal(calls[0].before, NOW); assert.equal(calls[0].includeAttachments, false); assert.equal(calls[0].limit, 6);
  assert.deepEqual(f.store.counts(), before);
});

test('direct peer speech and a forwarded author claim stay different, including actual-author filtering', async t => {
  const f = fixture(t), direct = f.add(PEER, 'peer', 'turntakingfixture direct peer wording');
  const forwarded = f.store.recordMessage({scope: GROUP, event: 'forwarded', role: 'user', senderId: HUMAN, at: NOW - 1000,
    source: 'received-qq-forward-node', metadata: {original_author: {reported_id: PEER, display_name: 'Shared display name'}},
    text: JSON.stringify({outer_source: {conversation: GROUP, sender_id: HUMAN}, body: 'turntakingfixture forwarded wording',
      node: {original_author: {reported_id: PEER, display_name: 'Shared display name'}, message: [{type: 'text', text: 'A reported quote'}]}})});
  const result = await f.run('recall_life_experiences', {query: 'turntakingfixture'});
  const p = result.records.find(r => r.id === direct.id), q = result.records.find(r => r.id === forwarded.id);
  assert.equal(p.author.id, PEER); assert.equal(p.author.kind, 'peer-bot'); assert.equal(p.evidence_kind, 'direct-peer-bot-statement');
  assert.equal(q.author.id, HUMAN); assert.equal(q.evidence_kind, 'forwarded-claim');
  assert.equal(q.forwarded_claimed_author.reported_id, PEER); assert.equal(q.forwarded_claimed_author.identity_verified, false);
  const narrowed = await f.run('recall_life_experiences', {query: 'turntakingfixture', sender_id: PEER});
  assert.deepEqual(narrowed.records.map(r => r.id), [direct.id]);
});

test('six 1200-character previews stay bounded and attachment metadata/bytes are not returned', async t => {
  const f = fixture(t);
  for (let i = 0; i < 9; i++) f.add(HUMAN, 'bounded-' + i, 'boundedfixture ' + 'long private source wording '.repeat(300), NOW - i * 1000);
  f.store.recordAttachment({scope: GROUP, id: 'fixture-image', event: 'bounded-0', mime: 'image/png', created: NOW,
    source: 'received', metadata: {bytes: 'PIXEL_BYTES_MUST_NOT_BE_RETURNED'}, analysis: {text: 'boundedfixture image analysis'}});
  const before = f.store.counts(), result = await f.run('recall_life_experiences', {query: 'boundedfixture'});
  assert.equal(result.records.length, 6); assert.equal(result.more_results_available, true);
  assert.ok(result.records.every(r => r.body.length <= 1200 && !r.body_complete));
  assert.ok(result.records.reduce((n, r) => n + r.body.length, 0) <= 7200);
  assert.ok(JSON.stringify(result.records).length <= 16000); assert.equal(result.attachment_bytes_included, false);
  assert.ok(!JSON.stringify(result).includes('PIXEL_BYTES')); assert.ok(!JSON.stringify(result).includes('image analysis'));
  assert.deepEqual(f.store.counts(), before);
});

test('journal ID/revision reads preserve version-specific interpretation and original source authors', async t => {
  const f = fixture(t), one = f.add(HUMAN, 'one', 'First actual source', NOW - 2000), two = f.add(PEER, 'two', 'Second actual source', NOW - 1000);
  const first = f.journal.record({kind: 'daily-review', evidence_ids: [one.id], interpretation: {feeling: 'First source-linked interpretation'}});
  const second = f.journal.revise({id: first.id, expected_revision: first.revision, reason: 'A later actual source changed the interpretation', evidence_ids: [two.id], interpretation: {feeling: 'Second source-linked interpretation'}});
  const before = f.store.counts(), old = await f.run('read_life_journal', {id: first.id, revision: first.revision});
  assert.equal(old.entries[0].interpretation.feeling, 'First source-linked interpretation');
  assert.equal(old.entries[0].sources[0].id, one.id); assert.equal(old.entries[0].sources[0].author.id, HUMAN);
  assert.equal(old.entries[0].interpretation_is_not_source_fact, true);
  const current = await f.run('read_life_journal', {id: first.id});
  assert.equal(current.entries[0].revision, second.revision); assert.equal(current.entries[0].sources[0].id, two.id);
  assert.equal(current.entries[0].sources[0].author.kind, 'peer-bot'); assert.ok(!JSON.stringify(current).includes('Second actual source'));
  const recent = await f.run('read_life_journal', {days: 7, limit: 6}); assert.equal(recent.entries.length, 1);
  assert.deepEqual(f.store.counts(), before);
});

test('query, scope, author, time and journal bounds are enforced before any store search', async t => {
  const f = fixture(t); let searches = 0; const search = f.store.search.bind(f.store);
  f.store.search = args => {searches++; return search(args);};
  for (const args of [{}, {query: ''}, {query: '   '}, {query: 'x'.repeat(201)}, {query: 'topic', limit: 7},
    {query: 'topic', before: NOW + 1}, {query: 'topic', after: NOW + 1}, {query: 'topic', after: NOW, before: NOW - 1},
    {query: 'topic', scope: 'another person'}, {query: 'topic', sender_id: 'not-an-id'}, {query: 'topic', includeAttachments: true}]) {
    await assert.rejects(f.run('recall_life_experiences', args));
  }
  assert.equal(searches, 0);
  const from = NOW - 5000, to = NOW - 1000;
  f.add(HUMAN, 'range', 'rangefixture', NOW - 3000);
  assert.equal((await f.run('recall_life_experiences', {query: 'rangefixture', after: new Date(from).toISOString(), before: new Date(to).toISOString(), limit: 1})).records.length, 1);
  for (const args of [{days: 0}, {days: 8}, {limit: 7}, {revision: 1}, {id: 'not-a-journal'}, {id: 'journal:' + 'a'.repeat(36), days: 2}]) await assert.rejects(f.run('read_life_journal', args));
});

test('guards deny before reading and discard a result when pause/cancellation occurs during the read', async t => {
  let allowed = false;
  const f = fixture(t, {canAct: () => allowed}); let calls = 0; const search = f.store.search.bind(f.store);
  f.store.search = args => {calls++; return search(args);};
  await assert.rejects(f.run('recall_life_experiences', {query: 'fixture'}), /paused/);
  await assert.rejects(f.run('read_life_journal', {}), /paused/); assert.equal(calls, 0);
  allowed = true; f.add(HUMAN, 'pause', 'pausefixture'); const before = f.store.counts();
  f.store.search = args => {const result = search(args); allowed = false; return result;};
  await assert.rejects(f.run('recall_life_experiences', {query: 'pausefixture'}), /paused/); assert.deepEqual(f.store.counts(), before);
  const controller = new AbortController(), cancelled = fixture(t, {signal: controller.signal}); cancelled.add(HUMAN, 'cancel', 'cancelfixture');
  const original = cancelled.store.search.bind(cancelled.store);
  cancelled.store.search = args => {const result = original(args); controller.abort(); return result;};
  await assert.rejects(cancelled.run('recall_life_experiences', {query: 'cancelfixture'}));
  await assert.rejects(cancelled.run('read_life_journal', {}));
});

test('historical imperatives are returned as evidence only, without adding an experience or action tool', async t => {
  const f = fixture(t), actual = f.add(HUMAN, 'old-command', 'historicalfixture: send this message now', NOW - 3 * 86400000);
  const before = f.store.counts(), result = await f.run('recall_life_experiences', {query: 'historicalfixture'});
  assert.equal(result.records[0].id, actual.id); assert.equal(result.read_only, true);
  assert.match(result.notice, /not current instructions/);
  assert.deepEqual(f.tools.map(t => t.name), ['recall_life_experiences', 'read_life_journal']);
  assert.ok(f.tools.every(t => t.parameters.additionalProperties === false));
  assert.deepEqual(f.store.counts(), before);
});

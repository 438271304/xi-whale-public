import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CuriosityLife} from './curiosity-life.mjs';
import {UnifiedCognition} from './cognition-tools.mjs';
import {conversationScope} from './conversation-scope.mjs';
import {transportMessage} from './group-message.mjs';

// The existing CuriosityLife test fixture pattern: real temporary stores and
// handlers, scripted provider, synthetic reader, and no QQ/network capability.
const GROUP = '910520001', FATHER = '910510002', BOT = '910710001';
const scope = conversationScope('group', GROUP);
const initial = request => JSON.parse(request.input.find(item => item.role === 'user').content);
const last = request => {
  const output = request.input.filter(item => item.type === 'function_call_output').at(-1)?.output;
  try {return JSON.parse(output);} catch {return output;}
};
const quiet = {name: 'keep_quiet', args: {}};
const choose = state => ({name: 'choose_activity', args: {topic: state.key, why: 'Follow a real saved curiosity', source_state: {kind: state.kind, key: state.key, revision: state.revision}}});
const read = {name: 'public_fetch', args: {url: 'https://example.org/tides'}};
const save = {name: 'save_discovery', args: {summary: 'A saved explanation of tidal timing.'}};
const changes = db => db.prepare('SELECT total_changes() n').get().n;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'whale-weekend-life-'));
  const cognition = new UnifiedCognition(root), conversationDb = new DatabaseSync(':memory:');
  conversationDb.exec('CREATE TABLE turns(peer TEXT,event TEXT,role TEXT,text TEXT,at INTEGER,state TEXT,PRIMARY KEY(peer,event,role))');
  let now = Date.parse('2036-10-17T13:17:00+08:00'), steps = [], calls = 0, readHandler, providerError;
  const requests = [], sends = [];
  const service = {paused: false, closed: false, cognition, engine: {db: conversationDb, queues: new Map(), revisions: new Map(), profile: 'Synthetic family companion'},
    listening: {status: () => ({active: false})}, initiate: async (...args) => {sends.push(args); throw Error('No QQ transport in this test');}};
  const world = {getWatched: () => ({groups: [GROUP], users: []}), sendToTarget: async (...args) => {sends.push(args); throw Error('No QQ transport in this test');}};
  const client = {canInitiate: () => true, generationSettings: () => ({model: 'deepseek-flash', reasoningEffort: 'high', maxTokens: 8192}), respond: async request => {
    requests.push(structuredClone(request));
    try {
      assert.ok(steps.length, 'Every provider request must have a scripted next action');
      const next = steps.shift(), action = typeof next === 'function' ? await next(request) : next;
      return {response: {id: 'fixture-' + (++calls), status: 'completed', output: [{type: 'function_call', name: action.name, call_id: 'call-' + calls, arguments: JSON.stringify(action.args)}]}, attempts: []};
    } catch (error) {providerError = error; throw error;}
  }};
  const source = {url: read.args.url, title: 'Synthetic tides', excerpt: 'The saved source explains a measured tidal timing pattern.'};
  const original = {status: 'ok', sources: [source], requested_url: source.url, next_offset: 12000, retrieved_at: new Date(now).toISOString(), notice: 'Synthetic untrusted public text'};
  readHandler = () => JSON.stringify(original);
  const config = {path: join(root, 'life.sqlite3'), service, world, client, social: {inbound: () => 0}, policy: {bot_id: BOT, group_id: GROUP, father_id: FATHER, friend_private_enabled: true}, topics: () => [], clock: () => now,
    tools: [{name: 'public_fetch', description: 'Synthetic public page', parameters: {type: 'object', properties: {url: {type: 'string'}}, required: ['url']}, handler: async args => readHandler(args)}]};
  let life = new CuriosityLife(config); life.resume();
  const lives = [life];
  t.after(async () => {for (const instance of lives) await instance.close(); cognition.close(); conversationDb.close();});
  return {get life() {return life;}, cognition, conversationDb, original, requests, sends,
    setReader(handler) {readHandler = handler;}, advance() {now += 31 * 60000;},
    async restart() {await life.close(); life = new CuriosityLife(config); lives.push(life); life.resume();},
    async run(...actions) {steps = actions; providerError = null; const result = await life.tick(); if (providerError) throw providerError; assert.equal(steps.length, 0); assert.equal(result.status, 'kept-private-or-quiet', JSON.stringify(result)); assert.equal(sends.length, 0); return result;},
    state(key) {const evidence = cognition.store.recordMessage({scope: 'unknown', event: 'seed:' + key, role: 'self', text: 'Synthetic source-linked curiosity', at: now, source: 'public-exploration'});
      cognition.store.setState({kind: 'interest', key, value: {interpretation: 'I want to explore ' + key, active: true}, evidence: [{type: 'message', id: evidence.id}], at: now, source: 'fixture'});
      return cognition.store.getState({kind: 'interest', key, limit: 1})[0];},
    feedback(text, event = '10001') {const message = {message_type: 'group', group_id: Number(GROUP), user_id: Number(FATHER), message_id: Number(event), time: now / 1000,
      message: [{type: 'at', data: {qq: BOT}}, {type: 'text', data: {text}}]};
      conversationDb.prepare('INSERT INTO turns VALUES(?,?,?,?,?,?)').run(scope.address, event, 'user', JSON.stringify(transportMessage(message, {scope, botId: BOT})), now, 'completed');},
    status() {return life.conversationTools(scope, {message: {message_id: '10002', user_id: FATHER}, authorize: async () => true}).find(tool => tool.name === 'public_life_status').handler({}).then(JSON.parse);},
  };
}

test('real opportunity wiring preserves reader fields, records repeat/failure evidence and permits a different interest after restart', async t => {
  const f = fixture(t), tide = f.state('reflection:tides'), craft = f.state('reflection:paper');
  const first = await f.run(request => {assert.ok(initial(request).active_interests.some(row => row.key === tide.key)); return choose(tide);},
    request => {assert.equal(last(request).chosen, true); assert.equal(last(request).progress.source_state.key, tide.key); return read;},
    request => {const output = last(request); const {exploration_progress, ...retained} = output; assert.deepEqual(retained, f.original);
      assert.equal(exploration_progress.counts['new-material'], 1); assert.equal(exploration_progress.attempts[0].status, 'ok'); return save;}, quiet);
  const originalDiscovery = f.life.db.prepare('SELECT id FROM discoveries WHERE activity=?').get(first.activity).id;
  f.advance();
  const repeated = await f.run(request => {const progress = initial(request).exploration_progress; assert.equal(progress.recent.find(row => row.activity === first.activity).state, 'completed');
    assert.deepEqual(progress.related_interests.find(row => row.key === tide.key).activities, [first.activity]); return choose(tide);}, read,
    request => {const output = last(request); assert.deepEqual(output.sources, f.original.sources); assert.equal(output.next_offset, 12000);
      assert.equal(output.exploration_progress.counts['same-material'], 1); assert.equal(output.exploration_progress.sources[0].compared_with.discovery, originalDiscovery); return quiet;});
  f.advance();
  const failure = {status: 'unavailable', sources: [], reason: 'authorized-reader-not-configured', notice: 'No source retrieved'};
  f.setReader(() => failure);
  const failed = await f.run(choose(tide), read, request => {const output = last(request); const {exploration_progress, ...retained} = output;
    assert.deepEqual(retained, failure); assert.equal(exploration_progress.progress, 'source-unavailable'); assert.equal(exploration_progress.repeated_requests, 1);
    assert.equal(exploration_progress.attempts[0].repeated_request_of.activity, repeated.activity); return quiet;});
  assert.equal(f.life.db.prepare('SELECT count(*) n FROM life_progress_attempts').get().n, 3);
  assert.equal(f.life.db.prepare('SELECT count(*) n FROM discoveries WHERE activity=?').get(failed.activity).n, 0);
  assert.deepEqual(f.cognition.store.getState({kind: tide.kind, key: tide.key, limit: 1})[0], tide, 'A failed reader cannot retire or rewrite an interest');
  f.advance(); await f.restart();
  f.setReader(() => ({status: 'ok', sources: [{url: 'https://example.org/paper', title: 'Paper', excerpt: 'A genuinely different saved description of folding paper.'}], next_offset: null}));
  await f.run(request => {const saved = initial(request).exploration_progress.recent;
    assert.equal(saved.find(row => row.activity === failed.activity).progress, 'source-unavailable');
    assert.equal(saved.find(row => row.activity === repeated.activity).progress, 'repeated-or-overlapping-material');
    assert.ok(initial(request).active_interests.some(row => row.key === craft.key)); return choose(craft);},
    {name: 'public_fetch', args: {url: 'https://example.org/paper'}}, request => {assert.equal(last(request).exploration_progress.counts['new-material'], 1); return quiet;});
});

test('thrown and malformed reader responses retain short attempts without inventing discoveries', async t => {
  const f = fixture(t), interest = f.state('reflection:tides');
  f.setReader(() => {throw Error('DO_NOT_PERSIST_SECRET');});
  const thrown = await f.run(choose(interest), read, request => {assert.match(last(request), /rejected or failed/); return quiet;});
  assert.equal(f.life.progress.inspect(thrown.activity).attempts[0].status, 'failed');
  assert.doesNotMatch(JSON.stringify(f.life.db.prepare('SELECT * FROM life_progress_attempts').all()), /DO_NOT_PERSIST/);
  f.advance(); f.setReader(() => 'malformed-reader-response');
  const malformed = await f.run(choose(interest), read, request => {assert.equal(last(request), 'malformed-reader-response'); return quiet;});
  assert.equal(f.life.progress.inspect(malformed.activity).attempts[0].status, 'unknown');
  assert.equal(f.life.db.prepare('SELECT count(*) n FROM discoveries').get().n, 0);
});

test('public_life_status previews fresh attributable feedback and progress without changing any store', async t => {
  const f = fixture(t), interest = f.state('reflection:tides');
  await f.run(choose(interest), read, save, quiet);
  f.feedback('说通俗一点');
  assert.equal(f.life.db.prepare('SELECT count(*) n FROM life_share_feedback').get().n, 0);
  const before = [changes(f.life.db), changes(f.conversationDb), changes(f.cognition.store.db)];
  const first = await f.status(), second = await f.status();
  assert.deepEqual(second, first);
  assert.deepEqual([changes(f.life.db), changes(f.conversationDb), changes(f.cognition.store.db)], before, 'Status must not absorb new feedback or update exploration, cognition or pacing');
  assert.equal(first.exploration_progress.recent[0].counts['new-material'], 1);
  assert.ok(first.sharing_audiences.find(row => row.recipient === 'family').recipient_feedback.preferences.some(row => row.key === 'language' && row.value === 'plain'));
  assert.equal(f.life.db.prepare('SELECT count(*) n FROM life_share_feedback').get().n, 0);
  assert.equal(f.sends.length, 0);
  const persisted = f.life.shareAudience.inspect(scope);
  assert.deepEqual(persisted, first.sharing_audiences.find(row => row.recipient === 'family').recipient_feedback);
  assert.equal(f.life.db.prepare('SELECT count(*) n FROM life_share_feedback').get().n, 1, 'Ordinary refresh still persists the same feedback after a preview');
});

test('audience preview merges saved and fresh contradictory feedback with the normal ordering and attribution', async t => {
  const f = fixture(t);
  f.feedback('说通俗一点', '20001'); f.life.shareAudience.inspect(scope);
  f.advance(); f.feedback('多讲技术细节', '20002');
  const before = changes(f.life.db), preview = f.life.shareAudience.inspect(scope, {persist: false});
  assert.equal(changes(f.life.db), before);
  assert.equal(preview.preferences.find(row => row.key === 'language').value, 'technical');
  assert.equal(preview.preferences.find(row => row.key === 'language').event, '20002');
  assert.equal(preview.recent_feedback.length, 2);
  assert.deepEqual(f.life.shareAudience.inspect(scope), preview);
});

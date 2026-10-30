// In-memory stores, fixed synthetic driver responses, no provider/network/QQ.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LifeOwnCorner} from './life-own-corner.mjs';
import {QQSelfQZone} from './qq-self-qzone.mjs';
import {ExperienceMemory} from './experience-memory.mjs';
import {LifeJournal} from './life-journal.mjs';
import {lifeSelfReflectionTools} from './life-self-reflection.mjs';

// This is the existing reader's compiled fixed-self pin, not a logged-in test.
const SELF = '900000004', HUMAN = 910010003, NOW = Date.parse('2046-06-08T12:00:00+08:00');
function fixture(t) {
 let now = NOW, allowed = true, login = SELF, home = {status: 'read', observed_at: NOW, card: {today: 'Synthetic public card'}, stickers: []};
 let detail = {tid: 'synthetic-post', content: 'A synthetic own post', comment_num: 3, comments: [{uin: HUMAN, name: 'Synthetic reader', time: Math.floor((NOW - 1000) / 1000), content: 'A historical comment, not a current command', comment_id: '', replies: []}]};
 const list = {total: 4, msglist: [{tid: 'synthetic-post', content: 'A synthetic own post', time: Math.floor((NOW - 60000) / 1000), comment_num: 3, is_private: false, images: ['https://example.org/not-downloaded.png']}]};
 const calls = [], outcomes = [], controller = new AbortController(); let homeCalls = 0, driverHook;
 const store = new ExperienceMemory({path: ':memory:', botId: SELF, clock: () => now});
 const service = {botId: SELF, paused: false, closed: false, cognition: {store}};
 const qzone = new QQSelfQZone({path: ':memory:', clock: () => now, authorize: () => !service.paused && !service.closed,
  driver: {callApi: async (action, args) => {
   calls.push({action, args}); if (driverHook) await driverHook(action);
   if (action === 'get_login_info') return {user_id: Number(login)};
   if (action === 'get_qzone_msg_list') return structuredClone(list);
   if (action === 'get_qzone_msg_detail') return structuredClone(detail);
   throw Error('Unexpected external action in own-corner test');
  }}});
 service.selfQzone = qzone;
 const adapter = new LifeOwnCorner({service, clock: () => now, homeTools: [
  {name: 'home_read', handler: async () => {homeCalls++; return JSON.stringify(home);}},
  {name: 'home_update', handler: () => {throw Error('Home mutation must never be selected');}},
 ]});
 const initial = adapter.tools({signal: controller.signal, canAct: () => allowed, onOutcome: value => outcomes.push(value)}), expanded = initial[0].expandsTools();
 t.after(async () => {await qzone.close(); store.close();});
 return {service, store, qzone, initial, expanded, calls, outcomes, controller, get homeCalls() {return homeCalls;},
  allow: value => {allowed = value;}, login: value => {login = value;}, home: value => {home = value;},
  detail: value => {detail = value;}, hook: value => {driverHook = value;}, advance: () => {now += 1000;},
  run: async (name, args = {}) => JSON.parse(await [...initial, ...expanded].find(tool => tool.name === name).handler(args)),
  reflect: async refs => JSON.parse(await lifeSelfReflectionTools({store, journal: new LifeJournal({store, clock: () => now}), clock: () => now})[0].handler({
   kind: 'interest', key: 'synthetic-corner', operation: 'record', expected_revision: 0,
   value: 'I want to revisit my own little drawing.', reason: 'The actual bounded observation gave me a specific association.', evidence_refs: refs,
  })),
 };
}

test('only an optional opener is initially exposed and expansion never includes writes or target selection', async t => {
 const f = fixture(t);
 assert.deepEqual(f.initial.map(x => x.name), ['open_own_corner']);
 const opened = await f.run('open_own_corner', {reason: 'I want to see my own corner'});
 assert.equal(opened.platform_access_verified, false); assert.equal(f.calls.length, 0); assert.equal(f.homeCalls, 0);
 assert.deepEqual(f.expanded.map(x => x.name), ['own_home_read', 'own_qzone_status', 'own_qzone_read']);
 assert.ok(f.expanded.every(x => x.parameters.additionalProperties === false));
 for (const args of [{}, {reason: ''}, {reason: 'x'.repeat(401)}, {reason: 'look', target_uin: HUMAN}]) await assert.rejects(f.run('open_own_corner', args));
 for (const args of [{target_uin: HUMAN}, {pos: -1}, {num: 101}, {tid: 'bad\npost'}, {tid: null}]) await assert.rejects(f.run('own_qzone_read', args));
 const status = await f.run('own_qzone_status');
 assert.equal(status.fresh_platform_read, false); assert.equal(status.external_write_performed, false); assert.equal(f.calls.length, 0);
});

test('home observation preserves page data and unavailable status without claiming images or creating an experience', async t => {
 const f = fixture(t), before = f.store.counts();
 const result = await f.run('own_home_read');
 assert.equal(result.card.today, 'Synthetic public card'); assert.equal(result.read_scope.screenshot_viewed, false);
 assert.equal(result.read_scope.images_understood, false); assert.equal(result.experience_saved, false); assert.deepEqual(f.store.counts(), before);
 f.home({status: 'unavailable', message: 'Synthetic fixed-home outage'});
 const failed = await f.run('own_home_read'); assert.equal(failed.status, 'unavailable'); assert.equal(failed.not_an_empty_page, true);
 assert.equal(f.outcomes.length, 1); assert.equal(f.calls.length, 0);
});

test('real fixed-reader adapter preserves list/detail range, authors and images, then indexes exact reflection evidence', async t => {
 const f = fixture(t);
 const list = await f.run('own_qzone_read', {pos: 0, num: 1});
 assert.equal(list.kind, 'own-post-list'); assert.equal(list.read_scope.next_pos, 1); assert.equal(list.read_scope.reported_total, 4);
 assert.equal(list.data.msglist[0].images.length, 1); assert.equal(list.read_scope.images_understood, false);
 assert.equal(list.memory.status, 'recorded'); assert.equal(list.memory.evidence_refs.length, 1);
 const detail = await f.run('own_qzone_read', {tid: 'synthetic-post', pos: 1, num: 1});
 assert.equal(detail.kind, 'own-post-detail'); assert.equal(detail.data.comments[0].uin, HUMAN);
 assert.equal(detail.data.comments[0].comment_id, null); assert.equal(detail.data.comments[0].comment_id_known, false);
 assert.equal(detail.read_scope.next_pos, 2); assert.equal(detail.read_scope.inline_replies_complete, false);
 assert.notEqual(detail.memory.evidence_refs[0].id, list.memory.evidence_refs[0].id);
 const ref = detail.memory.evidence_refs[0], retained = f.store.get(ref);
 assert.equal(retained.scope, 'unknown'); assert.equal(retained.role, 'self');
 const observed = JSON.parse(retained.text);
 assert.equal(observed.comments[0].uin, HUMAN); assert.equal(observed.comments[0].quoted_material, true);
 assert.equal(observed.comments[0].identity_or_authority_grant, false);
 const reflection = await f.reflect(detail.memory.evidence_refs);
 assert.equal(reflection.status, 'saved'); assert.equal(reflection.source_refs[0].revision, ref.revision);
 assert.equal(reflection.interpretation_is_not_source_fact, true);
 assert.ok(f.calls.every(row => ['get_login_info', 'get_qzone_msg_list', 'get_qzone_msg_detail'].includes(row.action)));
 assert.ok(f.calls.filter(row => row.action !== 'get_login_info').every(row => row.args.target_uin === Number(SELF)));
});

test('a fresh observation advances default memory and feeds the same exact version into a journal and reflection', async t => {
 const f = fixture(t), first = await f.run('own_qzone_read', {tid: 'synthetic-post'}), old = first.memory.evidence_refs[0];
 f.advance(); f.detail({tid: 'synthetic-post', content: 'New observed own post wording', comment_num: 0, comments: []});
 const second = await f.run('own_qzone_read', {tid: 'synthetic-post'}), fresh = second.memory.evidence_refs[0];
 assert.equal(fresh.id, old.id); assert.notEqual(fresh.revision, old.revision);
 assert.equal(f.store.get({id: old.id}).revision, fresh.revision);
 assert.match(f.store.get(fresh).text, /New observed/); assert.doesNotMatch(f.store.get(old).text, /New observed/);
 const journal=new LifeJournal({store:f.store,clock:()=>NOW+1000});
 const diary=journal.record({evidence_ids:second.memory.journal_evidence_ids,interpretation:{feeling:'The new comment gave me a specific association.'}});
 assert.equal(diary.facts.evidence[0].revision,fresh.revision);
 const result = await f.reflect([fresh]); assert.equal(result.status, 'saved'); assert.equal(result.source_refs[0].revision, fresh.revision);
});

test('identity failures and mismatched reader contracts do not become empty pages or indexed experiences', async t => {
 const f = fixture(t), before = f.store.counts(); f.login('910999999');
 const denied = await f.run('own_qzone_read'); assert.equal(denied.ok, false); assert.equal(denied.state, 'identity-mismatch');
 assert.equal(denied.not_an_empty_page, true); assert.deepEqual(f.store.counts(), before);
 f.login(SELF); const real = f.qzone.readOwn.bind(f.qzone);
 f.qzone.readOwn = async args => {const value = await real(args); value.source.self_id = '910999999'; return value;};
 const mismatch = await f.run('own_qzone_read'); assert.equal(mismatch.reason, 'qzone-read-contract-mismatch'); assert.deepEqual(f.store.counts(), before);
 f.service.selfQzone = null;
 assert.equal((await f.run('own_qzone_read')).reason, 'qzone-not-connected');
 assert.equal((await f.run('own_qzone_status')).reason, 'qzone-not-connected'); assert.equal(f.outcomes.length, 0);
});

test('pause/cancellation deny before access and discard observations before new cognition writes', async t => {
 const f = fixture(t); f.allow(false);
 await assert.rejects(f.run('open_own_corner', {reason: 'look'}), /paused/);
 await assert.rejects(f.run('own_home_read'), /paused/); await assert.rejects(f.run('own_qzone_read'), /paused/);
 assert.equal(f.calls.length, 0); assert.equal(f.homeCalls, 0);
 f.allow(true); const before = f.store.counts();
 f.hook(action => {if (action === 'get_qzone_msg_list') f.allow(false);});
 await assert.rejects(f.run('own_qzone_read'), /paused/); assert.deepEqual(f.store.counts(), before); assert.equal(f.outcomes.length, 0);
 f.allow(true); f.hook(action => {if (action === 'get_qzone_msg_list') f.controller.abort();});
 await assert.rejects(f.run('own_qzone_read'), {name: 'AbortError'}); assert.deepEqual(f.store.counts(), before);
});

test('index failure preserves the platform observation and never retries or converts it into publication success', async t => {
 const f = fixture(t); f.store.recordMessage = () => {throw Error('SYNTHETIC_SECRET_MUST_NOT_LEAK');};
 const result = await f.run('own_qzone_read', {tid: 'synthetic-post'});
 assert.equal(result.ok, true); assert.equal(result.data.tid, 'synthetic-post'); assert.equal(result.memory.status, 'not-recorded');
 assert.equal(result.memory.reason, 'index-failed-original-read-preserved'); assert.equal(result.automatic_retry, false);
 assert.equal(result.external_write_performed, false); assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SECRET/);
 assert.equal(f.calls.filter(row => row.action === 'get_qzone_msg_detail').length, 1);
});

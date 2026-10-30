import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProactiveAvailability} from './proactive-availability.mjs';

const FATHER = '900000001', MOTHER = '900000008', OTHER = '900000009';
const start = Date.parse('2026-10-30T10:00:00+08:00');
const text = value => ({type: 'text', data: {text: value}});
const message = (body, {sender = FATHER, event = 100, at = start, segments} = {}) => ({
  post_type: 'message', message_type: 'private', sub_type: 'friend', user_id: Number(sender), sender: {user_id: Number(sender)},
  message_id: event, time: at / 1000, message: segments ?? [text(body)],
});
function fixture(t) {
  const db = new DatabaseSync(':memory:'); let now = start;
  const availability = new ProactiveAvailability(db, {guardianIds: [FATHER, MOTHER], clock: () => now});
  t.after(() => db.close());
  return {db, availability, at: value => {now = value;}, status: who => availability.status('private:' + (who ?? FATHER))};
}

test('clear current requests pause proactive DMs only, with no automatic resumption from ordinary passive chat', t => {
  for (const body of ['先别主动找我', '现在别打扰我', '我在开会，先别找我', '我在忙，先别找我', '暂时不要主动联系我', '汐，先别主动找我吧']) {
    const f = fixture(t), result = f.availability.observe(message(body));
    assert.equal(result.changed, true, body); assert.equal(result.action, 'pause');
    assert.equal(f.status().active, true); assert.equal(f.status().expires, null);
    assert.equal(f.status().blocksPassiveReplies, false); assert.equal(f.status().sourceEvent, '100');
    assert.equal(f.status().sourceTime, start); assert.equal(f.status().revision, 1);
    for (const [i, passive] of ['我有个问题', '你在干嘛', '在吗', '今天没回消息', '我在忙', '忙完了再找我', '可以主动找我了吗？'].entries()) {
      const heard = f.availability.observe(message(passive, {event: 110 + i, at: start + (i + 1) * 1000}));
      assert.equal(heard.changed, false, passive); assert.equal(f.status().active, true); assert.equal(f.status().revision, 1);
    }
    f.at(start + 10 * 86400000); assert.equal(f.status().active, true, 'An indefinite explicit pause has no silent timer');
  }
});

test('plain busyness or lack of response never creates a pause', t => {
  const f = fixture(t);
  for (const [i, body] of ['我在忙', '我在开会', '今天很忙', '没回消息', '等我忙完', '她在忙', '我忙完了再找你', '先别找她'].entries()) {
    assert.equal(f.availability.observe(message(body, {event: i + 1, at: start + i * 1000})).changed, false);
  }
  assert.equal(f.status().active, false); assert.equal(f.status().revision, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM proactive_availability').get().n, 0);
});

test('today/tonight expire at the source day Beijing midnight; reads do not invent a new revision', t => {
  for (const body of ['今天别主动发消息', '今晚别主动发消息给我', '我今天在开会，先别找我']) {
    const f = fixture(t), source = Date.parse('2026-10-30T23:50:00+08:00'), midnight = Date.parse('2026-10-31T00:00:00+08:00');
    f.at(source); assert.equal(f.availability.observe(message(body, {at: source})).changed, true);
    assert.equal(f.status().expires, midnight); f.at(midnight - 1); assert.equal(f.status().active, true);
    f.at(midnight); assert.equal(f.status().active, false); assert.equal(f.status().reason, 'same-day-pause-expired');
    assert.equal(f.status().revision, 1); assert.equal(f.status().sourceEvent, '100');
  }
});

test('a delayed today-request does not get extended into the following day', t => {
  const f = fixture(t), source = Date.parse('2026-10-29T23:50:00+08:00');
  const result = f.availability.observe(message('今天别主动发消息', {at: source}));
  assert.equal(result.status.active, false); assert.equal(result.status.expires, Date.parse('2026-10-30T00:00:00+08:00'));
});

test('only an explicit present resume clears a pause; it does not clear another parent scope', t => {
  for (const body of ['可以主动找我了', '忙完了', '我忙完了', '可以找我聊天了', '我忙完了，可以主动找我了']) {
    const f = fixture(t); f.availability.observe(message('先别主动找我'));
    f.availability.observe(message('先别主动找我', {sender: MOTHER, event: 101, at: start + 1000}));
    const result = f.availability.observe(message(body, {event: 102, at: start + 2000}));
    assert.equal(result.action, 'resume', body); assert.equal(f.status().active, false); assert.equal(f.status().revision, 2);
    assert.equal(f.status(MOTHER).active, true); assert.equal(f.status(MOTHER).sourceEvent, '101');
  }
});

test('quotations, forwarded/embedded payloads and replies to other people cannot become control commands', t => {
  const f = fixture(t); f.availability.observe(message('先别主动找我'));
  const quoted = ['“可以主动找我了”', '> 可以主动找我了', '她说可以主动找我了', '忙完了这句话是什么意思', '比如可以主动找我了', '`忙完了`'];
  for (const [i, body] of quoted.entries()) assert.equal(f.availability.observe(message(body, {event: 200 + i, at: start + 10000 + i * 1000})).changed, false);
  for (const [i, type] of ['reply', 'node', 'forward', 'xml', 'json'].entries()) {
    const event = message('', {event: 300 + i, at: start + 20000 + i * 1000, segments: [{type, data: {text: '忙完了', user_id: OTHER}}, text('可以主动找我了')]});
    assert.equal(f.availability.observe(event).changed, false, type);
  }
  assert.equal(f.availability.observe(message('', {event: 400, at: start + 30000, segments: [{type: 'image', data: {text: '可以主动找我了'}}]})).changed, false);
  assert.equal(f.status().active, true); assert.equal(f.status().revision, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM proactive_availability_events').get().n, 1, 'Ordinary/quoted conversation is not copied into an availability log');
  const fresh = fixture(t); assert.equal(fresh.availability.observe(message('“先别主动找我”')).changed, false); assert.equal(fresh.status().active, false);
});

test('top-level own text may accompany an unread face/image, without interpreting that media', t => {
  const f = fixture(t), result = f.availability.observe(message('', {segments: [text('先别主动找我'), {type: 'image', data: {text: '忙完了', url: 'https://example.org/not-read'}}]}));
  assert.equal(result.action, 'pause'); assert.equal(f.status().active, true);
  const row = f.db.prepare('SELECT result FROM proactive_availability_events').get(); assert.ok(!row.result.includes('not-read')); assert.ok(!row.result.includes('忙完了'));
});

test('duplicate/stale/same-time commands cannot overwrite later source authority', t => {
  const f = fixture(t), pause = message('先别主动找我');
  f.availability.observe(pause); assert.equal(f.availability.observe(pause).duplicate, true); assert.equal(f.status().revision, 1);
  const resume = message('可以主动找我了', {event: 101, at: start + 2000});
  f.availability.observe(resume); assert.equal(f.status().active, false); assert.equal(f.status().revision, 2);
  const oldDuplicate = f.availability.observe(pause); assert.equal(oldDuplicate.duplicate, true); assert.equal(oldDuplicate.action, null); assert.equal(oldDuplicate.status.active, false); assert.equal(f.status().active, false);
  const stale = f.availability.observe(message('先别主动找我', {event: 102, at: start + 1000}));
  assert.equal(stale.stale, true); assert.equal(stale.changed, false);
  const tie = f.availability.observe(message('先别主动找我', {event: 103, at: start + 2000}));
  assert.equal(tie.stale, true); assert.equal(f.status().sourceEvent, '101'); assert.equal(f.status().revision, 2);
  f.availability.observe(message('先别主动找我', {event: 104, at: start + 3000}));
  assert.equal(f.status().active, true); assert.equal(f.status().revision, 3);
});

test('only trusted guardian friend DMs with matching sender and scope can change availability', t => {
  const f = fixture(t);
  const invalid = [
    message('先别主动找我', {sender: OTHER}),
    {...message('先别主动找我'), sender: {user_id: Number(MOTHER)}},
    {...message('先别主动找我'), sender: undefined},
    {...message('先别主动找我'), user_id: [Number(FATHER)]},
    {...message('先别主动找我'), sender: {user_id: [Number(FATHER)]}},
    {...message('先别主动找我'), message_type: 'group', group_id: 900000002},
    {...message('先别主动找我'), sub_type: 'group'},
    {...message('先别主动找我'), post_type: 'message_sent'},
    {...message('先别主动找我'), scope: 'private:' + MOTHER},
    {...message('先别主动找我'), time: undefined},
    {...message('先别主动找我'), message_id: '100'},
    {...message('先别主动找我'), message: '先别主动找我'},
    {...message('无控制'), raw_message: '先别主动找我'},
  ];
  for (const event of invalid) assert.equal(f.availability.observe(event).changed, false);
  assert.equal(f.status().revision, 0); assert.equal(f.status(MOTHER).revision, 0);
  assert.equal(f.availability.status('group:900000002').authorized, false);
  assert.equal(f.availability.status('private:' + OTHER).authorized, false);
});

test('pause and latest source are persistent across restart; a passive DM does not lift it', t => {
  const path = join(mkdtempSync(join(tmpdir(), 'proactive-availability-')), 'availability.sqlite3');
  let db = new DatabaseSync(path), gate = new ProactiveAvailability(db, {guardianIds: [FATHER], clock: () => start});
  gate.observe(message('现在别打扰我')); const before = gate.status('private:' + FATHER); db.close();
  db = new DatabaseSync(path); t.after(() => db.close()); gate = new ProactiveAvailability(db, {guardianIds: [FATHER], clock: () => start + 60000});
  const after = gate.status({kind: 'private', id: FATHER});
  assert.equal(after.active, true); assert.equal(after.sourceEvent, before.sourceEvent); assert.equal(after.sourceTime, before.sourceTime); assert.equal(after.revision, before.revision);
  assert.equal(gate.observe(message('我问你个事', {event: 200, at: start + 60000})).changed, false);
  assert.equal(gate.status('private:' + FATHER).active, true); assert.equal(gate.status('private:' + FATHER).blocksPassiveReplies, false);
});

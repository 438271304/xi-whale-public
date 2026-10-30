// Synthetic world/driver/host and real guardian route. No QQ, model or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {guardQQWorld, sendLifeQQDelivery} from './qq-event-policy.mjs';
import {selectNativeFaces} from './qq-face-output.mjs';
import {LifeShareMedia} from './life-share-media.mjs';

const BOT = '910430001', FATHER = '910430002', MOTHER = '910430003', OTHER = '910430004', GROUP = '910440001';
const DAY = Date.parse('2036-10-17T10:00:00+08:00'), NIGHT = Date.parse('2036-10-18T00:00:00+08:00');
const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(16, 7)]);
const target = (id = FATHER, kind = 'private') => ({kind, id});
const attachments = () => ({faces: selectNativeFaces(['0', '66']), imageBytes: Buffer.from(image), mime: 'image/png'});
function fixture() {
 let now = DAY, watched = {groups: [Number(GROUP)], users: []}, friends = [FATHER, MOTHER], friendHook, sendHook, hostHook;
 const order = [], wire = [], textCalls = [], events = [], friendCalls = [], receipt = {message_id: 934001};
 const policy = {bot_id: BOT, group_id: GROUP, group_ids: [GROUP], father_id: FATHER, mother_id: MOTHER, friend_private_enabled: true, follow_configured_groups: true};
 const world = {
  handleEvent: async () => ({accepted: true}), getWatched: () => watched, setWatched: (groups, users) => {watched = {groups, users};},
  knownMessages: new Map(),
  driver: {callApi: async (name, args) => {
   if (name === 'get_friend_list') {friendCalls.push(args); order.push('friend'); if (friendHook) await friendHook(); return friends.map(user_id => ({user_id}));}
   assert.ok(['send_private_msg', 'send_group_msg'].includes(name)); order.push('driver'); wire.push({name, args});
   return sendHook ? sendHook(name, args) : receipt;
  }},
  sendToTarget: async function (destination, expression) {
   assert.equal(this, world); order.push('text-route'); textCalls.push({target: destination, expression}); return receipt;
  },
 };
 guardQQWorld(world, policy, () => new Date(now));
 // The real guard is installed before a host is started, as in production.
 world.host = {pushEvent: async event => {order.push('host'); events.push(event); return hostHook ? hostHook(event) : {ts: event.ts};}};
 return {world, policy, order, wire, textCalls, events, friendCalls, receipt,
  clock: value => {now = value;}, friends: value => {friends = value;}, watched: value => {watched = value;},
  onFriend: value => {friendHook = value;}, onSend: value => {sendHook = value;}, onHost: value => {hostHook = value;},
 };
}
const rejected = (promise, attempted = false, pattern) => assert.rejects(promise, error => {
 assert.equal(error.deliveryAttempted, attempted); if (pattern) assert.match(error.message, pattern); return true;
});
const options = (f, prepare = attachments) => ({
 beforeTransport: async () => {f.order.push('before');}, prepareMedia: () => {f.order.push('prepare'); return prepare();},
 onTransportAttempt: () => {f.order.push('attempt');},
});

test('father and mother receive a new single mixed expression without an incoming private reply lease', async () => {
 for (const id of [FATHER, MOTHER]) {
  const f = fixture();
  await assert.rejects(f.world.sendToTarget(target(id), {text: 'An ordinary reply still needs a lease'}), /fresh message/);
  const result = await sendLifeQQDelivery(f.world, target(id), 'One synthetic deliberate expression', options(f));
  assert.equal(result.message_id, f.receipt.message_id);
  assert.deepEqual(f.order, ['friend', 'before', 'prepare', 'attempt', 'driver', 'host']);
  assert.equal(f.wire.length, 1); assert.equal(f.textCalls.length, 0); assert.equal(f.friendCalls.length, 1); assert.equal(f.events.length, 1);
  const call = f.wire[0]; assert.equal(call.name, 'send_private_msg'); assert.equal(call.args.user_id, Number(id)); assert.equal(call.args.group_id, undefined);
  assert.deepEqual(call.args.message.map(segment => segment.type), ['text', 'face', 'face', 'image']);
  assert.equal(call.args.message[0].data.text, 'One synthetic deliberate expression');
  assert.equal(call.args.message.at(-1).data.file, 'base64://' + image.toString('base64'));
  assert.equal(f.events[0].type, 'qq.self'); assert.equal(f.events[0].meta.message_id, f.receipt.message_id);
  assert.deepEqual(f.events[0].meta.conv, {kind: 'private', id});
  assert.equal(f.events[0].meta.user_id, BOT); assert.equal(JSON.stringify(f.events).includes(image.toString('base64')), false);
 }
});

test('family group, face-only and image-only attachments each use one message and one receipt', async () => {
 for (const media of [{faces: selectNativeFaces(['66'])}, {imageBytes: Buffer.from(image), mime: 'image/png'}, attachments()]) {
  const f = fixture(), result = await sendLifeQQDelivery(f.world, target(GROUP, 'group'), 'A synthetic group expression', options(f, () => media));
  assert.equal(result.message_id, f.receipt.message_id); assert.equal(f.friendCalls.length, 0); assert.equal(f.wire.length, 1); assert.equal(f.events.length, 1);
  assert.equal(f.wire[0].name, 'send_group_msg'); assert.equal(f.wire[0].args.group_id, Number(GROUP));
  assert.equal(f.textCalls.length, 0); assert.deepEqual(f.events[0].meta.conv, {kind: 'group', id: GROUP});
 }
});

test('text-only and empty optional media preserve the original expression-object route', async () => {
 for (const kind of ['absent', 'empty', 'no-faces']) {
  const f = fixture(), callbacks = {onTransportAttempt: () => f.order.push('attempt')};
  if (kind !== 'absent') callbacks.prepareMedia = () => kind === 'empty' ? {} : {faces: []};
  assert.equal(await sendLifeQQDelivery(f.world, target(), 'Unchanged synthetic text', callbacks), f.receipt);
  assert.deepEqual(f.textCalls, [{target: target(), expression: {text: 'Unchanged synthetic text'}}]);
  assert.equal(f.wire.length, 0); assert.equal(f.events.length, 0); assert.deepEqual(f.order, ['friend', 'attempt', 'text-route']);
 }
});

test('strangers, nonfamily groups, night, disabled private and changed friendship stop before preparation or attempt', async () => {
 const cases = [
  {target: target(OTHER), change: f => f.friends([OTHER, FATHER])},
  {target: target(OTHER, 'group'), change: f => f.watched({groups: [Number(OTHER)], users: []})},
  {target: target(), change: f => f.clock(NIGHT)},
  {target: target(GROUP, 'group'), change: f => f.clock(NIGHT)},
  {target: target(), change: f => {f.policy.friend_private_enabled = false;}},
  {target: target(), change: f => f.onFriend(async () => {f.friends([MOTHER]);})},
  {target: target(), change: f => f.onFriend(async () => {f.clock(NIGHT);})},
 ];
 for (const entry of cases) {
  const f = fixture(); entry.change(f);
  await rejected(sendLifeQQDelivery(f.world, entry.target, 'Synthetic rejected expression', options(f)));
  assert.equal(f.order.includes('before'), false); assert.equal(f.order.includes('prepare'), false); assert.equal(f.order.includes('attempt'), false);
  assert.equal(f.wire.length, 0); assert.equal(f.textCalls.length, 0); assert.equal(f.events.length, 0);
 }
});

test('beforeTransport rejection prevents preparation and the last check follows synchronous media preparation', async () => {
 const f = fixture();
 await rejected(sendLifeQQDelivery(f.world, target(), 'Synthetic stopped expression', {...options(f), beforeTransport: async () => false}));
 assert.equal(f.order.includes('prepare'), false); assert.equal(f.order.includes('attempt'), false);
 for (const change of [g => g.clock(NIGHT), g => {g.policy.friend_private_enabled = false;}, g => {g.policy.father_id = OTHER;}]) {
  const g = fixture();
  await rejected(sendLifeQQDelivery(g.world, target(), 'Synthetic expression', options(g, () => {change(g); return attachments();})));
  assert.deepEqual(g.order, ['friend', 'before', 'prepare']); assert.equal(g.wire.length, 0); assert.equal(g.textCalls.length, 0);
 }
 const group = fixture();
 await rejected(sendLifeQQDelivery(group.world, target(GROUP, 'group'), 'Synthetic group expression', options(group, () => {group.watched({groups: [], users: []}); return attachments();})));
 assert.equal(group.order.includes('attempt'), false); assert.equal(group.wire.length, 0);
});

test('prepareMedia must be synchronous and malformed or unavailable attachments never mark a transport attempt', async () => {
 const callbacks = [
  () => {throw Error('Synthetic preparation failure');},
  async () => attachments(),
  () => ({faces: [{id: '66', name: 'Wrong mapped name'}]}),
  () => ({imageBytes: 'https://example.org/not-an-attachment.png'}),
  () => ({imageBytes: Buffer.alloc(0)}),
 ];
 for (const prepare of callbacks) {
  const f = fixture(); await rejected(sendLifeQQDelivery(f.world, target(), 'Synthetic expression', options(f, prepare)));
  assert.equal(f.order.includes('attempt'), false); assert.equal(f.wire.length, 0); assert.equal(f.textCalls.length, 0); assert.equal(f.events.length, 0);
 }
 const adapter = new LifeShareMedia({service: {botId: BOT, paused: false, closed: false}}), plan = structuredClone(adapter.prepare({native_face_ids: ['66']}));
 plan.metadata.native_faces[0].name = 'Changed after composition';
 const f = fixture();
 await rejected(sendLifeQQDelivery(f.world, target(), 'Synthetic saved selection', options(f, () => adapter.revalidate(plan))));
 assert.equal(f.order.includes('attempt'), false); assert.equal(f.wire.length, 0);
});

test('driver failure and absent definite receipt are uncertain after exactly one attempt with no fallback or retry', async () => {
 for (const mode of ['throw', 'missing-receipt']) {
  const f = fixture(), original = Error('Synthetic driver failure after one attempt');
  f.onSend(() => {if (mode === 'throw') throw original; return {};});
  await rejected(sendLifeQQDelivery(f.world, target(), 'Synthetic uncertain expression', options(f)), true);
  assert.equal(f.order.filter(x => x === 'attempt').length, 1); assert.equal(f.wire.length, 1); assert.equal(f.textCalls.length, 0); assert.equal(f.events.length, 0);
 }
});

test('host acknowledgement failure after a true driver receipt is uncertain and never triggers another send', async () => {
 const f = fixture(), error = Error('Synthetic host receipt failure'); f.onHost(() => {throw error;});
 await assert.rejects(sendLifeQQDelivery(f.world, target(MOTHER), 'Synthetic receipt uncertainty', options(f)), value => value === error && value.deliveryAttempted === true);
 assert.deepEqual(f.order, ['friend', 'before', 'prepare', 'attempt', 'driver', 'host']);
 assert.equal(f.wire.length, 1); assert.equal(f.events.length, 1); assert.equal(f.textCalls.length, 0);
 assert.equal(f.world.knownMessages.size, 0);
});

test('missing transport dependencies reject before attempt and model/callback cannot redirect the frozen destination', async () => {
 for (const missing of ['host', 'driver']) {
  const f = fixture();
  if (missing === 'host') f.world.host = null; else f.world.driver.callApi = undefined;
  await rejected(sendLifeQQDelivery(f.world, target(GROUP, 'group'), 'Synthetic unavailable route', options(f)));
  assert.equal(f.order.includes('attempt'), false); assert.equal(f.wire.length, 0); assert.equal(f.textCalls.length, 0);
 }
 const f = fixture(), requested = target();
 const result = await sendLifeQQDelivery(f.world, requested, 'Synthetic pinned destination', {
  ...options(f), beforeTransport: async () => {f.order.push('before'); requested.id = OTHER; requested.kind = 'group';},
 });
 assert.equal(result.message_id, f.receipt.message_id); assert.equal(f.wire[0].name, 'send_private_msg'); assert.equal(f.wire[0].args.user_id, Number(FATHER));
});

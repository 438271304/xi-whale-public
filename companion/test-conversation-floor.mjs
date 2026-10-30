import assert from 'node:assert/strict';
import { inferOtherExchange } from './conversation-floor.mjs';

const scope = { kind: 'group', id: '900000007', address: 'group:900000007' };
const self = '900000004', a = '900000008', b = '900000005', c = '900000009';
const base = { scope, botId: self, peerBots: [b] };
const at = target => ({ type: 'at', target });
const reply = (sender_id, message_id = '100') => ({ type: 'reply', message_id, reference: { sender_id } });
const msg = (sender, id, time, text = '', segments = []) => ({ transport: { conversation: scope.address, sender_id: sender, message_id: id, time }, segments: [...segments, ...(text ? [{ type: 'text', text }] : [])] });
const infer = (current, recent, config = {}) => inferOtherExchange({ ...base, current, recent, ...config });
const start = 1700000000; // Synthetic epoch; native-segment A -> B fixture.
const ask = msg(a, '-1001', start, '帮我查一下测试主题', [at(b), reply(b, '-1000')]);
const answer = msg(b, '1002', start + 31, '查到了，示例工具支持这项功能', [reply(a, '-1001')]);
const extra = msg(b, '-1003', start + 34, '还有一点：示例工具也支持图片');
const result = infer(extra, [ask, answer]);
const original = JSON.stringify([extra, ask, answer]);
assert.equal(result.attention, 'others');
assert.equal(result.reason, 'bounded-other-exchange-continuation');
assert.deepEqual(result.target_ids, [a]);
assert.equal(result.evidence[0].event, '1002');
assert.equal(result.evidence[0].time, start + 31);
assert.equal(JSON.stringify([extra, ask, answer]), original);
assert.equal(infer(extra, [ask, msg(b, '199', start + 31, '查到了，以下是结果')]).attention, 'others');
// The same exchange also works between two ordinary accounts.
assert.equal(infer(extra, [ask, answer], { peerBots: [] }).attention, 'others');
assert.equal(infer(extra, [ask, answer], { peerBots: new Set([b]) }).attention, 'others');

// Caller/native/vocative priorities: inference must not override these.
for (const current of [
  msg(b, '201', start + 35, '还有一点', [at(self)]),
  msg(b, '202', start + 35, '还有一点', [reply(self)]),
  msg(b, '203', start + 35, '汐，帮我看看'),
  msg(b, '204', start + 35, '汐宝你怎么看'),
  msg(b, '208', start + 35, '还有一点，汐你怎么看'),
  msg(b, '205', start + 35, '还有一点', [at('all')]),
  msg(b, '206', start + 35, '还有一点', [reply(b)]),
  msg(b, '207', start + 35, '还有一点', [at(c)]),
]) assert.equal(infer(current, [ask, answer]), null);

// Original native anchor expires. Unreferenced continuations do not renew it.
const first = msg(b, '301', answer.transport.time + 89, '还有一点：补充');
assert.equal(infer(first, [answer]).attention, 'others');
assert.equal(infer(msg(b, '302', answer.transport.time + 90, '还有一点：补充'), [answer]).attention, 'others');
assert.equal(infer(msg(b, '303', answer.transport.time + 91, '还有一点：补充'), [answer, first]), null);

// A changed explicit reply establishes the new recipient, never the old one.
const changed = msg(b, '401', start + 40, '答另一位的问题', [reply(c, '400')]);
assert.deepEqual(infer(msg(b, '402', start + 42, '具体是这些'), [ask, answer, changed]).target_ids, [c]);
assert.equal(infer(extra, [msg(b, '403', start + 35, '未来的记录', [reply(a)])]), null);
assert.equal(infer(msg(b, '404', start + 35, '还有一点'), [ask, answer, msg(c, '405', start + 34, '路过')]), null);
assert.equal(infer(msg(b, '406', start + 36, '还有一点'), [ask, answer, msg(c, '407', start + 34, '路过'), msg(b, '408', start + 35, '还有一点')]), null);

for (const text of ['换个话题，大家来聊晚饭', '对了，今晚吃什么', '大家怎么看这个功能', '有人知道今天的天气吗', '今天天气不错', '我想发一个新话题', '还有一点，大家怎么看', '不过，换个话题来聊晚饭']) {
  assert.equal(infer(msg(b, '501', start + 35, text), [ask, answer]), null);
}
assert.equal(infer(msg(b, '502', start + 36, '还有一点'), [ask, answer, msg(b, '503', start + 35, '题外话：聊晚饭')]), null);
assert.equal(infer(msg(b, '507', start + 36, '还有一点'), [ask, answer, msg(b, '508', start + 35, '我刚买了一本书')]), null);
assert.equal(infer(msg(b, '504', start + 36, '', [{ type: 'image' }]), [ask, answer]).attention, 'others');
assert.equal(infer(msg(b, '505', start + 36, '', [{ type: 'image' }]), [ask, answer, msg(c, '506', start + 35, '别的事')]), null);

// Missing time/scope/source or invented targets cannot establish a floor.
for (const current of [
  { ...extra, transport: { ...extra.transport, time: undefined } },
  { ...extra, transport: { ...extra.transport, time: String(start + 34) } },
  { ...extra, transport: { ...extra.transport, conversation: 'group:999999999' } },
  { ...extra, role: 'assistant' },
]) assert.equal(infer(current, [ask, answer]), null);
assert.equal(infer(extra, [{ ...answer, transport: { ...answer.transport, time: undefined } }]), null);
assert.equal(infer(extra, [{ ...answer, scope: 'group:999999999' }]), null);
assert.equal(infer(extra, [{ ...answer, sender_id: c }]), null);
assert.equal(infer(msg(b, '603', start + 35, '还有一点', [{ type: 'json', details: { title: '新分享' } }]), [ask, answer]), null);
assert.equal(infer(extra, [msg(b, '601', start + 31, '', [reply(a), at(c)])]), null);
assert.equal(infer(extra, [msg(b, '602', start + 31, '', [{ ...reply(a), reference: { sender_id: a, scope: 'group:999999999' } }])]), null);
assert.equal(infer(extra, [ask, { ...answer, role: 'assistant' }]), null);
assert.equal(infer(extra, []), null);
assert.equal(infer(extra, [ask, answer], { scope: { kind: 'private', id: a } }), null);
// Native payloads inside persisted user wrappers retain attribution checks.
assert.equal(infer({ role: 'user', event: extra.transport.message_id, text: JSON.stringify(extra) }, [{ role: 'user', text: JSON.stringify(answer) }]).attention, 'others');
assert.equal(infer(extra, [{ role: 'user', event: 'wrong', text: JSON.stringify(answer) }]), null);
assert.equal(infer(extra, [ask, answer, extra]).attention, 'others');
assert.equal(infer(extra, [ask, answer, msg(c, extra.transport.message_id, extra.transport.time, '同ID冲突')]), null);
console.log('conversation-floor: bounded synthetic exchange and boundary cases passed');

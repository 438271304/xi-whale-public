// Bounded evidence that somebody is continuing their own reply to another
// account. This is not a general topic classifier or a group-wide mute.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const account = value => /^\d{5,15}$/.test(String(value ?? '')) ? String(value) : null;
const event = value => /^(?:-?\d{1,20})$/.test(String(value ?? '')) ? String(value) : null;
function scopeKey(scope) {
  if (typeof scope === 'string') {
    const match = /^group[:-](\d{5,15})$/.exec(scope);
    return match ? 'group:' + match[1] : null;
  }
  if (!object(scope) || scope.kind !== 'group' || !account(scope.id)) return null;
  const key = 'group:' + scope.id;
  if (scope.address !== undefined && scope.address !== key || scope.key !== undefined && scope.key !== key.replace(':', '-')) return null;
  return key;
}
function row(value, key) {
  if (!object(value) || value.role !== undefined && value.role !== 'user') return null;
  let p = value;
  if (!object(p.transport)) {
    if (typeof value.text !== 'string' || value.text.length > 200000) return null;
    try { p = JSON.parse(value.text); } catch { return null; }
  }
  const t = p?.transport, sender = account(t?.sender_id), message = event(t?.message_id);
  if (!sender || !message || scopeKey(t.conversation) !== key || t.event_kind || typeof t.time !== 'number' || !Number.isFinite(t.time) || t.time <= 0) return null;
  if (value.scope !== undefined && scopeKey(value.scope) !== key || value.peer !== undefined && scopeKey(value.peer) !== key || value.event !== undefined && String(value.event) !== message || value.sender_id !== undefined && String(value.sender_id) !== sender) return null;
  if (!Array.isArray(p.segments) || p.segments.length > 64) return null;
  const at = [], replies = [];
  let invalid = false;
  for (const s of p.segments) {
    // Opaque cards/forwards can introduce a new subject; do not silently erase
    // them and bridge the remaining words to an older conversation.
    if (!['text', 'at', 'reply', 'image', 'face', 'record', 'video', 'mface', 'bface', 'sface'].includes(s?.type)) invalid = true;
    if (s?.type === 'at') {
      const target = s.target === 'all' ? 'all' : account(s.target);
      if (!target) invalid = true; else at.push(target);
    }
    if (s?.type === 'reply') {
      const ref = s.reference, claimed = ref?.conversation ?? ref?.scope;
      if (!object(ref) || !event(s.message_id) || !account(ref.sender_id) || claimed !== undefined && scopeKey(claimed) !== key) invalid = true;
      else replies.push(account(ref.sender_id));
    }
  }
  const text = p.segments.filter(s => s?.type === 'text' && typeof s.text === 'string').map(s => s.text).join('').trim();
  return { key, sender, event: message, time: t.time, at, replies, text, invalid,
    mediaOnly: !text && p.segments.length > 0 && p.segments.every(s => ['image', 'face', 'record', 'video', 'mface', 'bface', 'sface'].includes(s?.type)) };
}
const selfCall = text => /(?:^|[，,。！？!?；;：:\n])\s*(?:请\s*)?@?\s*(?:汐汐|小汐|汐宝|汐)(?=$|[\s，,、:：!！?？~～。.]|你|在|来|帮|能|给|回|出来)/u.test(text);
// These are explicit conversational boundaries, not inferred topic changes.
const newTopic = text => /(?:^|[，,。！？!?；;\n])\s*(?:对了[，,：:\s]|话说[，,：:\s]|换(?:个|一个)?话题|说点别的|题外话|另一个话题|新话题|不说这个|先不聊这个)/u.test(text);
const publicCall = text => /(?:大家|各位|全群|群友们|所有人)(?:[，,：:\s]|你们|觉得|怎么看|有|来|一起|都)/u.test(text) || /(?:^|[，,。！？!?；;\n])\s*(?:有谁|谁知道|有人知道|有人想|谁想|一起来聊)/u.test(text);
function boundary(r, self) {
  return r.invalid || r.sender === self || r.at.includes('all') || r.at.includes(self) || r.replies.includes(self) || r.replies.includes(r.sender) || selfCall(r.text) || newTopic(r.text) || publicCall(r.text);
}
function anchor(r) {
  const targets = [...new Set([...r.at, ...r.replies])];
  if (!targets.length) return null;
  if (targets.length !== 1 || targets[0] === r.sender || targets[0] === 'all') return false;
  return { other: targets[0], source: r.at.length ? 'native-at' : 'native-reply' };
}
function continuation(r) {
  if (r.mediaOnly) return true;
  // Unknown standalone prose stays open. Anaphoric explanation shapes include
  // the observed "这两天刚加的功能是...", without keying on a platform/topic.
  return /^(?:补充(?:一下|一点)?(?:[，,：:\s]|就是)|查到(?:了|的是|的结果)|还有(?:一点|一个|一项|就是|[，,：:\s])|另外(?:还|也|一点|一项)|而且|不过|但是|所以|也就是说|换句话说|具体(?:来说|是)|其中|刚才(?:说的|那个|那条)|它(?:还|也|能|就是))/u.test(r.text)
    || /^(?:这|那)(?:两天|几天|次|回|边|里)?[^。！？!？\n]{0,12}(?:功能|细节|情况|原因|区别|部分|结果|内容|特点)(?:是|有|包括|在|为|[：:])/u.test(r.text);
}

export function inferOtherExchange({ scope, botId, peerBots = [], current, recent = [] } = {}) {
  const key = scopeKey(scope), self = account(botId);
  if (!key || !self || !Array.isArray(recent) || !(Array.isArray(peerBots) || peerBots instanceof Set)) return null;
  const now = row(current, key);
  // Explicit native addressing belongs to conversationFocus, including other
  // recipients. Do not compete with its priority or infer through self-quotes.
  if (!now || boundary(now, self) || now.at.length || now.replies.length || !continuation(now)) return null;
  const after = [];
  let newerTime = now.time;
  for (let i = recent.length - 1; i >= Math.max(0, recent.length - 24); i--) {
    const prior = row(recent[i], key);
    if (prior?.event === now.event) {
      if (prior.sender !== now.sender || prior.time !== now.time) return null;
      continue;
    }
    // A missing/foreign/unverified/intervening row is not evidence to skip over.
    if (!prior || prior.time > newerTime || now.time - prior.time > 90 || boundary(prior, self)) return null;
    newerTime = prior.time;
    if (!after.length && prior.sender !== now.sender) return null;
    const native = anchor(prior);
    if (native === false) return null;
    if (native) {
      const pair = new Set([prior.sender, native.other]);
      if (!pair.has(now.sender) || after.some(r => !pair.has(r.sender))) return null;
      const other = [...pair].find(sender => sender !== now.sender);
      return { attention: 'others', reason: 'bounded-other-exchange-continuation', source: 'recent-native-exchange', target_ids: [other],
        evidence: [{ scope: key, event: prior.event, sender_id: prior.sender, source: native.source, target_ids: [native.other], time: prior.time }] };
    }
    // An unmarked intervening sentence may have started another topic. Only
    // demonstrable continuations can bridge back to an older native anchor.
    if (!continuation(prior)) return null;
    after.push(prior);
  }
  return null;
}

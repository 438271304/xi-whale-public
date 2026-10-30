// Availability for unsolicited DMs from trusted current friends. This never blocks a reply to an
// incoming message, changes a task, starts a timer, or infers rejection from silence.
const DAY = 86400000, BEIJING = 8 * 3600000;
const account = value => ['string', 'number'].includes(typeof value) && /^(?:[1-9]\d{4,14})$/.test(String(value)) && (typeof value !== 'number' || Number.isSafeInteger(value)) ? String(value) : null;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function privateScope(value) {
  if (typeof value === 'string') {
    const match = /^private[:-]([1-9]\d{4,14})$/.exec(value);
    return match ? 'private:' + match[1] : null;
  }
  if (!object(value) || value.kind !== 'private' || !account(value.id)) return null;
  const key = 'private:' + value.id;
  if (value.address !== undefined && value.address !== key || value.key !== undefined && value.key !== key.replace(':', '-')) return null;
  return key;
}
function currentSource(message, guardians, admittedFriend) {
  if (!object(message) || message.post_type !== 'message' || message.message_type !== 'private' || message.sub_type !== 'friend') return null;
  const who = account(message.user_id);
  if (!who || !guardians.has(who) && admittedFriend !== true || !object(message.sender) || account(message.sender.user_id) !== who || !Number.isSafeInteger(message.message_id) || !Number.isFinite(message.time) || message.time <= 0 || !Array.isArray(message.message) || message.message.length > 64) return null;
  const sourceTime = Math.trunc(message.time * 1000), scope = 'private:' + who;
  if (!Number.isSafeInteger(sourceTime)) return null;
  for (const claim of [message.scope, message.peer, message.conversation]) if (claim !== undefined && privateScope(claim) !== scope) return null;
  return {scope, who, sourceEvent: String(message.message_id), sourceTime};
}
function ownCommand(message) {
  // A reply or container can frame another person's words. Do not search inside
  // it or treat a top-level comment on that quotation as a control instruction.
  if (message.message.some(s => ['reply', 'node', 'forward', 'xml', 'json'].includes(s?.type))) return null;
  const parts = message.message.filter(s => s?.type === 'text');
  if (!parts.length || parts.some(s => typeof s.data?.text !== 'string')) return null;
  let text = parts.map(s => s.data.text).join('').trim();
  if (!text || text.length > 500 || /[“”「」『』‘’"'`<>\r\n]/u.test(text) || /(?:转述|转发|引用|原话|比如|例如|这句话|这段话|他说|她说|别人说|朋友说|他说过|她说过)/u.test(text)) return null;
  text = text.replace(/\s+/g, ' ').replace(/[。！!~～]+$/u, '').trim();
  text = text.replace(/^(?:汐汐|小汐|汐宝|汐)[，,、：:\s]*/u, '').replace(/^(?:请|麻烦你)[，,\s]*/u, '');
  // Bare "忙完了" is an explicit completion statement. Conditional future
  // phrases (忙完了再找我) and questions (忙完了吗) intentionally do not match.
  if (/^(?:我)?(?:已经|现在)?忙完了$/u.test(text) || /^(?:(?:我)?(?:已经|现在)?忙完了[，,]\s*)?(?:现在)?可以(?:继续)?(?:主动)?(?:来?找我(?:聊天)?|联系我|给我发消息|发消息给我)了$/u.test(text)) return {action: 'resume', sameDay: false};
  text = text.replace(/^你[，,\s]*/u, '');
  const pause = /^(?:(今天|今晚)[，,\s]*)?(?:(我(?:现在|今天|今晚)?(?:在开会|要开会|在忙|有事|很忙))[，,、：:\s]+)?(?:(?:先|现在|暂时)[，,\s]*)?(?:别|不要|不用)(?:再)?(?:主动(?:来)?(?:找我(?:聊天)?|联系我|给我发消息|发消息(?:给我)?)|打扰我|找我(?:聊天)?)(?:了|吧|啦|哦)?$/u.exec(text);
  return pause ? {action: 'pause', sameDay: !!pause[1] || /今天|今晚/u.test(pause[2] ?? '')} : null;
}

export class ProactiveAvailability {
  constructor(db, {guardianIds = [], clock = () => Date.now()} = {}) {
    const ids = guardianIds instanceof Set ? [...guardianIds] : guardianIds;
    if (!db?.prepare || !db?.exec || !Array.isArray(ids) || ids.some(id => !account(id)) || typeof clock !== 'function') throw TypeError('Availability needs a database, trusted guardian IDs and a clock');
    this.db = db; this.guardianIds = new Set(ids.map(String)); this.clock = clock;
    db.exec(`CREATE TABLE IF NOT EXISTS proactive_availability(
      scope TEXT PRIMARY KEY,active INTEGER NOT NULL,expires INTEGER,revision INTEGER NOT NULL,
      source_event TEXT NOT NULL,source_time INTEGER NOT NULL,changed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS proactive_availability_events(
      scope TEXT NOT NULL,event TEXT NOT NULL,source_time INTEGER NOT NULL,result TEXT NOT NULL,
      PRIMARY KEY(scope,event));`);
  }
  status(scope) {
    const key = privateScope(scope);
    const row = key ? this.db.prepare('SELECT * FROM proactive_availability WHERE scope=?').get(key) : null;
    // A saved control keeps its provenance across restart; it is not a current
    // friend roster or permission to send. Delivery still rechecks membership.
    const guardian = !!key && this.guardianIds.has(key.slice(8)), authorized = guardian || !!row;
    const expired = !!row?.active && row.expires !== null && this.clock() >= row.expires;
    const active = !!row?.active && !expired;
    return {scope: key, authorized, active, expires: row?.expires ?? null, revision: row?.revision ?? 0,
      sourceEvent: row?.source_event ?? null, sourceTime: row?.source_time ?? null, changedAt: row?.changed_at ?? null,
      state: active ? 'proactive-paused' : 'available',
      reason: !authorized ? 'not-an-authorized-private-scope' : expired ? 'same-day-pause-expired' : row ? row.active ? 'explicit-proactive-pause' : 'explicit-proactive-resume' : 'no-explicit-proactive-pause',
      authorizationBasis: guardian ? 'configured-guardian' : row ? 'saved-admitted-friend-control' : null,
      authorizesContact: false, blocksPassiveReplies: false};
  }
  observe(message, {admittedFriend = false} = {}) {
    // Only the trusted inbound route may supply this flag, after checking the
    // current friend roster. A flag inside a message/model payload is ignored.
    // Without it, retain the existing guardian-only call contract.
    const source = currentSource(message, this.guardianIds, admittedFriend);
    if (!source) return {accepted: false, changed: false, reason: 'not-an-authorized-private-friend-message'};
    const seen = this.db.prepare('SELECT result FROM proactive_availability_events WHERE scope=? AND event=?').get(source.scope, source.sourceEvent);
    if (seen) return {accepted: true, changed: false, duplicate: true, action: null, stale: !!JSON.parse(seen.result).stale, reason: 'duplicate-source-event', status: this.status(source.scope)};
    const command = ownCommand(message);
    if (!command) return {accepted: true, changed: false, reason: 'no-explicit-proactive-control', status: this.status(source.scope)};
    // Savepoints cooperate with callers already using the shared DB transaction.
    this.db.exec('SAVEPOINT proactive_availability_write');
    try {
      const duplicate = this.db.prepare('SELECT result FROM proactive_availability_events WHERE scope=? AND event=?').get(source.scope, source.sourceEvent);
      if (duplicate) {this.db.exec('RELEASE proactive_availability_write'); return {accepted: true, changed: false, duplicate: true, action: null, stale: !!JSON.parse(duplicate.result).stale, reason: 'duplicate-source-event', status: this.status(source.scope)};}
      const prior = this.db.prepare('SELECT * FROM proactive_availability WHERE scope=?').get(source.scope);
      // OneBot timestamps have limited precision. A different command at exactly
      // the same source time has no provable order; it cannot override this one.
      const stale = !!prior && source.sourceTime <= prior.source_time;
      const result = stale ? {action: null, stale: true, reason: 'source-time-not-newer'} : {action: command.action, stale: false, reason: 'explicit-proactive-control'};
      if (!stale) {
        const expires = command.action === 'pause' && command.sameDay ? (Math.floor((source.sourceTime + BEIJING) / DAY) + 1) * DAY - BEIJING : null;
        this.db.prepare(`INSERT INTO proactive_availability VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(scope) DO UPDATE SET active=excluded.active,expires=excluded.expires,revision=excluded.revision,
          source_event=excluded.source_event,source_time=excluded.source_time,changed_at=excluded.changed_at`)
          .run(source.scope, command.action === 'pause' ? 1 : 0, expires, (prior?.revision ?? 0) + 1, source.sourceEvent, source.sourceTime, this.clock());
      }
      this.db.prepare('INSERT INTO proactive_availability_events VALUES(?,?,?,?)').run(source.scope, source.sourceEvent, source.sourceTime, JSON.stringify(result));
      this.db.exec('RELEASE proactive_availability_write');
      return {accepted: true, changed: !stale, ...result, status: this.status(source.scope)};
    } catch (error) {this.db.exec('ROLLBACK TO proactive_availability_write; RELEASE proactive_availability_write'); throw error;}
  }
}

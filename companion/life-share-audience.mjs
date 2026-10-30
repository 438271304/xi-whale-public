import {conversationScope} from './conversation-scope.mjs';
import {conversationFocus} from './conversation-focus.mjs';

const DAY = 86400000, OFFSET = 8 * 3600000, FEEDBACK_WINDOW = 10 * 60000;
const SAMPLE_AGE = 7 * DAY, SAMPLE_LIMIT = 512, TEXT_LIMIT = 240;
const account = value => /^\d{5,15}$/.test(String(value ?? '')) ? String(value) : null;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function checkedScope(value) {
  if (!object(value)) throw TypeError('Invalid sharing audience scope');
  const scope = conversationScope(value.kind, value.id);
  if (value.address !== undefined && value.address !== scope.address || value.key !== undefined && value.key !== scope.key)
    throw TypeError('Inconsistent sharing audience scope');
  return scope;
}

// Deliberately narrow, explicit requests only. Praise is evidence of the actual
// words spoken, never a technical-style preference, mood or relationship score.
function explicitPreferences(text) {
  if (text.length > TEXT_LIMIT || /[“”「」『』"]|(?:转述|转告|引用|原话|(?:他|她|妈妈|爸爸|别人|有人|人家)(?:说|希望|让)|比如|例如|假如|如果|不是说|并不是|不要记录)/u.test(text)) return [];
  const result = new Map();
  const rules = [
    ['language', 'plain', /^(?:(?:可以)?(?:说|讲|写|解释)(?:得|的)?(?:再|更)?(?:简单|通俗|易懂|直白)(?:些|一些|一点|点)|(?:用|说|讲)(?:大白话|人话))(?:来(?:说|讲|解释))?$/u],
    ['language', 'plain', /^(?:(?:我)?(?:怎么)?(?:看|听)不懂(?:你(?:在)?(?:说|讲)(?:什么|啥|的(?:话|内容)?))?|越来越(?:深奥|难懂)(?:了)?)$/u],
    ['language', 'technical', /^(?:(?:可以)?(?:说|讲|写|解释)(?:得|的)?(?:再|更)?专业(?:些|一些|一点|点)|多讲(?:一些|点)?技术细节)$/u],
    ['jargon', 'less', /^(?:少用|少说|少讲|少点|少一点|别用(?:太多)?|不要用(?:太多)?|不用(?:那么多)?)(?:专业)?术语$/u],
    ['jargon', 'allowed', /^(?:(?:可以|尽管|多)(?:用|使用)(?:专业)?术语|不用刻意(?:避开|避免)(?:专业)?术语)$/u],
    ['cadence', 'wait-for-reply', /^(?:(?:别|不要)(?:连续|连着|接连)(?:给我)?(?:发|分享)(?:消息|分享|那么多)?|等我(?:回复|回你|回应)(?:以后|之后|后)?再(?:发|分享)(?:消息)?|(?:发|分享)(?:得)?慢一点)$/u],
    ['cadence', 'continuous-allowed', /^(?:(?:可以|尽管)(?:连续|连着)(?:给我)?(?:发|分享)(?:消息)?|(?:不用|不必)等我(?:回复|回你|回应)(?:再(?:发|分享))?)$/u],
    ['length', 'concise', /^(?:(?:平时|日常|正常)(?:的)?(?:交流|聊天|说话)(?:回复|回答)?(?:太长|太啰嗦)(?:了)?|(?:回答|回复|说|讲)(?:得|的)?(?:再|更)?(?:简短|简洁)(?:些|一些|一点|点)|(?:别|不要)(?:说|讲|写|回复)(?:得|的)?(?:太长|太啰嗦))$/u],
    ['length', 'detailed', /^(?:可以)?(?:回答|回复|说|讲|解释)(?:得|的)?(?:再|更)?详细(?:些|一些|一点|点)$/u],
    ['meta', 'less', /^(?:(?:别|不要|不用)(?:自我说明|解释你(?:为什么|是怎么)(?:说|回答|回复)(?:的)?)|直接(?:回答|说下一句)(?:就是很好的回答)?)$/u],
    ['meta', 'explain', /^(?:可以|需要)(?:自我说明|解释你(?:为什么|是怎么)(?:说|回答|回复)(?:的)?)$/u],
    // Welcoming sharing does not mean asking for a burst without a reply.
    ['sharing', 'welcome', /^(?:(?:可以|欢迎)?(?:在(?:家庭群|群里|家里)|给(?:家人|我们))?多分享(?:一些|一点|点)?|(?:我)?(?:喜欢|爱)看你分享(?:的(?:东西|内容))?)$/u],
    ['sharing', 'less', /^少分享(?:一些|一点|点)$/u],
  ];
  for (let clause of text.split(/[，,。.!！?？;；\n]+/u)) {
    clause = clause.trim().replace(/^(?:汐汐|小汐|汐宝|汐)[\s:：]*/u, '').trim();
    // Only conversational request prefixes; no reported third-party claims.
    for (let i = 0; i < 3; i++) clause = clause.replace(/^(?:我希望你|希望你|麻烦你|请你|你以后|你下次|以后|下次|今后|请|你)/u, '').trim();
    clause = clause.replace(/(?:就行|就好|好吗|好不好|吧|呀|啊|哦|哈|谢谢)$/u, '').trim();
    for (const [key, value, pattern] of rules) if (pattern.test(clause)) result.set(key, value);
  }
  return [...result].map(([key, value]) => ({key, value}));
}

function shortFeedback(text, preferences) {
  if (!text || text.length > TEXT_LIMIT) return false;
  if (preferences.length) return true;
  // A longer, directly attributable critique can still be useful raw evidence
  // even when its clauses are too contextual to promote into a durable rule.
  if (/正常交流/u.test(text) && /太长|太啰嗦/u.test(text)) return true;
  const compact = text.replace(/[\s，,。.!！?？~～]+/gu, '');
  return /^(?:汐汐|小汐|汐宝|汐)?(?:好|好的|好呀|好啊|收到|懂了|明白了|看懂了|没看懂|没听懂|看不懂|听不懂|不明白|太专业了|太复杂了|太难懂了|简单点|通俗点|少点术语|牛逼|牛哇|厉害|好厉害|太厉害了|真厉害|很棒|棒|不错|有意思|好有意思|好玩|好可爱|可爱|哈哈|哈哈哈|谢谢|谢谢分享|token在燃烧)$/iu.test(compact)
    || /^(?:汐汐|小汐|汐宝|汐)?(?:你(?:刚才|这次|分享|发的)|这条分享|这个分享|这次分享|刚才那条).{0,100}(?:看懂|听懂|不懂|难懂|术语|有意思|有趣|喜欢|专业|复杂|易懂|明白)/u.test(compact);
}

// Local reader only: no provider, transport, scheduler or emotional-state writes.
// Call inspect both before the opportunity and immediately before delivery.
export class LifeShareAudience {
  constructor({db, conversationDb, policy, clock = () => Date.now()}) {
    if (!db?.prepare || !conversationDb?.prepare || !object(policy) || typeof clock !== 'function')
      throw TypeError('Sharing audience needs its existing databases, policy and clock');
    this.db = db; this.conversationDb = conversationDb; this.clock = clock;
    this.policy = {...(policy.channels ?? policy)};
    if (!account(this.policy.bot_id)) throw TypeError('A verified bot ID is required');
    this.bots = new Set([this.policy.bot_id, ...(this.policy.peer_bot_ids ?? [])].map(account).filter(Boolean));
    db.exec(`CREATE TABLE IF NOT EXISTS life_share_feedback(
      scope TEXT NOT NULL, event TEXT NOT NULL, sender_id TEXT NOT NULL, at INTEGER NOT NULL,
      text TEXT, basis TEXT NOT NULL, preferences TEXT NOT NULL,
      PRIMARY KEY(scope,event,sender_id)
    ); CREATE INDEX IF NOT EXISTS life_share_feedback_scope_time ON life_share_feedback(scope,at);`);
  }

  shares(scope, now) {
    // Old unbound family rows belong to the configured family audience for this
    // read only. Never bind, rewrite or retry a historical delivery here.
    const shares = this.db.prepare(`SELECT id,attempt,updated,state FROM life_share_intents
      WHERE state IN ('sent','uncertain') AND ((target_kind=? AND target_id=?) OR
      (?='group' AND ?=? AND recipient='family' AND target_kind IS NULL AND target_id IS NULL))`)
      .all(scope.kind, scope.id, scope.kind, scope.id, String(this.policy.group_id ?? ''))
      .map(row => {
        const event = row.attempt ? (row.attempt.startsWith('proactive:') ? row.attempt : 'proactive:' + row.attempt) : null;
        const turn = event ? this.conversationDb.prepare("SELECT at FROM turns WHERE peer=? AND event=? AND role='assistant' AND state IN ('sent','uncertain')").get(scope.address, event) : null;
        // The conversation service can have a different injected clock in a
        // replay/test. An unusable turn timestamp must not erase a settled send.
        const at = Number.isSafeInteger(turn?.at) && turn.at >= 0 && turn.at <= now ? turn.at : row.updated;
        return {id: row.id, event, at};
      }).filter(row => Number.isSafeInteger(row.at) && row.at >= 0 && row.at <= now);
    // Before durable intents existed, exploration recorded activity_shares and
    // its proactive conversation turn. Both must agree on an attempted send;
    // only the turn supplies the recipient. A missing turn is not a family guess.
    if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='activity_shares'").get()) {
      const events = new Set(shares.map(row => row.event).filter(Boolean));
      for (const row of this.db.prepare("SELECT id,at FROM activity_shares WHERE state IN ('sent','uncertain')").all()) {
        const event = 'proactive:' + row.id;
        if (events.has(event)) continue;
        const turn = this.conversationDb.prepare("SELECT at FROM turns WHERE peer=? AND event=? AND role='assistant' AND state IN ('sent','uncertain')").get(scope.address, event);
        if (!turn) continue;
        const at = Number.isSafeInteger(turn.at) && turn.at >= 0 && turn.at <= now ? turn.at : row.at;
        if (!Number.isSafeInteger(at) || at < 0 || at > now) continue;
        events.add(event); shares.push({id: 'legacy-activity:' + row.id, event, at});
      }
    }
    return shares.sort((a, b) => a.at - b.at);
  }

  human(row, scope, now) {
    if (row.role !== 'user' || !Number.isSafeInteger(row.at) || row.at < 0 || row.at > now || typeof row.text !== 'string' || row.text.length > 200000) return null;
    let data; try {data = JSON.parse(row.text);} catch {return null;}
    const transport = data?.transport, sender = account(transport?.sender_id);
    if (!object(transport) || !sender || this.bots.has(sender) || transport.event_kind || transport.is_bot === true || data.routing?.sender_kind === 'peer-bot'
      || transport.conversation !== scope.address || String(transport.message_id) !== row.event || !Array.isArray(data.segments)
      || scope.kind === 'private' && sender !== scope.id) return null;
    const text = data.segments.filter(segment => segment?.type === 'text' && typeof segment.text === 'string').map(segment => segment.text).join('').trim();
    return {data, sender, text};
  }

  collect(scope, now, shares) {
    // A bounded short-term sample from already archived turns, never raw QQ,
    // model prose, forwarded content or image/card interpretation as feedback.
    const rows = this.conversationDb.prepare(`SELECT rowid,event,role,text,at FROM turns
      WHERE peer=? AND at>=? AND at<=? ORDER BY at DESC,rowid DESC LIMIT ?`)
      .all(scope.address, Math.max(0, now - SAMPLE_AGE), now, SAMPLE_LIMIT).reverse();
    const remembered = this.db.prepare('SELECT max(at) at FROM life_share_feedback WHERE scope=? AND at<=?').get(scope.address, now)?.at ?? null;
    let lastResponse = remembered;
    const accepted = new Map(), recent = [];
    const insert = this.db.prepare('INSERT OR IGNORE INTO life_share_feedback(scope,event,sender_id,at,text,basis,preferences) VALUES(?,?,?,?,?,?,?)');
    for (const row of rows) {
      const person = this.human(row, scope, now);
      if (!person) continue;
      const {data, sender, text} = person;
      const preferences = explicitPreferences(text), isFeedback = shortFeedback(text, preferences);
      let basis = scope.kind === 'private' ? 'private-correspondent' : null;
      if (scope.kind === 'group') {
        const focus = conversationFocus({scope, botId: String(this.policy.bot_id), peerBots: [...this.bots], current: row, recent});
        if (focus.attention === 'direct') basis = focus.reason;
        else if (focus.attention !== 'others' && isFeedback && data.transport.attention !== 'others') {
          const share = shares.findLast(item => item.at < row.at);
          if (share && row.at - share.at <= FEEDBACK_WINDOW) {
            // The preceding real turn must still be this share or this same
            // speaker's attributable reaction. A bot interjection or unrelated
            // exchange makes an unaddressed "great" ambiguous, so it cannot reset.
            const previous = this.conversationDb.prepare(`SELECT event,role,at FROM turns WHERE peer=? AND
              (at<? OR (at=? AND rowid<?)) AND at>=? ORDER BY at DESC,rowid DESC LIMIT 1`)
              .get(scope.address, row.at, row.at, row.rowid, share.at);
            const priorAccepted = previous?.role === 'user' ? accepted.get(previous.event) : null;
            if (!previous || previous.role === 'assistant' && previous.event === share.event
              || priorAccepted?.sender === sender && priorAccepted.share === share.id) basis = 'adjacent-share-feedback';
          }
        }
      }
      recent.push(row); if (recent.length > 24) recent.shift();
      if (!basis) continue;
      const share = shares.findLast(item => item.at < row.at);
      accepted.set(row.event, {sender, share: share?.id ?? null});
      insert.run(scope.address, row.event, sender, row.at, isFeedback ? text : null, basis, JSON.stringify(preferences));
      lastResponse = Math.max(lastResponse ?? 0, row.at);
    }
    return lastResponse;
  }

  inspect(value) {
    const scope = checkedScope(value), now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0) throw TypeError('Invalid sharing audience time');
    const shares = this.shares(scope, now), lastResponse = this.collect(scope, now, shares);
    const dayStart = Math.floor((now + OFFSET) / DAY) * DAY - OFFSET;
    const unanswered = shares.filter(share => share.at >= dayStart && (lastResponse === null || share.at >= lastResponse)).length;
    const recent_feedback = this.db.prepare(`SELECT event,sender_id,at,text,basis FROM life_share_feedback
      WHERE scope=? AND text IS NOT NULL AND at<=? ORDER BY at DESC,rowid DESC LIMIT 5`).all(scope.address, now).map(row => ({...row}));
    const preferences = [], seen = new Set();
    for (const row of this.db.prepare(`SELECT event,sender_id,at,preferences FROM life_share_feedback
      WHERE scope=? AND preferences<>'[]' AND at<=? ORDER BY at DESC,rowid DESC`).all(scope.address, now)) {
      for (const preference of JSON.parse(row.preferences)) {
        const key = row.sender_id + ':' + preference.key;
        if (seen.has(key)) continue;
        seen.add(key); preferences.push({...preference, scope: scope.address, sender_id: row.sender_id, event: row.event, at: row.at, source: 'explicit-human-request'});
      }
    }
    return {can_send: unanswered < 2, reason: unanswered < 2 ? 'audience-ready' : 'awaiting-human-response',
      unanswered_count: unanswered, recent_feedback, preferences, last_human_response_at: lastResponse};
  }

  refresh(scope) {return this.inspect(scope);}
}

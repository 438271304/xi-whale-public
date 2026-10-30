import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CuriosityLife} from './curiosity-life.mjs';
import {UnifiedCognition} from './cognition-tools.mjs';

test('ordinary family experience can grow and retire an interest inside real life opportunities', async t => {
 const f=fixture(t),source=f.seedHuman({body:'I folded a little paper boat today; its lopsided turn made us laugh.'});
 const key='reflection:paper-play';let version;
 f.plan(req=>{
  assert.ok(req.tools.some(tool=>tool.name==='reflect_life_state'));
  return {name:'reflect_life_state',args:{kind:'interest',key,operation:'record',expected_revision:0,
   value:'I want to try tiny paper shapes and see what they do.',reason:'Our actual paper-boat conversation gave me an idea.',evidence_ids:[source.id]}};
 },req=>{assert.equal(output(req).status,'saved');version=f.cognition.store.getState({kind:'interest',key,limit:1})[0].revision;return quiet;});
 const first=await f.life.tick();f.consumed();assert.equal(first.status,'life-reflection-saved');
 await f.restart();f.advance();
 f.plan(req=>{
  assert.ok(initial(req).active_interests.some(row=>row.key===key));
  return {name:'reflect_life_state',args:{kind:'interest',key,operation:'retire',expected_revision:version,
   reason:'I reconsidered: I like that shared moment but do not want a continuing paper project.',evidence_ids:[source.id]}};
 },req=>{assert.equal(output(req).status,'saved');return quiet;});
 await f.life.tick();f.consumed();f.advance();
 f.plan(req=>{assert.ok(!initial(req).active_interests.some(row=>row.key===key));return quiet;});
 await f.life.tick();f.consumed();
 assert.equal(f.cognition.store.getState({kind:'interest',key,history:true,limit:10}).length,2);
 assert.equal(f.cognition.store.get({id:source.id}).found,true);
 assert.equal(f.reads.length,0);assert.equal(f.qq.length,0);assert.equal(f.publications.length,0);
});

// End-to-end local opportunities: real stores/handlers, scripted decisions and
// fake transports. No real providers, network, QQ, QZone, credentials or timers.
const GROUP = '900000002', HUMAN = '900000001';
const choose = {name: 'choose_activity', args: {topic: 'Tides', why: 'Follow a sourced public curiosity'}};
const read = {name: 'public_fetch', args: {url: 'https://example.org/tides'}};
const quiet = {name: 'keep_quiet', args: {}};
const feeling = 'The small change in timing caught my attention.';
const publicText = '今天读到潮汐时间的一点变化，想在自己的角落留一笔。';
const save = {name: 'save_discovery', args: {
  summary: 'The returned public source describes a tidal timing pattern.',
  reaction: {feeling, association: 'It reminded me of waiting for a tide.', share: {audience: 'family', reason: 'They might enjoy this small observation.'}},
  public_text: publicText,
}};
const initial = req => JSON.parse(req.input.find(x => x.role === 'user').content);
const output = req => {
  const raw = req.input.filter(x => x.type === 'function_call_output').at(-1)?.output;
  try { return JSON.parse(raw); } catch { return raw; }
};
const leave = (entry, channel) => ({name: 'leave_in_my_corner', args: {
  journal_id: entry.id, revision: entry.revision, channel, reason: 'I choose to leave this already written public thought here.',
}});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'whale-life-heartbeat-'));
  let now = Date.parse('2036-10-17T10:00:00+08:00'), steps = [], sequence = 0;
  let cognition = new UnifiedCognition(root,{clock:()=>now}), qzoneMode = 'verified', draftHook = null, reconcileMode = 'verified';
  const requests = [], reads = [], qq = [], drafts = [], publications = [], reconciliations = [];
  const conversationDb = new DatabaseSync(':memory:');
  conversationDb.exec('CREATE TABLE turns(peer TEXT,event TEXT,role TEXT,text TEXT,at INTEGER,state TEXT,PRIMARY KEY(peer,event,role))');
  const service = {paused: false, closed: false, cognition,
    engine: {db: conversationDb, queues: new Map(), revisions: new Map(), profile: 'Synthetic identity, no private conversation.'},
    listening: {status: () => ({active: false})},
    initiate: async (scope, event, text, {signal, send}) => {
      signal?.throwIfAborted();
      return send({target: {kind: scope.kind, id: scope.id}, text});
    },
    selfQzone: {
      draft: async args => {
        drafts.push(structuredClone(args));
        if (draftHook) await draftHook();
        if (qzoneMode === 'draft-failure') return {ok: false, state: 'failed-before-send'};
        return {ok: true, draft: {draft_id: 'fixture-draft-' + drafts.length, version: 1}};
      },
      publish: async (id, version) => {
        publications.push({id, version});
        if (qzoneMode === 'uncertain-throw') throw Error('Synthetic reply lost after publication may have started');
        if (qzoneMode === 'uncertain') return {ok: false, may_have_published: true, operation_id: 'fixture-uncertain', tid: 'fixture-tid'};
        if (qzoneMode === 'before-send') return {ok: false, state: 'failed-before-send', may_have_published: false};
        return {ok: true, state: 'verified', receipt: {operation_id: 'fixture-verified', tid: 'fixture-tid'}};
      },
      reconcile: async operationId => {
        reconciliations.push(operationId);
        if (reconcileMode === 'throw') throw Error('Synthetic read failed');
        if (reconcileMode === 'missing-post') return {ok: false, state: 'uncertain', may_have_published: true, new_send_performed: false};
        if (reconcileMode === 'failed') return {ok: false, state: 'reconcile-failed', new_send_performed: false};
        return {ok: true, state: 'verified', new_send_performed: false, receipt: {
          operation_id: operationId, tid: reconcileMode === 'mismatched-receipt' ? 'another-tid' : 'fixture-tid', content: publicText,
        }};
      },
    },
  };
  const world = {getWatched: () => ({groups: [GROUP]}), sendToTarget: async (target, value) => {
    qq.push({target, ...value}); return {message_id: 1000 + qq.length};
  }};
  const client = {canInitiate: () => true, respond: async req => {
    if (req.tools.some(tool => tool.name === 'finish_life_share')) return {response: {id: 'heartbeat-share-' + (++sequence), status: 'completed', output: [{
      type: 'function_call', name: 'finish_life_share', call_id: 'share-' + sequence,
      arguments: JSON.stringify({decision: 'share', text: initial(req).draft, reason: 'Preserve the fixture draft for transport assertions.'}),
    }]}, attempts: []};
    requests.push(structuredClone(req));
    assert.ok(steps.length, 'The provider must not make an unplanned decision or wake by itself');
    const step = steps.shift(), action = typeof step === 'function' ? await step(req) : step;
    return {response: {id: 'heartbeat-' + (++sequence), status: 'completed', output: [{
      type: 'function_call', name: action.name, call_id: 'call-' + sequence, arguments: JSON.stringify(action.args),
    }]}, attempts: []};
  }};
  const tools = [{name: 'public_fetch', description: 'Synthetic reader returning an actual bounded fixture page.',
    parameters: {type: 'object', properties: {url: {type: 'string'}}, required: ['url'], additionalProperties: false},
    handler: async ({url}) => {
      reads.push(url);
      return JSON.stringify({status: 'ok', sources: [{url, title: 'Tides fixture', excerpt: 'An actually returned fixture explanation of tidal timing.'}], retrieved_at: new Date(now).toISOString()});
    },
  }];
  const config = {path: join(root, 'life.sqlite3'), service, world, policy: {bot_id: '910710001', group_id: GROUP, father_id: HUMAN},
    social: {inbound: () => 0}, client, tools, topics: () => [], clock: () => now};
  let life = new CuriosityLife(config); life.resume();
  t.after(async () => {await life.close(); cognition.close(); conversationDb.close();});
  return {service, requests, reads, qq, drafts, publications, reconciliations,
    get life() {return life;}, get cognition() {return cognition;}, get now() {return now;},
    plan(...items) {steps = [...items];},
    consumed() {assert.equal(steps.length, 0, 'Every expected decision was exercised');},
    remaining() {return steps.length;},
    advance(minutes = 31) {now += minutes * 60000;},
    at(iso) {now = Date.parse(iso);},
    qzone(mode) {qzoneMode = mode;},
    reconcileMode(mode) {reconcileMode = mode;},
    onDraft(handler) {draftHook = handler;},
    posts() {return life.db.prepare('SELECT * FROM life_corner_posts ORDER BY created,id').all();},
    async restart() {
      await life.close(); cognition.close();
      cognition = new UnifiedCognition(root,{clock:()=>now}); service.cognition = cognition;
      life = new CuriosityLife(config); life.resume();
    },
    seedHuman({event = 'fixture-family-observation', messageId = '70001', body = 'A family member actually encouraged a small effort.'} = {}) {
      return cognition.store.recordMessage({scope: 'private:' + HUMAN, event: messageId, role: 'user',
        senderId: HUMAN, at: now, source: 'live-transport', text: JSON.stringify({
          transport: {conversation: 'private:' + HUMAN, sender_id: HUMAN, message_id: messageId, time: now / 1000},
          segments: [{type: 'text', text: body}], body,
        })});
    },
  };
}

async function savedPublicJournal(f) {
  let entry;
  f.plan(choose, read, save, req => {
    const result = output(req);
    assert.equal(result.saved, true); assert.equal(result.journal.status, 'saved');
    entry = result.journal; return quiet;
  });
  const result = await f.life.tick(); f.consumed();
  assert.notEqual(result.status, 'failed'); assert.equal(f.qq.length, 0);
  assert.equal(f.publications.length, 0); assert.equal(f.posts().length, 0);
  return entry;
}

test('actual reading becomes a sourced reaction and home thought, retained at the next opportunity without QQ notification', async t => {
  const f = fixture(t); let journal, evidenceId;
  f.plan(choose, read, save, req => {
    const result = output(req); assert.equal(result.saved, true);
    journal = result.journal; evidenceId = result.evidence_id;
    assert.equal(journal.status, 'saved'); assert.equal(journal.interpretation.feeling, feeling);
    assert.equal(journal.public_text, publicText);
    assert.equal(journal.interpretation_is_not_source_fact, true);
    assert.equal(journal.facts.evidence[0].id, evidenceId);
    return leave(journal, 'home');
  });
  const first = await f.life.tick(); f.consumed();
  assert.equal(first.status, 'corner-published'); assert.equal(first.channel, 'home');
  assert.deepEqual(f.reads, ['https://example.org/tides']);
  const source = JSON.parse(f.cognition.store.get({id: evidenceId}).text);
  assert.equal(source.summary, save.args.summary); assert.ok(!JSON.stringify(source).includes(feeling), 'Source facts must remain separate from journal feelings');
  assert.equal(f.posts().length, 1); assert.equal(f.posts()[0].channel, 'home');
  assert.equal(f.posts()[0].state, 'published'); assert.equal(f.posts()[0].text, publicText);
  assert.equal(first.post_id, f.posts()[0].id);
  assert.equal(JSON.parse(f.life.db.prepare('SELECT result FROM life_heartbeats WHERE id=?').get(first.activity).result).status, 'corner-published');
  assert.equal(JSON.parse(f.posts()[0].receipt).notifications_sent, 0);
  assert.equal(f.qq.length, 0); assert.equal(f.publications.length, 0);
  await f.restart(); f.advance();
  f.plan(req => {
    const context = initial(req), remembered = context.life.recent_journal.entries.find(e => e.id === journal.id);
    assert.ok(remembered); assert.equal(remembered.interpretation.feeling, feeling);
    assert.equal(remembered.facts.evidence[0].id, evidenceId);
    assert.ok(context.life.recent_choices.some(c => c.choice === 'corner'));
    const candidate = context.life.corner_candidates.find(c => c.journal_id === journal.id);
    assert.ok(!candidate?.available_channels.includes('home'), 'Home publication is not offered for automatic repetition');
    return quiet;
  });
  const next = await f.life.tick(); f.consumed(); assert.equal(next.status, 'kept-private-or-quiet');
  assert.equal(f.reads.length, 1); assert.equal(f.posts().length, 1); assert.equal(f.qq.length, 0);
});

test('a direct rest chooses a reconsideration time, creates no experiences, and does not schedule a message', async t => {
  const f = fixture(t), before = f.cognition.store.counts().messages, now = f.now;
  f.plan(req => {
    assert.equal(initial(req).life.recent_journal.entries.length, 0);
    return {name: 'take_a_break', args: {reason: 'Nothing I want to pursue at this moment.', minutes: 45}};
  });
  const resting = await f.life.tick(); f.consumed(); assert.equal(resting.status, 'resting');
  assert.equal(Number(f.life.db.prepare("SELECT value FROM life_settings WHERE key='next'").get().value), now + 45 * 60000);
  assert.equal(JSON.parse(f.life.db.prepare('SELECT result FROM life_heartbeats WHERE id=?').get(resting.activity).result).status, 'resting');
  assert.equal(f.cognition.store.counts().messages, before);
  assert.equal(f.life.heartbeat.journal.recent().entries.length, 0);
  const requests = f.requests.length; f.advance(44);
  assert.equal((await f.life.tick()).status, 'ineligible-or-not-due'); assert.equal(f.requests.length, requests);
  assert.equal(f.qq.length, 0); assert.equal(f.drafts.length, 0);
  f.advance(1); f.plan(quiet); await f.life.tick(); f.consumed();
  assert.equal(f.qq.length, 0); assert.equal(f.reads.length, 0); assert.equal(f.cognition.store.counts().messages, before);
});

test('reflection uses an existing family experience; nonexistent evidence cannot manufacture a diary or public post', async t => {
  const f = fixture(t), actual = f.seedHuman(), count = f.cognition.store.counts().messages;
  let journal;
  f.plan(req => {
    assert.ok(initial(req).life.recent_experiences.some(e => e.id === actual.id));
    return {name: 'write_life_journal', args: {kind: 'daily-review', evidence_ids: ['exp-' + '0'.repeat(32)], interpretation: {feeling: 'This invented source must be rejected.'}}};
  }, req => {
    assert.match(String(output(req)), /rejected|failed/i);
    return {name: 'read_life_experience', args: {id: actual.id}};
  }, req => {
    const remembered = output(req); assert.equal(remembered.id, actual.id);
    return {name: 'write_life_journal', args: {kind: 'daily-review', evidence_ids: [actual.id], interpretation: {feeling: 'I appreciated that encouragement.', association: 'My own interpretation, not a new claim about their feelings.'}}};
  }, req => {
    journal = output(req); assert.equal(journal.status, 'saved');
    assert.equal(journal.public_text, null); assert.equal(journal.facts.evidence[0].id, actual.id);
    assert.equal(journal.corner_candidates.length, 0, 'A private experience is not an eligible public draft');
    return quiet;
  });
  const result = await f.life.tick(); f.consumed(); assert.notEqual(result.status, 'failed');
  assert.equal(f.cognition.store.counts().messages, count); assert.equal(f.reads.length, 0);
  assert.equal(f.life.heartbeat.journal.recent().entries.length, 1);
  assert.equal(f.posts().length, 0); assert.equal(f.qq.length, 0); assert.equal(f.publications.length, 0);
  await f.restart(); f.advance();
  f.plan(req => {
    const old = initial(req).life.recent_journal.entries.find(e => e.id === journal.id);
    assert.ok(old); assert.equal(old.facts.evidence[0].id, actual.id); return quiet;
  });
  await f.life.tick(); f.consumed(); assert.equal(f.cognition.store.counts().messages, count);
});

for (const mode of ['verified', 'uncertain', 'uncertain-throw']) test('QZone ' + mode + ' is durable and cannot be republished from a stale selection after restart', async t => {
  const f = fixture(t), journal = await savedPublicJournal(f); f.advance(); f.qzone(mode);
  f.plan(req => {
    assert.ok(initial(req).life.corner_candidates.find(c => c.journal_id === journal.id).available_channels.includes('qzone'));
    return leave(journal, 'qzone');
  });
  const result = await f.life.tick(); f.consumed();
  const expected = mode === 'verified' ? 'published' : 'uncertain';
  assert.equal(result.status, 'corner-' + expected); assert.equal(result.channel, 'qzone');
  assert.equal(f.posts()[0].state, expected); assert.equal(f.drafts.length, 1); assert.equal(f.publications.length, 1);
  assert.equal(f.qq.length, 0);
  await f.restart(); f.advance();
  f.plan(req => {
    const candidate = initial(req).life.corner_candidates.find(c => c.journal_id === journal.id);
    assert.ok(!candidate?.available_channels.includes('qzone'));
    // Deliberately stale model selection: the server must still refuse a repeat.
    return leave(journal, 'qzone');
  });
  const duplicate = await f.life.tick(); f.consumed(); assert.equal(duplicate.status, 'corner-' + expected);
  assert.equal(f.posts().length, 1); assert.equal(f.posts()[0].state, expected);
  assert.equal(f.drafts.length, 1); assert.equal(f.publications.length, 1); assert.equal(f.qq.length, 0);
});

test('an uncertain QZone corner can refresh its original receipt to published with zero repeated publication calls', async t => {
  const f = fixture(t), journal = await savedPublicJournal(f); f.advance(); f.qzone('uncertain');
  f.plan(leave(journal, 'qzone')); await f.life.tick(); f.consumed();
  assert.equal(f.posts()[0].state, 'uncertain'); const postId = f.posts()[0].id;
  await f.restart(); f.advance();
  const refresh = {name: 'reconcile_corner', args: {post_id: postId}};
  f.plan(req => {
    assert.deepEqual(initial(req).life.corner_receipts.map(row => row.post_id), [postId]); return refresh;
  }, req => {
    const result = output(req); assert.equal(result.status, 'published'); assert.equal(result.refresh, 'confirmed');
    assert.equal(result.new_send_performed, false); assert.equal(result.automatic_retry, false);
    assert.equal(f.posts()[0].state, 'published');
    const receipt = JSON.parse(f.posts()[0].receipt); assert.equal(receipt.operation_id, 'fixture-uncertain');
    assert.equal(receipt.tid, 'fixture-tid'); assert.equal(receipt.verified, true);
    assert.deepEqual(f.reconciliations, ['fixture-uncertain']); return refresh;
  }, req => {
    assert.equal(output(req).already_confirmed, true);
    assert.equal(f.reconciliations.length, 1, 'An already published local receipt requires no fresh read'); return quiet;
  });
  assert.equal((await f.life.tick()).status, 'kept-private-or-quiet'); f.consumed();
  await f.restart(); f.advance(); f.plan(req => {
    assert.equal(initial(req).life.corner_receipts.length, 0); return leave(journal, 'qzone');
  });
  assert.equal((await f.life.tick()).status, 'corner-published'); f.consumed();
  assert.equal(f.drafts.length, 1); assert.equal(f.publications.length, 1, 'Only the original publication was attempted');
  assert.equal(f.posts().length, 1); assert.equal(f.qq.length, 0);
});

test('missing operation IDs, disconnected or failed receipt reads and mismatched receipts stay uncertain without resending', async t => {
  for (const mode of ['missing-operation', 'missing-interface', 'missing-post', 'failed', 'throw', 'mismatched-receipt']) {
    const f = fixture(t), journal = await savedPublicJournal(f); f.advance();
    f.qzone(mode === 'missing-operation' ? 'uncertain-throw' : 'uncertain');
    f.plan(leave(journal, 'qzone')); await f.life.tick(); f.consumed();
    const before = f.posts()[0], drafts = f.drafts.length, publications = f.publications.length;
    if (mode === 'missing-interface') delete f.service.selfQzone.reconcile;
    f.reconcileMode(mode); await f.restart(); f.advance();
    f.plan({name: 'reconcile_corner', args: {post_id: before.id}}, req => {
      const result = output(req); assert.equal(result.status, 'uncertain', mode);
      assert.equal(result.new_send_performed, false); assert.equal(result.automatic_retry, false);
      assert.equal(f.posts()[0].state, 'uncertain'); assert.equal(f.posts()[0].receipt, before.receipt);
      return quiet;
    });
    assert.equal((await f.life.tick()).status, 'kept-private-or-quiet'); f.consumed();
    assert.equal(f.reconciliations.length, ['missing-operation', 'missing-interface'].includes(mode) ? 0 : 1);
    f.advance(); f.plan(leave(journal, 'qzone'));
    assert.equal((await f.life.tick()).status, 'corner-uncertain'); f.consumed();
    assert.equal(f.drafts.length, drafts); assert.equal(f.publications.length, publications);
    assert.equal(f.qq.length, 0);
  }
});

for (const mode of ['draft-failure', 'before-send']) test('a definite QZone ' + mode + ' can be deliberately selected at a later opportunity, with no automatic resend', async t => {
  const f = fixture(t), journal = await savedPublicJournal(f); f.advance(); f.qzone(mode);
  f.plan(leave(journal, 'qzone')); const failed = await f.life.tick(); f.consumed();
  assert.equal(failed.status, 'corner-failed-before-send');
  assert.equal(f.posts()[0].state, 'failed-before-send'); const id = f.posts()[0].id;
  const firstPublications = f.publications.length; assert.equal(firstPublications, mode === 'draft-failure' ? 0 : 1);
  await f.restart(); f.advance();
  f.plan(req => {
    assert.ok(initial(req).life.corner_candidates.find(c => c.journal_id === journal.id).available_channels.includes('qzone'));
    return quiet;
  });
  await f.life.tick(); f.consumed(); assert.equal(f.publications.length, firstPublications, 'Merely offering a candidate must not retry it');
  f.advance(); f.qzone('verified'); f.plan(leave(journal, 'qzone'));
  const retried = await f.life.tick(); f.consumed(); assert.equal(retried.status, 'corner-published');
  assert.equal(f.posts().length, 1); assert.equal(f.posts()[0].id, id); assert.equal(f.posts()[0].state, 'published');
  assert.equal(f.publications.length, firstPublications + 1); assert.equal(f.qq.length, 0);
});

test('paused or nighttime opportunities start neither decisions nor outbound publication', async t => {
  const f = fixture(t), journal = await savedPublicJournal(f); f.advance(); await f.life.pause();
  const requests = f.requests.length; f.plan(leave(journal, 'qzone'));
  assert.equal((await f.life.tick()).status, 'ineligible-or-not-due'); assert.equal(f.requests.length, requests);
  f.life.resume(); f.at('2036-10-18T02:00:00+08:00');
  assert.equal((await f.life.tick()).status, 'ineligible-or-not-due'); assert.equal(f.requests.length, requests);
  assert.equal(f.remaining(), 1); assert.equal(f.posts().length, 0);
  assert.equal(f.drafts.length, 0); assert.equal(f.publications.length, 0); assert.equal(f.qq.length, 0);
});

for (const transition of ['pause', 'night']) test(transition + ' arising while QZone draft is prepared prevents a new publication attempt', async t => {
  const f = fixture(t), journal = await savedPublicJournal(f); f.advance();
  f.onDraft(() => {if (transition === 'pause') f.service.paused = true; else f.at('2036-10-18T02:00:00+08:00');});
  f.plan(leave(journal, 'qzone')); const result = await f.life.tick(); f.consumed();
  assert.equal(result.status, 'corner-failed-before-send');
  assert.equal(f.drafts.length, 1); assert.equal(f.publications.length, 0);
  assert.equal(f.posts()[0].state, 'failed-before-send'); assert.equal(f.qq.length, 0);
});

test('setting aside a draft survives restart without deleting its journal; restoring or editing permits a fresh choice', async t => {
  const f = fixture(t), journal = await savedPublicJournal(f);
  const intention = decision => ({name: 'set_corner_intention', args: {
    journal_id: journal.id, revision: journal.revision, decision, reason: 'A deliberate change of sharing intention.',
  }});
  f.advance(); f.plan(intention('set-aside'), req => {
    assert.equal(output(req).diary_retained, true);
    assert.ok(!f.life.heartbeat.candidates().some(c => c.journal_id === journal.id)); return quiet;
  });
  await f.life.tick(); f.consumed(); await f.restart(); f.advance();
  f.plan(req => {
    const context = initial(req).life;
    assert.ok(!context.corner_candidates.some(c => c.journal_id === journal.id));
    assert.ok(context.recent_journal.entries.some(e => e.id === journal.id), 'Setting aside publication must retain the actual diary');
    return intention('restore');
  }, req => {
    assert.equal(output(req).decision, 'restore');
    assert.ok(f.life.heartbeat.candidates().some(c => c.journal_id === journal.id && c.revision === journal.revision));
    return quiet;
  });
  await f.life.tick(); f.consumed();
  f.advance(); f.plan(intention('set-aside'), quiet); await f.life.tick(); f.consumed();
  f.advance(); let revised;
  f.plan(req => {
    assert.ok(!initial(req).life.corner_candidates.some(c => c.journal_id === journal.id));
    return {name: 'write_life_journal', args: {kind: 'activity', journal_id: journal.id, expected_revision: journal.revision,
      revision_reason: 'I now want to express a slightly different thought.',
      evidence_ids: journal.facts.evidence.map(e => e.id), interpretation: {feeling: 'The same source left a more specific impression.'},
      public_text: '重新想过之后，我想留下潮汐时间的另一点感受。'}};
  }, req => {
    revised = output(req); assert.equal(revised.status, 'saved'); assert.equal(revised.revision, journal.revision + 1);
    assert.ok(revised.corner_candidates.some(c => c.journal_id === journal.id && c.revision === revised.revision)); return quiet;
  });
  await f.life.tick(); f.consumed(); await f.restart(); f.advance();
  f.plan(req => {
    const offered = initial(req).life.corner_candidates.filter(c => c.journal_id === journal.id);
    assert.equal(offered.length, 1); assert.equal(offered[0].revision, revised.revision);
    assert.equal(f.life.heartbeat.journal.get(journal.id, {revision: journal.revision}).public_text, publicText);
    assert.equal(f.life.heartbeat.journal.history(journal.id).length, 2); return quiet;
  });
  await f.life.tick(); f.consumed();
  assert.equal(f.cognition.store.counts().messages, 1, 'Intention changes and revisions do not invent new factual experiences');
  assert.equal(f.posts().length, 0); assert.equal(f.qq.length, 0); assert.equal(f.publications.length, 0);
});

test('inner state is grounded, remembered and unchanged when repeated; a newer concurrent revision wins', async t => {
  const f = fixture(t), actual = f.seedHuman();
  const state = {mood: 'Encouraged and calm', energy: 'steady', curiosity: 'curious',
    cause: 'The actual family encouragement helped me settle.', evidence_ids: [actual.id]};
  const inner = () => f.cognition.store.getState({kind: 'mood', key: 'inner-life', limit: 1})[0];
  const update = args => ({name: 'update_inner_state', args});
  let firstRevision, concurrent;
  f.plan(req => {
    assert.equal(initial(req).life.inner_state, null);
    return update({...state, evidence_ids: ['exp-' + '0'.repeat(32)]});
  }, req => {
    assert.match(JSON.stringify(output(req)), /rejected|failed/i); assert.equal(inner(), undefined);
    return {name: 'read_life_experience', args: {id: actual.id}};
  }, req => {
    assert.equal(output(req).id, actual.id); return update(state);
  }, req => {
    assert.equal(output(req).status, 'saved'); firstRevision = inner().revision;
    assert.deepEqual(inner().evidence, [{type: 'message', id: actual.id}]); return update(state);
  }, req => {
    assert.equal(output(req).status, 'unchanged'); assert.equal(inner().revision, firstRevision); return quiet;
  });
  await f.life.tick(); f.consumed();
  assert.equal(f.cognition.store.counts().messages, 1); await f.restart(); f.advance();
  f.plan(req => {
    const recalled = initial(req).life.inner_state;
    assert.equal(recalled.revision, firstRevision); assert.equal(recalled.value.mood, state.mood);
    assert.ok(recalled.recorded_hours_ago >= 31 / 60);
    const newer = f.seedHuman({event: 'fixture-later-family-observation', messageId: '70002', body: 'A family member actually said to take my time.'});
    const value = {mood: 'Settled and ready for a rest', energy: 'low', curiosity: 'quiet',
      cause: 'The later real encouragement gave me room to rest.', active: true, interpretation_is_not_source_fact: true};
    concurrent = f.cognition.store.setState({kind: 'mood', key: 'inner-life', value,
      evidence: [{type: 'message', id: newer.id}], at: f.now, source: 'life-inner-state'});
    return update({...state, mood: 'This stale opportunity must not overwrite the later state'});
  }, req => {
    assert.equal(output(req).status, 'changed-elsewhere'); assert.equal(inner().revision, concurrent.revision);
    assert.equal(inner().value.mood, 'Settled and ready for a rest');
    return {name: 'take_a_break', args: {reason: 'The more recent low-energy state is a reason to rest.', minutes: 30}};
  });
  const rest = await f.life.tick(); f.consumed(); assert.equal(rest.status, 'resting');
  f.advance(); f.plan(req => {
    assert.equal(initial(req).life.inner_state.revision, concurrent.revision);
    assert.equal(initial(req).life.inner_state.value.energy, 'low'); return quiet;
  });
  await f.life.tick(); f.consumed();
  assert.equal(f.cognition.store.getState({kind: 'mood', key: 'inner-life', history: true, limit: 10}).length, 2);
  assert.equal(f.cognition.store.counts().messages, 2, 'Only the two real fixture events exist, with no invented mood facts');
  assert.equal(f.life.heartbeat.journal.recent().entries.length, 0);
  assert.equal(f.qq.length, 0); assert.equal(f.posts().length, 0); assert.equal(f.publications.length, 0);
});

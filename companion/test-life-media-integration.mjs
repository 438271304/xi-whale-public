// Whole life-contact -> composer -> durable intent -> guarded single transport
// -> receipt/memory path. Real modules and temporary stores, fake model/QQ only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ConversationService} from './conversation-service.mjs';
import {CuriosityLife} from './curiosity-life.mjs';
import {guardQQWorld} from './qq-event-policy.mjs';
import {conversationScope} from './conversation-scope.mjs';

const BOT = '910450001', FATHER = '910450002', MOTHER = '910450003', GROUP = '910460001';
const DAY = Date.parse('2036-10-17T12:00:00+08:00');
const ownText = 'Synthetic saved work: a little blue card draft was saved. It has not been run or published.';
const draft = '妈妈，我刚把自己的小卡片草稿存好了，想给它留一点蓝色。';
const expression = '妈妈，我的小卡片先留了一个蓝色角落，看着就想往里面藏颗糖。';
const input = req => JSON.parse(req.input.find(item => item.role === 'user').content);
const legacyBytes = () => readFileSync(new URL('./assets/stickers/deepseek-bixin.png', import.meta.url));

function fixture(t, {withImage = true, failure = null} = {}) {
 const root = mkdtempSync(join(tmpdir(), 'whale-life-media-integration-'));
 let now = DAY, watched = {groups: [Number(GROUP)], users: []}, service, life, evidenceId, imageId, sequence = 0, mode = 'contact';
 const wire = [], events = [], textRoute = [], lifeRequests = [], composerRequests = [], outcomes = [];
 const policy = {bot_id: BOT, father_id: FATHER, mother_id: MOTHER, group_id: GROUP, group_ids: [GROUP], friend_private_enabled: true, follow_configured_groups: true};
 const receipt = {message_id: 945001};
 const world = {
  handleEvent: async () => ({accepted: true}), getWatched: () => watched, setWatched: (groups, users) => {watched = {groups, users};}, knownMessages: new Map(),
  driver: {callApi: async (action, args) => {
   if (action === 'get_friend_list') return [{user_id: FATHER}, {user_id: MOTHER}];
   assert.equal(action, 'send_private_msg'); assert.equal(args.user_id, Number(MOTHER));
   wire.push({action, args}); if (failure === 'driver') throw Error('Synthetic uncertain driver failure'); return receipt;
  }},
  sendToTarget: async (destination, value) => {textRoute.push({destination, value}); throw Error('The selected attachment expression must not fall back to text transport');},
 };
 guardQQWorld(world, policy, () => new Date(now));
 world.host = {pushEvent: async event => {events.push(event); if (failure === 'host') throw Error('Synthetic local receipt record failure'); return {ts: event.ts};}};
 const social = {inbound: () => 0, availability: {status: () => ({active: false})}};
 const reply = (name, args, prefix) => ({response: {id: prefix + (++sequence), status: 'completed', output: [
  {type: 'function_call', name, call_id: 'fixture-call-' + sequence, arguments: JSON.stringify(args)},
 ]}, attempts: []});
 const client = {
  canInitiate: () => true,
  generationSettings: () => ({model: 'deepseek-flash', thinking: true, reasoningEffort: 'high', maxTokens: 8192}),
  respond: async req => {
   if (req.tools.some(tool => tool.name === 'finish_life_share')) {
    composerRequests.push(req); const round = composerRequests.length, context = input(req);
    assert.equal(context.recipient, 'mother'); assert.equal(context.draft, draft);
    assert.ok(context.evidence.some(item => item.id === evidenceId && item.text.includes('Synthetic saved work')));
    if (round === 1) return reply('find_life_share_faces', {query: '66'}, 'compose-');
    const lastOutput = req.input.filter(item => item.type === 'function_call_output').at(-1);
    assert.ok(lastOutput, 'composer lookup must return a real local tool result');
    const result = JSON.parse(lastOutput.output);
    if (round === 2) {
     assert.equal(result.matches[0].id, '66');
     if (withImage) return reply('list_life_share_images', {limit: 4}, 'compose-');
    }
    if (withImage) assert.ok(result.items.some(item => item.public_image_id === imageId && item.source.kind === 'approved-legacy-sticker'));
    return reply('finish_life_share', {decision: 'share', text: expression, reason: 'One small association from my actually saved draft.',
     attachments: {native_face_ids: ['66'], ...(withImage ? {public_image_id: imageId} : {})}}, 'compose-');
   }
   lifeRequests.push(req); const context = input(req);
   assert.ok(req.tools.some(tool => tool.name === 'reach_out_from_life'));
   if (mode === 'quiet') {assert.equal(context.pending_discoveries.length, 0); return reply('keep_quiet', {}, 'life-');}
   return reply('reach_out_from_life', {recipient: 'mother', reason: 'My own saved little card made me want to talk to Mom.', text: draft, evidence_ids: [evidenceId]}, 'life-');
  },
 };
 function open() {
  service = new ConversationService({root: join(root, 'conversation'), client, publicProfile: 'Synthetic independent companion. Use only the returned source facts.', botId: BOT, guardianIds: [FATHER, MOTHER],
   isAllowed: () => true, wait: async () => {}, send: async () => {throw Error('Ordinary conversation send must not be used');},
   imageAnalyzer: {analyze: async () => {throw Error('Existing image choice must not trigger analysis');}},
   stickerOptions: {request: async () => {throw Error('Existing image choice must not download');}, prepare: async () => {throw Error('Existing image choice must not decode again');}}});
  service.social = social;
  imageId = service.media.importApprovedSeed(legacyBytes(), 'Existing approved synthetic fixture label').id;
  const own = service.cognition.store.recordMessage({scope: 'unknown', event: 'synthetic-own-blue-card', role: 'self', at: DAY - 1800000,
   source: 'own-workroom-change', text: ownText, metadata: {project_id: 'synthetic-card', version: 1, execution_verified: false}});
  evidenceId = own.id;
  life = new CuriosityLife({path: join(root, 'life.sqlite3'), service, social, world, policy, client, clock: () => now, topics: () => [], tools: []});
  life.resume();
 }
 open();
 t.after(async () => {await life.close(); await service.close(); assert.equal(textRoute.length, 0);});
 return {root, world, wire, events, textRoute, receipt, lifeRequests, composerRequests, outcomes,
  get life() {return life;}, get service() {return service;}, get imageId() {return imageId;}, get evidenceId() {return evidenceId;},
  intent: () => {const row = life.db.prepare('SELECT id FROM life_share_intents').get(); return row ? life.continuity.get(row.id) : null;},
  turns: () => service.engine.db.prepare("SELECT peer,event,state,text FROM turns WHERE role='assistant' AND event LIKE 'proactive:%'").all(),
  sent: () => service.cognition.store.db.prepare("SELECT id,scope,event,state FROM experiences WHERE role='assistant' AND event LIKE 'proactive:%'").all(),
  async restartQuiet() {await life.close(); await service.close(); now += 31 * 60000; mode = 'quiet'; open();},
 };
}

for (const withImage of [false, true]) test('whole life-contact path persists and sends one native face' + (withImage ? ' with the exact approved public image' : ' without a forced image'), async t => {
 const f = fixture(t, {withImage});
 await assert.rejects(f.world.sendToTarget({kind: 'private', id: MOTHER}, {text: 'No fresh reply lease'}), /fresh message/);
 const result = await f.life.tick();
 assert.equal(result.status, 'sent'); assert.equal(result.memory, 'recorded'); assert.equal(f.lifeRequests.length, 1);
 assert.equal(f.composerRequests.length, withImage ? 3 : 2); assert.equal(f.wire.length, 1); assert.equal(f.events.length, 1);
 const message = f.wire[0].args.message;
 assert.deepEqual(message.map(item => item.type), withImage ? ['text', 'face', 'image'] : ['text', 'face']);
 assert.equal(message[0].data.text, expression); assert.equal(message[1].data.id, '66');
 if (withImage) assert.equal(message[2].data.file, 'base64://' + legacyBytes().toString('base64'));
 const intent = f.intent(), receipt = JSON.parse(intent.receipt);
 assert.equal(intent.state, 'sent'); assert.equal(intent.recipient, 'mother'); assert.equal(intent.target_id, MOTHER);
 assert.deepEqual(intent.media_plan.native_face_ids, ['66']); assert.equal(intent.media_plan.public_image_id, withImage ? f.imageId : undefined);
 assert.equal(receipt.message_id, f.receipt.message_id); assert.equal(receipt.message_id_returned, true); assert.equal(receipt.scope, 'private:' + MOTHER);
 assert.deepEqual(receipt.media_plan, intent.media_plan); assert.equal(typeof f.life.db.prepare('SELECT media_plan FROM life_share_intents').get().media_plan, 'string');
 assert.equal(f.life.db.prepare('SELECT count(*) n FROM discoveries').get().n, 0, 'personal contact must not invent public exploration');
 const contact = JSON.parse(f.service.cognition.store.get({id: intent.evidence}).text);
 assert.equal(contact.kind, 'contact-intention'); assert.equal(contact.source_refs[0].id, f.evidenceId);
 const turns = f.turns(); assert.equal(turns.length, 1); assert.equal(turns[0].state, 'sent'); assert.equal(turns[0].peer, 'private:' + MOTHER);
 const sent = f.sent(); assert.equal(sent.length, 1); assert.equal(sent[0].state, 'sent'); assert.equal(sent[0].scope, 'private:' + MOTHER);
 const remembered = f.service.cognition.store.get({id: sent[0].id}), body = JSON.parse(remembered.text);
 assert.equal(body.body, expression); assert.deepEqual(body.expression_media, intent.media_plan);
 assert.ok(remembered.sources.some(source => source.source === 'acknowledged-delivery'));
 assert.equal(f.events[0].meta.message_id, f.receipt.message_id); assert.equal(f.events[0].meta.life_initiation, true);
 const modelCount = f.composerRequests.length;
 assert.equal((await f.life.deliver(intent, conversationScope('private', MOTHER), new AbortController().signal)).status, 'not-pending-no-send');
 assert.equal(f.wire.length, 1); assert.equal(f.composerRequests.length, modelCount);
 await f.restartQuiet(); assert.equal((await f.life.tick()).status, 'kept-private-or-quiet');
 assert.equal(f.wire.length, 1); assert.equal(f.intent().state, 'sent');
});

for (const failure of ['driver', 'host']) test(failure + ' failure leaves the actual service turn and media intent uncertain, including after restart', async t => {
 const f = fixture(t, {failure});
 const result = await f.life.tick();
 assert.equal(result.status, 'uncertain-no-retry'); assert.equal(f.wire.length, 1); assert.equal(f.events.length, failure === 'host' ? 1 : 0);
 const intent = f.intent(); assert.equal(intent.state, 'uncertain'); assert.ok(intent.media_plan.public_image_id); assert.equal(intent.receipt, null);
 assert.deepEqual(f.turns().map(row => row.state), ['uncertain']);
 assert.deepEqual(f.life.db.prepare('SELECT state FROM activity_shares').all().map(row => row.state), ['uncertain']);
 assert.equal(f.sent().filter(row => row.state === 'sent').length, 0, 'uncertain transport must never become acknowledged expression memory');
 assert.equal((await f.life.deliver(intent, conversationScope('private', MOTHER), new AbortController().signal)).status, 'not-pending-no-send');
 assert.equal(f.wire.length, 1); const modelCount = f.composerRequests.length;
 await f.restartQuiet();
 assert.equal((await f.life.deliver(intent, conversationScope('private', MOTHER), new AbortController().signal)).status, 'not-pending-no-send');
 assert.equal((await f.life.tick()).status, 'kept-private-or-quiet');
 assert.equal(f.wire.length, 1); assert.equal(f.composerRequests.length, modelCount); assert.equal(f.intent().state, 'uncertain');
 assert.deepEqual(f.turns().map(row => row.state), ['uncertain']);
});

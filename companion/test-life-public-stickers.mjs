// Real catalog/media/experience interfaces with synthetic bytes, decoder and
// analysis callback. No network, image process, provider, transport or QQ send.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LifePublicStickers, verifiedPublicSticker} from './life-public-stickers.mjs';
import {FixedFisharchiveCatalog} from './fisharchive-stickers.mjs';
import {ScopedMedia} from './scoped-media.mjs';
import {ExperienceMemory} from './experience-memory.mjs';
import {LifeJournal} from './life-journal.mjs';

const SELF = '910010001', HUMAN = '910010002', NOW = Date.parse('2046-06-08T12:00:00+08:00');
const MANIFEST = 'https://fisharchive.cc/stickers/manifest.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jpeg = value => Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.from(digest(value), 'hex')]);
const vision = () => ({status: 'vision-ok', vision: {status: 'ok', description: 'A synthetic blue whale holding a cup.', ocr_text: 'hello', uncertainty: 'One still frame only.'}, untrusted_image_content: true});
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
function fixture(t, {connected = true} = {}) {
 let now = NOW, allowed = true, analysis = vision(), requestHook, analysisHook;
 const calls = [], analyses = [], outcomes = [], controller = new AbortController();
 const media = new ScopedMedia(':memory:'), store = new ExperienceMemory({path: ':memory:', botId: SELF, clock: () => now});
 const service = {botId: SELF, media, cognition: {store}, paused: false, closed: false};
 const rows = Array.from({length: 4}, (_, i) => ({original: `media/item-${i}.png`, filename: `item-${i}.png`, alt: `Synthetic site label ${i}`,
  tags: ['synthetic'], preview: `previews/item-${i}.webp`, large: `large/item-${i}.webp`, width: 400, height: 400}));
 const cat = new FixedFisharchiveCatalog({path: ':memory:', media, clock: () => now, authorize: () => !service.paused && !service.closed,
  request: async (url, options) => {calls.push({url, signal: options.signal}); if (requestHook) await requestHook(url, options); return url === MANIFEST ? Buffer.from(JSON.stringify(rows)) : Buffer.from(url);},
  prepare: async bytes => ({ok: true, mime: 'image/jpeg', base64: jpeg(bytes).toString('base64'), width: 400, height: 400, first_frame_only: true, metadata_stripped: true})});
 service.stickers = cat;
 const callback = async (imageId, {signal, canAct}) => {
  signal?.throwIfAborted(); assert.equal(await canAct(), true);
  const {scope} = verifiedPublicSticker(service, imageId), cached = media.analysis(scope, imageId);
  if (cached) return cached;
  analyses.push({id: imageId, scope, signal});
  if (analysisHook) await analysisHook({signal});
  signal?.throwIfAborted(); assert.equal(await canAct(), true);
  return media.saveAnalysis(scope, imageId, structuredClone(analysis));
 };
 if (connected) service.analyzePublicSticker = callback;
 const adapter = new LifePublicStickers({service, clock: () => now});
 const initial = adapter.tools({signal: controller.signal, canAct: () => allowed, onOutcome: value => outcomes.push(value)}), expanded = initial[0].expandsTools();
 t.after(async () => {await cat.close(); media.close(); store.close();});
 return {service, media, store, cat, initial, expanded, calls, analyses, outcomes, controller,
  allow: value => {allowed = value;}, connect: () => {service.analyzePublicSticker = callback;}, analysis: value => {analysis = value;},
  requestHook: value => {requestHook = value;}, analysisHook: value => {analysisHook = value;}, advance: () => {now += 1000;},
  run: async (name, args = {}) => JSON.parse(await [...initial, ...expanded].find(tool => tool.name === name).handler(args)),
 };
}

test('optional opener has no access side effects and exposes only fixed public tools', async t => {
 const f = fixture(t), before = f.store.counts();
 assert.deepEqual(f.initial.map(x => x.name), ['open_own_stickers']);
 const opened = await f.run('open_own_stickers', {reason: 'I want to look for a silly whale face'});
 assert.equal(opened.images_recognized, false); assert.equal(opened.sent, false);
 assert.deepEqual(f.expanded.map(x => x.name), ['own_sticker_catalog', 'own_sticker_collect', 'own_sticker_collection', 'own_sticker_view']);
 assert.ok(f.expanded.every(x => x.parameters.additionalProperties === false));
 assert.equal(f.calls.length, 0); assert.equal(f.analyses.length, 0); assert.deepEqual(f.store.counts(), before);
 for (const args of [{}, {reason: ''}, {reason: 'x'.repeat(401)}, {reason: 'look', user_id: HUMAN}]) await assert.rejects(f.run('open_own_stickers', args));
 for (const args of [{url: MANIFEST}, {scope: 'private:' + HUMAN}, {offset: -1}, {limit: 21}, {query: {}}, {refresh: 'true'}]) await assert.rejects(f.run('own_sticker_catalog', args));
 for (const filename of ['../a.png', 'https://example.org/a.png', 'C:/fake/a.png', 'item..png']) await assert.rejects(f.run('own_sticker_collect', {filename}));
 assert.equal(f.calls.length, 0);
});

test('catalog pagination is labels-only and neither downloads images nor records an experience', async t => {
 const f = fixture(t), before = f.store.counts();
 const first = await f.run('own_sticker_catalog', {limit: 2});
 assert.equal(first.items.length, 2); assert.equal(first.next_offset, 2); assert.equal(first.reading_level, 'catalog-labels');
 assert.equal(first.experience_saved, false); assert.equal(first.images_recognized, false);
 const second = await f.run('own_sticker_catalog', {offset: first.next_offset, limit: 2});
 assert.equal(second.items[0].filename, 'item-2.png'); assert.equal(second.next_offset, null);
 assert.deepEqual(f.calls.map(x => x.url), [MANIFEST]); assert.equal(f.analyses.length, 0); assert.deepEqual(f.store.counts(), before);
 assert.equal(f.outcomes.at(-1).status, 'public-sticker-catalog-read');
});

test('one collection reuses real verified intake, own analysis cache and journal-eligible exact evidence', async t => {
 const f = fixture(t);
 const result = await f.run('own_sticker_collect', {filename: 'item-0.png'});
 assert.equal(result.status, 'public-sticker-collected'); assert.equal(result.deduplicated, false); assert.equal(result.sent, false);
 assert.equal(result.source.metadata_stripped, true); assert.equal(result.source.author_known, false);
 assert.equal(result.analysis_status, 'vision-ok'); assert.equal(result.read_scope.level, 'image-description');
 assert.equal(result.read_scope.first_frame_only, true); assert.equal(result.read_scope.whole_animation_viewed, false);
 assert.equal(result.read_scope.original_image_pixels_in_this_context, false);
 assert.equal(f.analyses[0].scope.key, 'private-' + SELF); assert.ok(f.analyses[0].signal);
 const ref = result.memory.evidence_refs[0], saved = f.store.get({...ref});
 assert.equal(saved.scope, 'unknown'); assert.equal(saved.role, 'self'); assert.equal(saved.sources[0].source, 'observed-public-sticker');
 assert.equal(saved.event, 'public-sticker:own:' + result.image_id); assert.equal(saved.metadata.reading_level, 'image-description');
 const journal = new LifeJournal({store: f.store, clock: () => NOW});
 assert.equal(journal.evidence([ref.id])[0].revision, ref.revision);
 const repeated = await f.run('own_sticker_collect', {filename: 'item-0.png'});
 assert.equal(repeated.image_id, result.image_id); assert.equal(repeated.deduplicated, true); assert.equal(repeated.memory.status, 'duplicate');
 assert.equal(f.analyses.length, 1, 'repeat collection must reuse its own cached analysis');
 assert.deepEqual(f.calls.map(x => x.url), [MANIFEST, 'https://fisharchive.cc/previews/item-0.webp', 'https://fisharchive.cc/previews/item-0.webp']);
 assert.equal(f.media.db.prepare('SELECT count(*) n FROM image_sends').get().n, 0);
});

test('labels, OCR and actual descriptions remain separate; higher reading evidence can become current', async t => {
 const f = fixture(t, {connected: false});
 const labels = await f.run('own_sticker_collect', {filename: 'item-0.png'}), id = labels.image_id;
 assert.equal(labels.analysis_status, 'not-analyzed'); assert.equal(labels.read_scope.level, 'labels-only');
 assert.equal(labels.read_scope.image_description_read, false); assert.equal(f.analyses.length, 0);
 f.connect(); f.analysis({status: 'ocr-only', ocr: {status: 'ok', text: 'Synthetic visible text'}, vision: {status: 'disabled'}});
 const ocr = await f.run('own_sticker_view', {image_id: id, analyze: true});
 assert.equal(ocr.read_scope.level, 'ocr-text'); assert.equal(ocr.read_scope.image_description_read, false);
 assert.notEqual(ocr.memory.revision, labels.memory.revision);
 const own = verifiedPublicSticker(f.service, id).scope;
 f.media.saveAnalysis(own, id, vision());
 const viewed = await f.run('own_sticker_view', {image_id: id});
 assert.equal(viewed.read_scope.level, 'image-description'); assert.equal(f.analyses.length, 1, 'read-only cached view never invokes analysis');
 assert.equal(f.store.get({id: labels.memory.id}).revision, viewed.memory.revision);
 assert.equal(JSON.parse(f.store.get({id: labels.memory.id, revision: labels.memory.revision}).text).read_scope.level, 'labels-only');
 f.media.saveAnalysis(own, id, {status: 'analysis-failed', reason: 'secret-token-should-not-leak'});
 const failed = await f.run('own_sticker_view', {image_id: id});
 assert.equal(failed.read_scope.level, 'labels-only'); assert.equal(f.store.get({id: labels.memory.id}).revision, viewed.memory.revision);
 assert.equal(JSON.stringify(failed).includes('secret-token'), false); assert.notEqual(failed.memory.revision, viewed.memory.revision);
 assert.equal(f.store.get({id: failed.memory.id, revision: failed.memory.revision}).found, true);
});

test('inventory and view never borrow chat analyses or admit private/unverified images, even with forged asset index', async t => {
 const f = fixture(t, {connected: false}), foreign = {kind: 'private', id: HUMAN};
 const saved = await f.run('own_sticker_collect', {filename: 'item-0.png'});
 f.media.saveAnalysis(foreign, saved.image_id, {...vision(), vision: {status: 'ok', description: 'PRIVATE_CHAT_ANALYSIS', ocr_text: '', uncertainty: ''}});
 const received = f.media.importReceived(foreign, {message_type: 'private', user_id: HUMAN, message_id: 'private-picture'}, jpeg('private'));
 const selfReceived = f.media.importReceived({kind: 'private', id: SELF}, {message_type: 'private', user_id: SELF, message_id: 'self-chat-picture'}, jpeg('self-chat'));
 const manual = f.media.importApprovedSeed(jpeg('manual'), 'MANUAL_NONCATALOG_LABEL');
 const before = f.store.counts(), calls = f.calls.length;
 const inventory = await f.run('own_sticker_collection');
 assert.equal(inventory.items.length, 1); assert.equal(inventory.items[0].analysis_status, 'not-analyzed');
 assert.equal(JSON.stringify(inventory).includes('PRIVATE_CHAT'), false); assert.equal(JSON.stringify(inventory).includes('MANUAL_'), false);
 assert.deepEqual(f.store.counts(), before); assert.equal(f.calls.length, calls);
 for (const image_id of [received.id, selfReceived.id, manual.id]) {
  assert.equal((await f.run('own_sticker_view', {image_id, analyze: true})).reason, 'verified-public-sticker-required');
 }
 const source = {...saved.source, prepared_sha256: digest(jpeg('private'))};
 f.cat.db.prepare('INSERT INTO fisharchive_assets VALUES(?,?,?,?,?,?,?)').run('synthetic-forged-index', 'synthetic-hash', received.id, source.prepared_sha256, source.manifest_sha256, JSON.stringify(source), NOW);
 assert.equal((await f.run('own_sticker_view', {image_id: received.id, analyze: true})).reason, 'verified-public-sticker-required');
 assert.equal((await f.run('own_sticker_collection')).unavailable_in_page, 1);
 assert.equal(f.analyses.length, 0); assert.deepEqual(f.store.counts(), before);
});

test('saved bytes and source hash must still agree and collection pagination preserves bounded coverage', async t => {
 const f = fixture(t, {connected: false});
 const saved = [];
 for (let i = 0; i < 3; i++) {f.advance(); saved.push(await f.run('own_sticker_collect', {filename: `item-${i}.png`}));}
 const first = await f.run('own_sticker_collection', {limit: 2});
 const next = await f.run('own_sticker_collection', {limit: 2, offset: first.next_offset});
 assert.equal(first.items.length, 2); assert.equal(next.items.length, 1); assert.equal(next.next_offset, null);
 assert.equal(new Set([...first.items, ...next.items].map(x => x.image_id)).size, 3);
 const id = saved[0].image_id, before = f.store.counts();
 f.media.db.prepare('UPDATE scoped_media SET bytes=? WHERE id=?').run(jpeg('tampered'), id);
 assert.throws(() => verifiedPublicSticker(f.service, id), /integrity/);
 assert.equal((await f.run('own_sticker_view', {image_id: id, analyze: true})).reason, 'verified-public-sticker-required');
 assert.deepEqual(f.store.counts(), before); assert.equal(f.analyses.length, 0);
});

test('failed network/analysis/index outcomes are short facts without automatic retry or raw error details', async t => {
 const f = fixture(t);
 f.requestHook(() => {throw Error('Bearer ' + 'SYNTHETIC_NEGATIVE_FIXTURE');});
 const catalog = await f.run('own_sticker_catalog'); assert.equal(catalog.reason, 'public-catalog-read-failed');
 const collection = await f.run('own_sticker_collect', {filename: 'item-0.png'}); assert.equal(collection.reason, 'public-sticker-collection-failed');
 assert.equal(f.calls.length, 2); assert.equal(JSON.stringify([catalog, collection]).includes('Bearer'), false);
 f.requestHook(null); f.analysisHook(() => {throw Error('Bearer ' + 'SYNTHETIC_NEGATIVE_FIXTURE');});
 const failed = await f.run('own_sticker_collect', {filename: 'item-0.png'});
 assert.equal(failed.ok, true); assert.equal(failed.analysis_status, 'analysis-failed'); assert.equal(failed.read_scope.level, 'labels-only');
 assert.equal(JSON.stringify(failed).includes('Bearer'), false); assert.equal(f.analyses.length, 1);
 const counts = f.store.counts(), record = f.store.recordMessage;
 f.store.recordMessage = () => {throw Error('database secret');};
 const view = await f.run('own_sticker_view', {image_id: failed.image_id});
 f.store.recordMessage = record;
 assert.equal(view.memory.reason, 'index-failed-original-observation-preserved'); assert.equal(view.source.metadata_stripped, true);
 assert.deepEqual(f.store.counts(), counts); assert.equal(f.analyses.length, 1);
});

test('pause, cancellation and ended opportunities prevent further analysis, experience writes and result use', async t => {
 const f = fixture(t), before = f.store.counts();
 f.service.paused = true;
 for (const [name, args] of [['open_own_stickers', {reason: 'look'}], ['own_sticker_collection', {}], ['own_sticker_collect', {filename: 'item-0.png'}]]) await assert.rejects(f.run(name, args), /paused/);
 assert.equal(f.calls.length, 0); f.service.paused = false;
 const gate = deferred(), started = deferred();
 f.analysisHook(async () => {started.resolve(); await gate.promise;});
 const pending = f.run('own_sticker_collect', {filename: 'item-0.png'}), rejected = assert.rejects(pending);
 await started.promise; f.controller.abort(); gate.resolve(); await rejected;
 assert.deepEqual(f.store.counts(), before); assert.equal(f.media.db.prepare('SELECT count(*) n FROM image_analysis').get().n, 0);
 assert.equal(f.outcomes.length, 0);
 const g = fixture(t), gBefore = g.store.counts();
 g.analysisHook(() => {g.allow(false);});
 await assert.rejects(g.run('own_sticker_collect', {filename: 'item-0.png'}), /ended/);
 assert.deepEqual(g.store.counts(), gBefore); assert.equal(g.media.db.prepare('SELECT count(*) n FROM image_analysis').get().n, 0);
});

test('authorization is checked after catalog awaits and missing connections remain unknown', async t => {
 const f = fixture(t); f.requestHook(() => {f.allow(false);});
 await assert.rejects(f.run('own_sticker_catalog'), /ended/); assert.equal(f.outcomes.length, 0);
 const adapter = new LifePublicStickers({service: {botId: SELF}}), tools = adapter.tools({canAct: () => true});
 const opened = JSON.parse(await tools[0].handler({reason: 'Maybe browse later'}));
 assert.equal(opened.catalog_connected, false); assert.equal(opened.analysis_callback_connected, false);
 const expanded = tools[0].expandsTools();
 const missing = JSON.parse(await expanded.find(x => x.name === 'own_sticker_collection').handler({}));
 assert.equal(missing.reason, 'public-catalog-not-connected'); assert.equal(missing.not_an_empty_collection, true);
});

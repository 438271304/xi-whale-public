// Real ConversationService, catalog, ScopedMedia and temporary databases.
// Network, decode and analyzer are fixed fakes; no provider, OCR process or QQ.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ConversationService} from './conversation-service.mjs';

const SELF = '910020001', HUMAN = '910020002', OWN = {kind: 'private', id: SELF}, PARENT = {kind: 'private', id: HUMAN};
const MANIFEST = 'https://fisharchive.cc/stickers/manifest.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jpeg = bytes => Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.from(digest(bytes), 'hex')]);
const vision = () => ({status: 'vision-ok', vision: {status: 'ok', description: 'A synthetic whale face.', ocr_text: '', uncertainty: 'Synthetic single frame.'}, untrusted_image_content: true});
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
 const requests = [], analyses = [], sends = [], conversationRequests = [], allowedScopes = [];
 let hook, result = vision();
 const service = new ConversationService({root: mkdtempSync(join(tmpdir(), 'whale-public-sticker-service-')),
  botId: SELF, guardianIds: [HUMAN], publicProfile: 'Synthetic offline test profile',
  client: {respond: async request => {conversationRequests.push(request); throw Error('Unexpected conversation provider request');}},
  isAllowed: scope => {allowedScopes.push(scope); return false;}, send: async value => {sends.push(value); throw Error('Unexpected QQ send');},
  imageAnalyzer: {analyze: async (bytes, {signal}) => {analyses.push({bytes: Buffer.from(bytes), signal}); if (hook) await hook({signal}); return structuredClone(result);}},
  stickerOptions: {
   request: async (url, {signal}) => {requests.push({url, signal}); assert.ok(signal); return url === MANIFEST ? Buffer.from(JSON.stringify([
    {original: 'media/whale.png', filename: 'whale.png', alt: 'Synthetic site label only', tags: ['synthetic'], preview: 'previews/whale.webp', large: 'large/whale.webp', width: 400, height: 400},
   ])) : Buffer.from(url);},
   prepare: async bytes => ({ok: true, mime: 'image/jpeg', base64: jpeg(bytes).toString('base64'), width: 400, height: 400, first_frame_only: true, metadata_stripped: true}),
  }});
 t.after(async () => {await service.close(); assert.equal(sends.length, 0); assert.equal(conversationRequests.length, 0); assert.equal(allowedScopes.length, 0, 'autonomous public analysis never borrows chat authorization');});
 return {service, requests, analyses, sends, conversationRequests, allowedScopes,
  hook: value => {hook = value;}, result: value => {result = value;},
  collect: async () => service.stickers.collect('whale.png'),
  analyze: (id, options = {}) => service.analyzePublicSticker(id, {canAct: () => true, ...options}),
  count: () => service.media.db.prepare('SELECT count(*) n FROM image_analysis WHERE owner=?').get('private-' + SELF).n,
 };
}

test('real service analyzes verified public bytes only into its own cache and does not borrow a parent analysis', async t => {
 const f = fixture(t), image = await f.collect();
 f.service.media.saveAnalysis(PARENT, image.image_id, {...vision(), vision: {status: 'ok', description: 'PRIVATE_PARENT_ANALYSIS', ocr_text: '', uncertainty: ''}});
 const analyzed = await f.analyze(image.image_id);
 assert.equal(analyzed.status, 'vision-ok'); assert.equal(analyzed.vision.description, 'A synthetic whale face.');
 assert.equal(f.analyses.length, 1); assert.deepEqual(f.analyses[0].bytes, f.service.media.imageBytes(OWN, image.image_id).bytes);
 assert.equal(f.service.media.analysis(OWN, image.image_id).vision.description, analyzed.vision.description);
 assert.equal(f.service.media.analysis(PARENT, image.image_id).vision.description, 'PRIVATE_PARENT_ANALYSIS');
 assert.equal((await f.analyze(image.image_id)).status, 'vision-ok'); assert.equal(f.analyses.length, 1);
 assert.deepEqual(f.requests.map(x => x.url), [MANIFEST, 'https://fisharchive.cc/previews/whale.webp']);
 assert.equal(f.service.imageControllers.size, 0); assert.equal(f.service.imageJobs.size, 0); assert.equal(f.service.analysisInFlight.size, 0);
});

test('private attachments, arbitrary seeds and corrupt catalog bytes are rejected before analyzer or cache reuse', async t => {
 const f = fixture(t), image = await f.collect();
 const privateImage = f.service.media.importReceived(PARENT, {message_type: 'private', user_id: HUMAN, message_id: 'synthetic-private-image'}, jpeg('private'));
 const seed = f.service.media.importApprovedSeed(jpeg('manual seed'), 'Synthetic arbitrary seed');
 f.service.media.saveAnalysis(OWN, seed.id, vision());
 for (const id of [privateImage.id, seed.id, 'https://example.org/a.png', 'C:/fake/image.jpg']) await assert.rejects(f.analyze(id), /public sticker|Public sticker/);
 f.service.media.saveAnalysis(OWN, image.image_id, vision());
 f.service.media.db.prepare('UPDATE scoped_media SET bytes=? WHERE id=?').run(jpeg('corrupt'), image.image_id);
 await assert.rejects(f.analyze(image.image_id), /integrity/);
 assert.equal(f.analyses.length, 0);
});

test('successful OCR/vision caches are reused but a saved unavailable result permits a fresh explicit analysis', async t => {
 const f = fixture(t), image = await f.collect();
 f.service.media.saveAnalysis(OWN, image.image_id, {status: 'analysis-unavailable'});
 const fresh = await f.analyze(image.image_id);
 assert.equal(fresh.status, 'vision-ok'); assert.equal(f.analyses.length, 1);
 f.service.media.saveAnalysis(OWN, image.image_id, {status: 'ocr-only', ocr: {status: 'ok', text: 'Synthetic visible text'}});
 assert.equal((await f.analyze(image.image_id)).status, 'ocr-only'); assert.equal(f.analyses.length, 1);
 await assert.rejects(f.analyze(image.image_id, {canAct: () => false}), /ended/);
 const cancelled = new AbortController(); cancelled.abort();
 await assert.rejects(f.analyze(image.image_id, {signal: cancelled.signal}));
 assert.equal(f.analyses.length, 1, 'even cached results require a live authorized opportunity');
});

test('external cancellation reaches the actual analyzer and an uncooperative completed result is not saved', async t => {
 const f = fixture(t), image = await f.collect(), entered = deferred(), release = deferred(), controller = new AbortController();
 f.hook(async () => {entered.resolve(); await release.promise;});
 const running = f.analyze(image.image_id, {signal: controller.signal}), rejected = assert.rejects(running);
 await entered.promise; assert.equal(f.service.imageJobs.size, 1); controller.abort();
 assert.equal(f.analyses[0].signal.aborted, true); release.resolve(); await rejected;
 assert.equal(f.count(), 0); assert.equal(f.service.imageControllers.size, 0); assert.equal(f.service.imageJobs.size, 0); assert.equal(f.service.analysisInFlight.size, 0);
});

test('service pause drains independent analysis and pause/resume cannot save the old aborted result', async t => {
 const f = fixture(t), image = await f.collect(), entered = deferred(), release = deferred();
 f.hook(async () => {entered.resolve(); await release.promise;});
 const running = f.analyze(image.image_id), settled = running.then(value => ({value}), error => ({error}));
 await entered.promise;
 let drained = false; const pausing = f.service.pause().then(() => {drained = true;});
 try {
  await tick(); assert.equal(f.analyses[0].signal.aborted, true);
  assert.equal(drained, false, 'pause must wait for independent public analysis, even if its analyzer ignores abort');
  f.service.resume();
 } finally {release.resolve();}
 const result = await settled; await pausing;
 assert.notEqual(result.value?.status, 'vision-ok'); assert.equal(f.count(), 0);
 assert.equal(f.service.imageControllers.size, 0); assert.equal(f.service.imageJobs.size, 0); assert.equal(f.service.analysisInFlight.size, 0);
 f.service.resume(); f.hook(null);
 assert.equal((await f.analyze(image.image_id)).status, 'vision-ok'); assert.equal(f.count(), 1);
});

test('close drains independent analysis before closing media; no result is stored after shutdown', async t => {
 const f = fixture(t), image = await f.collect(), entered = deferred(), release = deferred();
 f.hook(async () => {entered.resolve(); await release.promise;});
 const running = f.analyze(image.image_id), settled = running.then(value => ({value}), error => ({error}));
 await entered.promise;
 let drained = false; const closing = f.service.close().then(() => {drained = true;});
 try {
  await tick(); assert.equal(f.analyses[0].signal.aborted, true);
  assert.equal(drained, false, 'close must retain the existing media store until independent analysis finishes');
  assert.equal(f.count(), 0);
 } finally {release.resolve();}
 const result = await settled; await closing;
 assert.notEqual(result.value?.status, 'vision-ok'); assert.equal(f.service.imageControllers.size, 0); assert.equal(f.service.imageJobs.size, 0);
});

test('ending only the opportunity prevents saving and concurrent observations share one live analysis', async t => {
 const f = fixture(t), image = await f.collect(), entered = deferred(), release = deferred(); let allowed = true;
 f.hook(async () => {entered.resolve(); await release.promise;});
 const running = f.analyze(image.image_id, {canAct: () => allowed}), settled = running.then(value => ({value}), error => ({error}));
 await entered.promise; allowed = false; release.resolve();
 assert.notEqual((await settled).value?.status, 'vision-ok'); assert.equal(f.count(), 0);
 const entered2 = deferred(), release2 = deferred(), secondController = new AbortController();
 f.hook(async () => {entered2.resolve(); await release2.promise;});
 const first = f.analyze(image.image_id); await entered2.promise;
 const second = f.analyze(image.image_id, {signal: secondController.signal}), rejected = assert.rejects(second);
 await tick(); secondController.abort(); release2.resolve();
 assert.equal((await first).status, 'vision-ok'); await rejected;
 assert.equal(f.analyses.length, 2, 'one ended analysis plus one shared live analysis'); assert.equal(f.count(), 1);
});

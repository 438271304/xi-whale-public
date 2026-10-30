import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {TiebaClaw} from './tieba-claw.mjs';
import {UnifiedCognition} from './cognition-tools.mjs';
import {LifeContinuity} from './life-continuity.mjs';

// Contract fixtures only: credentials are deliberately fake. All requests and
// DNS are injected; even the low-level HTTPS test uses a fake requestImpl.
const TOKEN = 'fixture-TB_TOKEN-not-a-real-secret';
const publicAddress = {address: '93.184.216.34', family: 4};
const paragraph = text => ({type: 0, text});
const threadPayload = () => ({error_code: 0, page: {current_page: 1, total_page: 2, has_more: true},
  first_floor: {id: '900', title: 'A public fixture discussion', content: [paragraph('Main post fixture text.')]},
  post_list: [{id: '901', author: {name: 'Observed public name'}, content: [paragraph('A returned reply.'), {type: 3, url: 'https://example.org/unread.png'}],
    sub_post_list: {sub_post_list: [{id: '902', content: [paragraph('A nested reply with unknown target.')]}, {id: '903', content: [paragraph('The next nested reply is not necessarily a response to the previous one.')]}]}}]});
const listPayload = () => ({error_code: 0, data: {thread_list: [{id: '12345', title: 'Fixture title', author: {name: 'List author'}, abstract: [{text: 'A lead, not the complete post.'}], reply_num: 7}]}});
function fixture({value = threadPayload(), status = 200, tokenReader = async () => TOKEN, request, resolver, ...options} = {}) {
  const calls = [], lookups = [];
  const client = new TiebaClaw({tokenReader, clock: () => Date.parse('2026-10-30T01:00:00+08:00'),
    resolver: resolver ?? (async (host, opts) => {lookups.push({host, opts}); return [publicAddress];}),
    request: request ?? (async (url, opts) => {calls.push({url: url.href, ...opts}); return new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});}),
    ...options});
  return {client, calls, lookups};
}

test('unconfigured/empty credentials make zero network requests; configuration alone is not verified access', async () => {
  for (const reader of [undefined, async () => '', async () => null]) {
    const f = fixture({tokenReader: reader});
    // An explicitly undefined fixture parameter defaults; remove the reader
    // after construction to exercise the genuinely unconfigured condition.
    if (reader === undefined) f.client.tokenReader = undefined;
    if (reader === undefined) assert.equal(f.client.status().status, 'unconfigured');
    assert.equal(f.client.status().claw_access_verified, false);
    const result = await f.client.thread({thread_id: '12345'});
    assert.equal(result.status, 'unconfigured'); assert.equal(result.reason, 'credential-unavailable');
    assert.equal(f.calls.length, 0); assert.equal(f.lookups.length, 0);
  }
  const f = fixture(); assert.equal(f.client.status().status, 'configured');
  assert.equal(f.client.status().normal_tieba_all_access_verified, false);
  assert.equal(f.client.status().claw_access_verified, false);
  const malformed = fixture({tokenReader: async () => TOKEN + '\r\nX: bad'});
  assert.equal((await malformed.client.list()).reason, 'credential-invalid'); assert.equal(malformed.calls.length, 0); assert.equal(malformed.lookups.length, 0);
});

test('lists use the fixed documented forum GET URL and raw Authorization header, and remain leads', async () => {
  const f = fixture({value: listPayload()}); const result = await f.client.list({forum_id: '28288377', sort_type: 3});
  assert.equal(result.status, 'ok'); assert.equal(result.evidence_level, 'search-lead'); assert.equal(result.sources[0].level, 'search-lead');
  assert.equal(result.threads[0].thread_id, '12345'); assert.equal(result.threads[0].reply_num, 7);
  assert.equal(f.calls.length, 1); const call = f.calls[0], url = new URL(call.url);
  assert.equal(url.origin, 'https://tieba.baidu.com'); assert.equal(url.pathname, '/c/f/frs/page_claw');
  assert.equal(url.searchParams.get('forum_id'), '28288377'); assert.equal(url.searchParams.get('sort_type'), '3');
  assert.equal(call.requestHeaders.Authorization, TOKEN); assert.ok(!call.requestHeaders.Authorization.startsWith('Bearer '));
  assert.equal(call.requestHeaders['Content-Type'], 'application/x-www-form-urlencoded;charset=UTF-8');
  assert.deepEqual(call.address, publicAddress); assert.ok(!call.url.includes(TOKEN));
  assert.ok(!JSON.stringify(result).includes(TOKEN)); assert.ok(!JSON.stringify(f.client.status()).includes(TOKEN));
});

test('thread ID comes from kz, not first_floor.id; authors and reply relations are never inferred from order', async () => {
  const f = fixture(), result = await f.client.thread({thread_id: '12345', pn: 1, r: 2});
  assert.equal(result.status, 'ok'); assert.equal(result.thread_id, '12345'); assert.equal(result.first_floor.id, '900');
  const url = new URL(f.calls[0].url); assert.equal(url.pathname, '/c/f/pb/page_claw'); assert.equal(url.searchParams.get('kz'), '12345'); assert.equal(url.searchParams.get('r'), '2');
  assert.equal(result.first_floor.author, null); assert.equal(result.first_floor.published_at, null);
  assert.equal(result.posts[0].author.name, 'Observed public name'); assert.equal(result.posts[0].floor, null);
  for (const nested of result.posts[0].sub_posts) {assert.equal(nested.parent_post_id, '901'); assert.equal(nested.reply_to, null); assert.equal(nested.author, null);}
  assert.equal(result.posts[0].unread_content[0].type, 3); assert.ok(!JSON.stringify(result).includes('unread.png'));
  assert.equal(result.sources[0].level, 'thread-posts'); assert.equal(result.evidence_level, 'thread-posts');
  assert.ok(result.sources[0].excerpt.includes('nested reply')); assert.deepEqual(result.read_scope.text_post_ids, ['900', '901', '902', '903']);
  assert.equal(result.read_scope.next_page, 2); assert.equal(result.read_scope.whole_thread_read, false);
  assert.equal(f.calls.length, 1, 'More pages are not automatically requested');
});

test('a deliberate next page keeps its actual range; missing or conflicting metadata cannot imply completeness', async () => {
  const second = threadPayload(); second.page = {current_page: 2, total_page: 2, has_more: false};
  const f = fixture({value: second}), result = await f.client.thread({thread_id: '12345', pn: 2});
  assert.equal(result.read_scope.actual_page, 2); assert.equal(result.read_scope.next_page, null); assert.equal(result.read_scope.whole_thread_read, false);
  assert.equal(new URL(f.calls[0].url).searchParams.get('pn'), '2');
  const absent = threadPayload(); absent.page = {};
  const partial = await fixture({value: absent}).client.thread({thread_id: '12345'});
  assert.equal(partial.read_scope.actual_page, null); assert.equal(partial.read_scope.next_page, null); assert.ok(partial.gaps.includes('page-metadata-incomplete'));
  const conflict = threadPayload(); conflict.page.has_more = false;
  const conflicted = await fixture({value: conflict}).client.thread({thread_id: '12345'});
  assert.ok(conflicted.gaps.includes('page-metadata-conflict')); assert.equal(conflicted.read_scope.next_page, 2);
  const mismatch = await fixture({value: second}).client.thread({thread_id: '12345', pn: 1});
  assert.equal(mismatch.reason, 'page-mismatch'); assert.deepEqual(mismatch.sources, []);
});

test('nested floor endpoint keeps the requested parent and thread, with unknown direct reply target and pagination', async () => {
  const f = fixture({value: {error_code: 0, data: {post_list: [{id: '905', content: [paragraph('Returned nested text.')]}, {id: '906', content: [paragraph('Another returned nested text.')]}]}}});
  const result = await f.client.floor({thread_id: '12345', post_id: '901'});
  assert.equal(result.thread_id, '12345'); assert.equal(result.parent_post_id, '901');
  for (const p of result.posts) {assert.equal(p.parent_post_id, '901'); assert.equal(p.reply_to, null); assert.equal(p.author, null);}
  assert.equal(result.sources[0].level, 'thread-posts'); assert.equal(result.read_scope.next_page, null);
  assert.equal(result.read_scope.nested_pagination, 'not-exposed-by-contract');
  const url = new URL(f.calls[0].url); assert.equal(url.pathname, '/c/f/pb/nestedFloor_claw');
  assert.equal(url.searchParams.get('post_id'), '901'); assert.equal(url.searchParams.get('thread_id'), '12345');
});

test('item, text and response byte limits retain gaps; unread-only content does not become a text reading', async () => {
  const f = fixture({maxPosts: 2, maxText: 5}), result = await f.client.thread({thread_id: '12345'});
  assert.equal(result.first_floor.text, 'Main '); assert.equal(result.read_scope.item_limit_reached, true); assert.equal(result.read_scope.text_limit_reached, true);
  assert.ok(result.posts.length <= 1); assert.equal(result.posts[0].sub_posts.length, 0);
  const onlyMedia = threadPayload(); onlyMedia.first_floor.content = [{type: 3, url: 'https://example.org/image'}]; onlyMedia.post_list = [];
  const unread = await fixture({value: onlyMedia}).client.thread({thread_id: '12345'});
  assert.equal(unread.status, 'partial'); assert.equal(unread.evidence_level, 'unread-content'); assert.deepEqual(unread.sources, []);
  const large = fixture({maxBytes: 50}); const bounded = await large.client.thread({thread_id: '12345'});
  assert.equal(bounded.reason, 'body-too-large'); assert.equal(large.calls.length, 1);
  const leads = listPayload(); leads.data.thread_list.push({...leads.data.thread_list[0], id: '54321'});
  const limited = await fixture({value: leads, maxPosts: 1, maxText: 3}).client.list();
  assert.equal(limited.threads.length, 1); assert.equal(limited.read_scope.item_limit_reached, true); assert.equal(limited.read_scope.abstract_limit_reached, true);
});

test('HTTP authorization/rate failures and API errno stop after one request without echoing server messages', async () => {
  for (const status of [401, 403, 429]) {
    const f = fixture({status, value: {error: TOKEN}}), result = await f.client.thread({thread_id: '12345'});
    assert.equal(result.status, 'failed'); assert.equal(result.reason, 'http-error'); assert.equal(result.http_status, status);
    assert.equal(result.automatic_retry, false); assert.equal(f.calls.length, 1); assert.ok(!JSON.stringify(result).includes(TOKEN));
  }
  for (const value of [{errno: 13, errmsg: TOKEN}, {error_code: 0, errno: -1, error_msg: TOKEN}, {error_code: '401'}]) {
    const f = fixture({value}), result = await f.client.list();
    assert.equal(result.reason, 'api-error'); assert.notEqual(result.api_code, 0); assert.equal(f.calls.length, 1); assert.ok(!JSON.stringify(result).includes(TOKEN));
  }
});

test('malformed JSON and endpoint shapes fail instead of fabricating posts or rounding unsafe IDs', async () => {
  for (const value of [[], {}, {error_code: 0}, {...threadPayload(), post_list: {}}, {...threadPayload(), first_floor: {id: '900', content: {text: 'bad'}}},
    {...threadPayload(), first_floor: {id: Number.MAX_SAFE_INTEGER + 1, content: []}}]) {
    const result = await fixture({value}).client.thread({thread_id: '12345'});
    assert.equal(result.status, 'failed'); assert.equal(result.reason, 'invalid-payload'); assert.deepEqual(result.sources, []);
  }
  const f = fixture({request: async () => new Response('<html>not JSON</html>')});
  assert.equal((await f.client.thread({thread_id: '12345'})).reason, 'invalid-json');
});

test('invalid model arguments cannot supply credentials, hosts, arbitrary forums or write operations', async () => {
  const f = fixture();
  for (const args of [{thread_id: '12345', token: TOKEN}, {thread_id: '12345', url: 'https://example.org/'}, {thread_id: '../evil'}, {thread_id: '12345', pn: 101}, {thread_id: '12345', r: 3}]) {
    assert.equal((await f.client.thread(args)).reason, 'invalid-arguments');
  }
  assert.equal((await f.client.list({forum_id: '99999999'})).reason, 'invalid-arguments'); assert.equal(f.calls.length, 0);
  const tools = f.client.tools(); assert.deepEqual(tools.map(t => t.name), ['tieba_status', 'tieba_list', 'tieba_thread', 'tieba_floor']);
  assert.ok(!JSON.stringify(tools.map(t => t.parameters)).includes('token')); assert.ok(tools.every(t => t.parameters.additionalProperties === false));
  assert.equal(JSON.parse(await tools[0].handler({token: TOKEN})).reason, 'invalid-arguments');
});

test('redirects, a credential-reader failure, and hostile transport diagnostics never leak a token or follow a second host', async () => {
  for (const status of [301, 302, 307, 308]) {
    let calls = 0; const f = fixture({request: async () => {calls++; return new Response(null, {status, headers: {location: 'https://example.org/?token=' + TOKEN}});}});
    const result = await f.client.thread({thread_id: '12345'}); assert.equal(result.reason, 'redirect-refused'); assert.equal(calls, 1); assert.ok(!JSON.stringify(result).includes(TOKEN));
  }
  const badReader = fixture({tokenReader: async () => {throw Error(TOKEN);}});
  assert.ok(!JSON.stringify(await badReader.client.list()).includes(TOKEN)); assert.equal(badReader.calls.length, 0);
  const badTransport = fixture({request: async () => {throw Object.assign(Error(TOKEN), {clawCode: 'http-error', details: {Authorization: TOKEN}});}});
  assert.ok(!JSON.stringify(await badTransport.client.list()).includes(TOKEN)); assert.ok(!JSON.stringify(badTransport.client.status()).includes(TOKEN));
  const reflected = threadPayload(); reflected.first_floor.content = [paragraph('An unexpected credential echo: ' + TOKEN)];
  const sanitized = await fixture({value: reflected}).client.thread({thread_id: '12345'});
  assert.equal(sanitized.status, 'ok'); assert.ok(!JSON.stringify(sanitized).includes(TOKEN)); assert.ok(sanitized.first_floor.text.includes('[redacted credential]'));
  const unsafe = fixture({resolver: async () => [publicAddress, {address: '127.0.0.1', family: 4}]});
  assert.equal((await unsafe.client.list()).reason, 'unsafe-public-dns'); assert.equal(unsafe.calls.length, 0);
});

test('cancellation before credentials, during DNS, and during a body read produces no further work', async () => {
  const cancelled = new AbortController(); cancelled.abort(); let tokens = 0;
  const f = fixture({tokenReader: async () => {tokens++; return TOKEN;}});
  assert.equal((await f.client.thread({thread_id: '12345'}, {signal: cancelled.signal})).reason, 'aborted'); assert.equal(tokens, 0); assert.equal(f.calls.length, 0);
  const dnsCancel = new AbortController();
  const dns = fixture({resolver: () => {dnsCancel.abort(); return new Promise(() => {});}});
  assert.equal((await dns.client.list({}, {signal: dnsCancel.signal})).reason, 'aborted'); assert.equal(dns.calls.length, 0);
  const bodyCancel = new AbortController(); let streamClosed = false;
  const streamed = fixture({request: async () => ({status: 200, headers: new Headers(), body: {getReader: () => ({
    read: () => {bodyCancel.abort(); return new Promise(() => {});}, cancel: async () => {streamClosed = true;},
  })}})});
  assert.equal((await streamed.client.thread({thread_id: '12345'}, {signal: bodyCancel.signal})).reason, 'aborted'); assert.equal(streamClosed, true);
});

test('production securePublicRequest integration pins DNS and only gives Authorization to the fixed HTTPS GET', async () => {
  const calls = [];
  const requestImpl = (url, options, callback) => {
    calls.push({url: url.href, options}); const req = new EventEmitter(); req.destroy = () => {};
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter(); res.statusCode = 200; res.headers = {'content-type': 'application/json'}; res.resume = () => {};
      callback(res); queueMicrotask(() => {res.emit('data', Buffer.from(JSON.stringify(listPayload()))); res.emit('end');});
    }); return req;
  };
  const client = new TiebaClaw({tokenReader: async () => TOKEN, resolver: async () => [publicAddress], requestImpl});
  assert.equal((await client.list()).status, 'ok'); assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).hostname, 'tieba.baidu.com'); assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, TOKEN); assert.equal(calls[0].options.rejectUnauthorized, true);
  calls[0].options.lookup('tieba.baidu.com', {all: true}, (error, found) => {assert.equal(error, null); assert.deepEqual(found, [publicAddress]);});
});

test('actual text is retained in unified public-exploration evidence and tagged thread-posts for LifeContinuity', async t => {
  const cognition = new UnifiedCognition(mkdtempSync(join(tmpdir(), 'tieba-claw-evidence-')));
  const db = new DatabaseSync(':memory:'); t.after(() => {cognition.close(); db.close();});
  const f = fixture(); f.client.bindCognition(cognition);
  const result = await f.client.thread({thread_id: '12345'}), saved = cognition.store.get({id: result.experience_id});
  assert.equal(saved.found, true); assert.equal(saved.role, 'self'); assert.equal(saved.scope, 'unknown');
  assert.ok(saved.sources.some(s => s.source === 'public-exploration'));
  assert.equal(JSON.parse(saved.text).thread_id, '12345'); assert.equal(JSON.parse(saved.text).read_scope.next_page, 2);
  assert.ok(!saved.text.includes(TOKEN)); assert.equal(saved.metadata.source_kind, 'tieba-claw');
  const continuity = new LifeContinuity(db);
  assert.equal(continuity.recordReading('fixture-read', 'fixture-activity', 'tieba_thread', result), 'thread-posts');
  const before = cognition.store.counts().messages;
  const leads = fixture({value: listPayload(), cognition}); await leads.client.list();
  assert.equal(cognition.store.counts().messages, before, 'Search leads are not retained as a completed text reading');
});

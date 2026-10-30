import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {publicHttpsUrl,publicInternetAddress,securePublicRequest,readPublicPage,publicExploration} from './public-exploration.mjs';
const good={address:'93.184.216.34',family:4},resolve=async()=>[good];
for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','169.254.169.254','192.168.1.1','100.64.0.1','198.18.0.1','192.0.2.2','203.0.113.2','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2001:0db8::1','2002:7f00:1::','2001:20::1'])assert.equal(publicInternetAddress(ip),false,ip);
for(const ip of [good.address,'1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888'])assert.equal(publicInternetAddress(ip),true,ip);
for(const url of ['http://example.com','file:///etc/passwd','https://user:pass@example.com','https://example.com:8443/','https://localhost/','https://foo.local/','https://127.1/','https://2130706433/','https://[::1]/','https://example.com/?api_key=secret','https://example.com/?access_token=secret'])assert.throws(()=>publicHttpsUrl(url),undefined,url);
assert.equal(publicHttpsUrl('https://example.com/a#fragment').href,'https://example.com/a');
let requests=0;
await assert.rejects(()=>readPublicPage('https://example.com',{resolver:async()=>[good,{address:'127.0.0.1',family:4}],fetcher:()=>{requests++;}}),/unsafe-public-dns/);assert.equal(requests,0);
const hops=[],domains=[];
const page=await readPublicPage('https://example.com/start',{resolver:async host=>{domains.push(host);return [good];},clock:()=>0,fetcher:async(url,options)=>{hops.push(url.href);assert.deepEqual(options.address,good);assert.ok(options.signal);return hops.length===1?new Response(null,{status:302,headers:{location:'https://public.example.net/article'}}):new Response('<html><title>Tide &amp; Moon</title><script>do not keep this script</script><p>Ocean &#x1f30a; research &amp; tides.</p></html>',{headers:{'content-type':'text/html; charset=utf-8'}});}});
assert.deepEqual(domains,['example.com','public.example.net']);assert.equal(hops.length,2);assert.equal(page.status,'ok');assert.equal(page.sources[0].title,'Tide & Moon');assert.match(page.sources[0].excerpt,/Ocean 🌊 research & tides/);assert.doesNotMatch(page.sources[0].excerpt,/keep this script/);assert.equal(page.sources[0].url,'https://public.example.net/article');assert.equal(page.retrieved_at,'1970-01-01T00:00:00.000Z');assert.equal(page.sources[0].published_at,null);
await assert.rejects(()=>readPublicPage('https://example.com',{resolver:resolve,fetcher:async()=>new Response(null,{status:302,headers:{location:'https://169.254.169.254/latest/meta-data/'}})}),/non-public-url/);
await assert.rejects(()=>readPublicPage('https://example.com',{resolver:resolve,fetcher:async()=>new Response(null,{status:302,headers:{location:'https://example.com/loop'}}),maxRedirects:1}),/public-redirect-limit/);
await assert.rejects(()=>readPublicPage('https://example.com',{resolver:resolve,fetcher:async()=>new Response('video',{headers:{'content-type':'video/mp4'}})}),/unsupported-public-content/);
await assert.rejects(()=>readPublicPage('https://example.com',{resolver:resolve,fetcher:async()=>new Response('zip',{headers:{'content-type':'text/plain','content-encoding':'gzip'}})}),/unsupported-public-encoding/);
await assert.rejects(()=>readPublicPage('https://example.com',{resolver:resolve,maxBytes:20,fetcher:async()=>new Response('a'.repeat(30),{headers:{'content-type':'text/plain'}})}),/public-page-too-large/);
const keepAlive=setInterval(()=>{},1000);try{await assert.rejects(()=>readPublicPage('https://example.com',{resolver:()=>new Promise(()=>{}),timeoutMs:5}),/aborted|Timeout/i);}finally{clearInterval(keepAlive);}
await assert.rejects(()=>readPublicPage('https://example.com',{fetcher:globalThis.fetch}),/unpinned-fetcher/);
// The production transport pins the validated DNS address while retaining TLS
// hostname verification and sends no credentials or ambient cookies.
let pinned=false;
const low=await securePublicRequest(new URL('https://example.com/page'),{address:good,requestImpl:(url,options,done)=>{
 assert.equal(url.hostname,'example.com');assert.equal(options.servername,'example.com');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);assert.ok(!Object.keys(options.headers).some(k=>/authorization|cookie/i.test(k)));
 options.lookup('example.com',{},(err,address,family)=>{assert.equal(err,null);assert.equal(address,good.address);assert.equal(family,4);pinned=true;});
 const req=new EventEmitter();req.destroy=()=>{};req.end=()=>{const r=new EventEmitter();r.statusCode=200;r.headers={'content-type':'text/plain'};r.resume=()=>{};done(r);queueMicrotask(()=>{r.emit('data',Buffer.from('real pinned transport body'));r.emit('end');});};return req;
}});assert.equal(await low.text(),'real pinned transport body');assert.equal(pinned,true);
let payload,calls=0;
const tools=publicExploration({clock:()=>0,client:{searchPublic:async(request,options)=>{calls++;payload=request;assert.ok(options.signal);return {results:[{url:'https://example.com/tide',title:'Tides',summary:'A verified synthetic excerpt',date:'2026-10-25T00:00:00Z'},{url:'https://127.0.0.1/private',title:'not a public source',summary:'must not retain'}]};}}});
const search=tools.find(t=>t.name==='public_search');const found=JSON.parse(await search.handler({query:'鲸鱼迁徙 科普',count:5}));assert.deepEqual(payload,{query:'鲸鱼迁徙 科普',count:5,need_content:false});assert.equal(found.status,'ok');assert.equal(found.sources.length,1);assert.equal(found.untrusted_external_content,true);
for(const query of ['聊天记录 老爹','email@example.com','sk-test-fixture-not-a-real-key','账号 123456789','two\nlines']){const result=JSON.parse(await search.handler({query}));assert.equal(result.status,'failed');assert.equal(result.sources.length,0);}assert.equal(calls,1);
const unavailable=JSON.parse(await publicExploration().find(t=>t.name==='public_search').handler({query:'tides'}));assert.equal(unavailable.status,'unavailable');assert.deepEqual(unavailable.sources,[]);
const failed=JSON.parse(await publicExploration({client:{searchPublic:async()=>{throw Error('provider rejected');}}}).find(t=>t.name==='public_search').handler({query:'tides'}));assert.equal(failed.status,'failed');assert.deepEqual(failed.sources,[]);
const fetchTool=publicExploration({resolver:resolve,fetcher:async()=>new Response('public content only',{headers:{'content-type':'text/plain'}})}).find(t=>t.name==='public_fetch');assert.equal(JSON.parse(await fetchTool.handler({url:'https://example.com/'})).status,'ok');
console.log('PASS public exploration: HTTPS/public-IP/DNS pin/TLS, per-hop redirects, credential/network/size/type/deadline boundaries; source/time/text extraction; injected search public payload; unavailable without client; no network or paid API calls');

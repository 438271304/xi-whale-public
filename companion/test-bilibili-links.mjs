// Exact platform references only; all DNS/HTTPS/API/media/model operations fake.
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseBilibiliReference,resolveBilibiliReference} from './bilibili-links.mjs';
import {BilibiliPublic} from './bilibili-public.mjs';

const A='BV1Xa4y1u7jG',B='BV1pHnB6NE8g',full=(id,page=1)=>'https://www.bilibili.com/video/'+id+'/'+(page===1?'':'?p='+page);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const dns=async(host,options)=>{assert.equal(host,'b23.tv');assert.equal(options.all,true);assert.equal(options.verbatim,true);return [{address:'1.1.1.1',family:4}];};
const redirect=(location,status=302)=>new Response(null,{status,headers:location?{location}:{}});
let accidentalFetch=0,modelCalls=0,mediaCalls=0,searchCalls=0;const oldFetch=globalThis.fetch;
globalThis.fetch=()=>{accidentalFetch++;throw Error('No network in reference tests');};
try{
 assert.deepEqual(parseBilibiliReference(A),{bvid:A,page:1,url:full(A)});
 for(const host of ['www.bilibili.com','m.bilibili.com','bilibili.com']){
  const parsed=parseBilibiliReference('https://'+host+'/video/'+A+'/?p=3&spm_id_from=333.337.search-card.all.click&vd_source=tracking#reply');assert.equal(parsed.bvid,A);assert.equal(parsed.page,3);assert.equal(parsed.url,full(A,3));
 }
 assert.equal(parseBilibiliReference('http://b23.tv/ABC123?share_source=qq').url,'https://b23.tv/ABC123');
 assert.equal(parseBilibiliReference('https://b23.tv/ABC123/?share_session_id=synthetic-tracking&share_source=qq&share_from=ugc').url,'https://b23.tv/ABC123/');
 assert.equal(parseBilibiliReference(full(A,2)+'&share_session_id=synthetic-tracking').url,full(A,2));
 for(const bad of ['https://evil.com/video/'+A,'https://b23.tv.evil.com/abc','https://www.bilibili.com@127.0.0.1/video/'+A,'https://user:pass@b23.tv/abc','https://b23.tv/abc?access_token=not-public','https://b23.tv/abc?cookie=not-public','https://b23.tv/abc?session_id=private-session','https://www.bilibili.com/video/'+A+'/?p=0','https://www.bilibili.com/video/'+A+'/?p=101','https://www.bilibili.com/video/'+A+'/?p=1&p=2','https://www.bilibili.com/video/'+A+'/?p=1.5','https://www.bilibili.com/video/'+A+'/not-a-video-path','https://www.bilibili.com/read/cv1','https://b23.tv/a/b','https://b23.tv/','BVbad'])assert.throws(()=>parseBilibiliReference(bad));

 let resolveCalls=0,wire=0;
 const reference=await resolveBilibiliReference('https://b23.tv/abc?share_session_id=tracking&share_source=qq',{resolver:async(...args)=>{resolveCalls++;return dns(...args);},transport:async(url,options)=>{wire++;assert.equal(url.href,'https://b23.tv/abc');assert.equal(options.address.address,'1.1.1.1');assert.equal(options.address.family,4);assert.ok(options.signal);assert.ok(options.maxBytes<=16000);assert.equal(options.requestHeaders.Referer,'https://www.bilibili.com/');return redirect('https://www.bilibili.com/video/'+B+'/?p=2&vd_source=tracking');}});
 assert.equal(reference.bvid,B);assert.equal(reference.page,2);assert.equal(reference.url,full(B,2));assert.equal(reference.requested_url,'https://b23.tv/abc');assert.equal(reference.search_substitute,false);assert.deepEqual(reference.redirects,[{from:'https://b23.tv/abc',to:full(B,2)}]);assert.equal(resolveCalls,1);assert.equal(wire,1);
 const direct=await resolveBilibiliReference(full(A,3),{resolver:()=>{throw Error('No DNS for already parsed BV reference');},transport:()=>{throw Error('No redirect request for a full BV link');}});assert.equal(direct.bvid,A);assert.equal(direct.page,3);assert.deepEqual(direct.redirects,[]);
 let chained=0;const chain=await resolveBilibiliReference('https://b23.tv/one',{resolver:dns,transport:async url=>{chained++;return redirect(url.pathname==='/one'?'/two?share_source=qq':full(A,2));}});assert.equal(chain.redirects.length,2);assert.equal(chain.bvid,A);assert.equal(chain.page,2);assert.equal(chained,2);

 // Refuse nonpublic or mixed DNS before any transport use. DNS/TLS transport
 // receives only the pinned address for the original HTTPS hostname.
 for(const addresses of [[{address:'127.0.0.1',family:4}],[{address:'10.0.0.1',family:4}],[{address:'::1',family:6}],[{address:'fc00::1',family:6}],[{address:'1.1.1.1',family:4},{address:'192.168.1.1',family:4}],[{address:'1.1.1.1',family:6}],[]]){
  let called=0;await assert.rejects(()=>resolveBilibiliReference('https://b23.tv/private',{resolver:async()=>addresses,transport:async()=>{called++;return redirect(full(A));}}),/unsafe-public-dns/);assert.equal(called,0);
 }
 for(const target of ['https://evil.com/video/'+A,'https://127.0.0.1/video/'+A,'https://user:pass@www.bilibili.com/video/'+A,'https://www.bilibili.com/video/'+A+'/?p=1&p=2','file:///C:/secret']){
  let calls=0;await assert.rejects(()=>resolveBilibiliReference('https://b23.tv/escape',{resolver:dns,transport:async()=>{calls++;return redirect(target);}}));assert.equal(calls,1);
 }
 for(const response of [{status:302,redirected:true,url:full(A),headers:new Headers({location:full(A)})},{status:302,redirected:false,url:'https://evil.com/',headers:new Headers({location:full(A)})}])await assert.rejects(()=>resolveBilibiliReference('https://b23.tv/auto',{resolver:dns,transport:async()=>response}),/unverified-bilibili-redirect/);
 for(const code of [401,403,412,429]){
  let calls=0;await assert.rejects(()=>resolveBilibiliReference('https://b23.tv/blocked',{resolver:dns,transport:async()=>{calls++;return new Response(null,{status:code});}}),new RegExp('bilibili-short-link-http-'+code));assert.equal(calls,1);
 }
 let loopCalls=0;await assert.rejects(()=>resolveBilibiliReference('https://b23.tv/loop',{resolver:dns,transport:async()=>{loopCalls++;return redirect('/loop?share_source=qq');}}),/short-link-loop/);assert.equal(loopCalls,1);
 let limitCalls=0;await assert.rejects(()=>resolveBilibiliReference('https://b23.tv/hop0',{resolver:dns,transport:async()=>redirect('/hop'+(++limitCalls))}),/redirect-limit/);assert.equal(limitCalls,4);
 await assert.rejects(()=>resolveBilibiliReference('https://b23.tv/nolocation',{resolver:dns,transport:async()=>redirect(null)}),/no-location/);
 let abortWire=0;const abortDns=new AbortController(),dnsGate=deferred(),dnsStarted=deferred();
 const dnsPending=resolveBilibiliReference('https://b23.tv/abortdns',{signal:abortDns.signal,resolver:async()=>{dnsStarted.resolve();await dnsGate.promise;return [{address:'1.1.1.1',family:4}];},transport:async()=>{abortWire++;return redirect(full(A));}});const dnsRejected=assert.rejects(dnsPending);await dnsStarted.promise;abortDns.abort();dnsGate.resolve();await dnsRejected;assert.equal(abortWire,0);
 const abortTransport=new AbortController(),transportGate=deferred(),transportStarted=deferred();
 const transportPending=resolveBilibiliReference('https://b23.tv/abortwire',{signal:abortTransport.signal,resolver:dns,transport:async()=>{transportStarted.resolve();await transportGate.promise;return redirect(full(A));}});const transportRejected=assert.rejects(transportPending);await transportStarted.promise;abortTransport.abort();transportGate.resolve();await transportRejected;

 // A cache hit retains THIS input's exact redirect evidence/page, not the
 // previous caller's URL. Fake subtitles avoid media decoding and paid models.
 const root=mkdtempSync(join(tmpdir(),'whale-bili-links-')),records=[],requests=[];let shortReads=0;
 const request=async raw=>{requests.push(raw);const url=new URL(raw);if(url.pathname==='/x/web-interface/view')return Buffer.from(JSON.stringify({code:0,data:{aid:1,title:'Synthetic '+url.searchParams.get('bvid'),desc:'Synthetic public metadata',owner:{name:'Public synthetic author'},pages:[{cid:101,duration:10},{cid:202,duration:20},{cid:303,duration:30}]}}));if(url.pathname==='/x/player/v2')return Buffer.from(JSON.stringify({code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://aisubtitle.hdslb.com/synthetic-'+url.searchParams.get('cid')+'.json'}]}}}));assert.equal(url.hostname,'aisubtitle.hdslb.com');return Buffer.from(JSON.stringify({body:[{from:0,to:1,content:'Synthetic subtitle '+url.pathname}]}));};
 const reader=new BilibiliPublic({root,client:{respond:()=>{modelCalls++;throw Error('No model');},searchPublic:()=>{searchCalls++;throw Error('No search substitute');}},request,cognition:{store:{recordMessage:record=>records.push(record)}},linkResolver:(input,{signal})=>resolveBilibiliReference(input,{signal,resolver:dns,transport:async url=>{shortReads++;return redirect(url.pathname==='/originalB'?full(B,3):full(A,2));}}),sampler:()=>{mediaCalls++;throw Error('Subtitles must not trigger media');},analyzer:{analyze:()=>{modelCalls++;throw Error('No visual model');}}});
 try{
  const first=await reader.read(full(A,2)+'&vd_source=first');assert.equal(first.page,2);assert.equal(first.reference.selected_page,2);assert.equal(first.reference.requested_url,full(A,2));assert.equal(first.bvid,A);assert.equal(first.content.subtitle_read,true);const fetched=requests.length;
  const cached=await reader.read('https://b23.tv/originalA?share_source=qq');assert.equal(cached.cached,true);assert.equal(cached.bvid,A);assert.equal(cached.page,2);assert.equal(cached.reference.requested_url,'https://b23.tv/originalA');assert.equal(cached.reference.redirects.length,1);assert.equal(cached.reference.search_substitute,false);assert.equal(requests.length,fetched);
  const explicit=await reader.read(A,{page:2});assert.equal(explicit.cached,true);assert.equal(explicit.reference.page,1);assert.equal(explicit.reference.selected_page,2);assert.equal(explicit.reference.requested_url,full(A));
  const third=await reader.read(full(A,3));assert.equal(third.page,3);assert.equal(third.reference.selected_page,3);assert.ok(third.content.subtitle[0].text.includes('303'));
  const originalB=await reader.read('https://b23.tv/originalB');assert.equal(originalB.bvid,B);assert.equal(originalB.page,3);assert.notEqual(originalB.bvid,cached.bvid);assert.equal(originalB.reference.requested_url,'https://b23.tv/originalB');assert.equal(shortReads,2);
  assert.equal(records.length,5);assert.equal(JSON.parse(records[1].text).reference.requested_url,'https://b23.tv/originalA');assert.equal(JSON.parse(records[2].text).reference.requested_url,full(A));
  const requestsBeforeFailure=requests.length;reader.linkResolver=(input,{signal})=>resolveBilibiliReference(input,{signal,resolver:dns,transport:async()=>new Response(null,{status:412})});
  const refused=JSON.parse(await reader.tools().find(tool=>tool.name==='bilibili_read').handler({video:'https://b23.tv/blocked'}));assert.equal(refused.status,'failed');assert.match(refused.reason,/http-412/);assert.deepEqual(refused.sources,[]);assert.equal(requests.length,requestsBeforeFailure);assert.equal(searchCalls,0);
  // Abort during resolution must not serve a cached result or append memory.
  const start=deferred(),gate=deferred(),control=new AbortController(),recordCount=records.length;reader.linkResolver=async()=>{start.resolve();await gate.promise;return {bvid:A,page:2,url:full(A,2),requested_url:'https://b23.tv/cancelled',redirects:[],search_substitute:false};};
  const pending=reader.read('https://b23.tv/cancelled',{signal:control.signal}),rejected=assert.rejects(pending);await start.promise;control.abort();gate.resolve();await rejected;assert.equal(records.length,recordCount);
 }finally{await reader.close();}

 // Closing waits for outstanding reference resolution. Its continuation must
 // reject before accessing the closed/closing DB or writing unified memory.
 const closeRoot=mkdtempSync(join(tmpdir(),'whale-bili-close-')),closeGate=deferred(),closeStarted=deferred();let closeQueries=0,closeMemories=0;
 const closing=new BilibiliPublic({root:closeRoot,client:{},request:()=>{throw Error('No content request after close');},cognition:{store:{recordMessage:()=>closeMemories++}},linkResolver:async()=>{closeStarted.resolve();await closeGate.promise;return {bvid:A,page:1,url:full(A),requested_url:full(A),redirects:[],search_substitute:false};},analyzer:{}});
 const prepare=closing.db.prepare.bind(closing.db);closing.db.prepare=(...args)=>{if(closing.closed)closeQueries++;return prepare(...args);};
 const closingRead=closing.read('https://b23.tv/pending'),closingRejected=assert.rejects(closingRead,/reader-closed/);await closeStarted.promise;let finished=false;const close=closing.close().then(()=>finished=true);await Promise.resolve();assert.equal(finished,false);closeGate.resolve();await Promise.all([close,closingRejected]);assert.equal(closeQueries,0);assert.equal(closeMemories,0);
 assert.equal(accidentalFetch,0);assert.equal(modelCalls,0);assert.equal(mediaCalls,0);assert.equal(searchCalls,0);
 console.log('PASS exact BV/full/b23 redirects and pages, tracking stripped, credential/host/private DNS/follow/loop/blocked status refusal, no retry/search substitute, per-read cache reference, abort and close resolution guards; fake DNS/HTTPS/API only, no network/model/media/QQ');
}finally{globalThis.fetch=oldFetch;}

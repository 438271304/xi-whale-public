import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {BilibiliSpeech} from './bilibili-speech.mjs';
import {LifeContinuity} from './life-continuity.mjs';
const BV='BV1Xa4y1u7jG';
const packed=value=>Buffer.from(JSON.stringify(value));
function fixture(t,{denied=false,ready=true,transcriber,streamSize=100}={}){
 const db=new DatabaseSync(':memory:'),calls=[],reads=[],windows=[];
 const speech=new BilibiliSpeech({root:'.',db,ready:()=>ready,
  linkResolver:async()=>({bvid:BV,page:2,requested_url:'https://b23.tv/example',redirects:[{from:'short',to:BV}],search_substitute:false}),
  request:async(url,options)=>{calls.push({url,options});if(url.includes('/view?'))return packed({code:0,data:{title:'Synthetic video',owner:{name:'author'},pages:[{cid:1,duration:20},{cid:2,duration:200}]}});
   if(url.includes('/playurl?'))return packed({code:denied?-403:0,data:{durl:[{url:'https://media.bilivideo.com/public.mp4',size:streamSize}]}});return Buffer.from('synthetic-media');},
  transcriber:transcriber??(async(bytes,args)=>{windows.push(args);return {kind:'speech-transcript',media_sha256:'source-hash',alignment:'segment-window-not-word-timestamps',segments:[{start_ms:30000,end_ms:32000,text:'合成的实际转写结果',state:'transcribed'}],evidence:{model_id:'synthetic-sensevoice',model_sha256:'model-hash',coverage:[{start_ms:30000,end_ms:32000}],unprocessed_ranges:[{start_ms:0,end_ms:30000},{start_ms:32000,end_ms:200000}]}};}),
  onRead:r=>reads.push(r)});
 t.after(async()=>{await speech.close();db.close();});return {speech,db,calls,reads,windows};
}
test('exact video page and selected audio window retain covered times and evidence, cache repeats no media work',async t=>{
 const f=fixture(t);const result=await f.speech.read('https://b23.tv/example',{startSeconds:30,maxSeconds:60});
 assert.equal(result.bvid,BV);assert.equal(result.page,2);assert.equal(result.evidence_level,'speech-transcript');assert.equal(result.content.audio_understood,false);
 assert.equal(f.windows[0].startSeconds,30);assert.equal(f.windows[0].maxSeconds,60);assert.equal(f.windows[0].duration,200);assert.equal(result.reference.search_substitute,false);
 const before=f.calls.length;assert.equal((await f.speech.read(BV,{startSeconds:30,maxSeconds:60})).cached,true);assert.equal(f.calls.length,before);assert.equal(f.reads.length,2);
 const life=new LifeContinuity(f.db);assert.equal(life.recordReading('read','act','bilibili_listen',result),'speech-transcript');
 const detail=JSON.parse(f.db.prepare('SELECT details FROM life_reading_evidence WHERE discovery=?').get('read').details);
 assert.deepEqual(detail.content.speech_transcript.coverage,result.content.speech_transcript.evidence.coverage);
});
test('missing model and invalid windows fail before network',async t=>{
 const f=fixture(t,{ready:false});await assert.rejects(()=>f.speech.read(BV),/unavailable/);assert.equal(f.calls.length,0);
 const g=fixture(t);for(const args of [{startSeconds:-1},{maxSeconds:301},{maxSeconds:0}])await assert.rejects(()=>g.speech.read(BV,args),/window-invalid/);assert.equal(g.calls.length,0);
});
test('platform denial and oversized stream stop before media/ASR without alternate endpoint',async t=>{
 for(const options of [{denied:true},{streamSize:64000001}]){const f=fixture(t,options);await assert.rejects(()=>f.speech.read(BV),/playurl-code--403|exceeds-64MB/);assert.equal(f.calls.length,2);assert.equal(f.windows.length,0);assert.equal(f.reads.length,0);}
});
test('empty machine result does not claim language or non-speech understanding',async t=>{
 const f=fixture(t,{transcriber:async()=>({kind:'speech-transcript',segments:[{state:'no_transcript',text:'',start_ms:0,end_ms:5000}],evidence:{coverage:[{start_ms:0,end_ms:5000}]}})});
 const r=await f.speech.read(BV);assert.equal(r.evidence_level,'metadata-only');assert.equal(r.content.audio_understood,false);assert.match(r.limitations.join(' '),/empty transcription does not prove silence/);
});
test('single heavy job, lifecycle cancellation and close do not race a late write',async t=>{
 let release,started;const begin=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const f=fixture(t,{transcriber:async()=>{started();await gate;return {segments:[],evidence:{}};}});
 const pending=f.speech.read(BV);await begin;await assert.rejects(()=>f.speech.read(BV),/busy/);
 const closing=f.speech.close();release();await assert.rejects(()=>pending,/closed/);await closing;assert.equal(f.reads.length,0);
 const g=fixture(t),controller=new AbortController();controller.abort();await assert.rejects(()=>g.speech.read(BV,{signal:controller.signal}),{name:'AbortError'});assert.equal(g.calls.length,0);
});
test('close during metadata lookup stops before a new playurl, media download or ASR',async t=>{
 const f=fixture(t);let release,entered;const gate=new Promise(r=>release=r),begin=new Promise(r=>entered=r);
 const request=f.speech.request;f.speech.request=async(...args)=>{const value=await request(...args);entered();await gate;return value;};
 const reading=f.speech.read(BV);await begin;const closing=f.speech.close();release();
 await assert.rejects(()=>reading,/closed/);await closing;
 assert.equal(f.calls.length,1);assert.equal(f.windows.length,0);assert.equal(f.reads.length,0);
});

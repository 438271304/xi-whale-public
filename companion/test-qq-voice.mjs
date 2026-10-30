// Synthetic WAV, fake bridge and fake local transcription; no real recordings,
// provider, download, account access or QQ sending.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {QQVoice,inspectVoiceWav} from './qq-voice.mjs';
import {conversationScope} from './conversation-scope.mjs';

const SELF='910490001',HUMAN='910490002',OTHER='910490003',GROUP='910490004',NOW=Date.parse('2046-10-18T12:00:00+08:00');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function wav({seconds=1,rate=16000,channels=1,bits=16,seed=1}={}){
 const align=channels*bits/8,count=Math.round(seconds*rate)*align,b=Buffer.alloc(44+count+(count&1),seed);
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);
 b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*align,28);b.writeUInt16LE(align,32);b.writeUInt16LE(bits,34);b.write('data',36);b.writeUInt32LE(count,40);return b;
}
function transcript(bytes,{duration},text='Synthetic spoken phrase'){
 const segments=[];for(let start=0;start<duration;start+=30)segments.push({start_ms:Math.round(start*1000),end_ms:Math.round(Math.min(start+30,duration)*1000),text,state:text?'transcribed':'no_transcript'});
 return {version:1,kind:'speech-transcript',media_sha256:inspectVoiceWav(bytes).sha256,sample_rate:16000,alignment:'segment-window-not-word-timestamps',audio_understood:false,non_speech_understood:false,
  segments,evidence:{source_duration_seconds:duration,model_id:'synthetic-local-decoder',scope:'machine speech text only'}};
}
function message(id=100,{kind='group',user=HUMAN,group=GROUP,segments=[{type:'record',data:{file:'bridge-record-a'}}]}={}){
 return {post_type:'message',message_type:kind,message_id:id,user_id:Number(user),...(kind==='group'?{group_id:Number(group)}:{}),sender:{user_id:Number(user)},time:(NOW-10000)/1000,message:segments};
}
function fixture(t,{source=message(),bytes=wav(),kind='group',id=GROUP}={}){
 const root=mkdtempSync(join(tmpdir(),'whale-qq-voice-test-')),scope=conversationScope(kind,id),calls=[],transcriptions=[],optionsSeen=[],pending=new Map();
 let ready=true,allowed=true,readyCalls=0,reply=message(99,{user:OTHER}),known=null,driverHook=null,asrHook=null,asrFailure=false,resultHook=null,transcriptHook=null;
 const service={botId:SELF,pending,paused:false,closed:false,resolveReply:()=>known};
 const driver={callApi:async(name,args)=>{
  calls.push({name,args});await driverHook?.(name,args);
  if(name==='get_msg')return structuredClone(reply);
  assert.equal(name,'get_record');assert.equal(args.out_format,'wav');
  const result={base64:bytes.toString('base64'),file_size:1};
  Object.defineProperties(result,{file:{get(){throw Error('Returned file must not be opened or read');}},url:{get(){throw Error('Returned URL must not be opened or read');}}});
  return resultHook?resultHook(result):result;
 }};
 const settings={path:join(root,'voice.sqlite3'),root:join(root,'scratch'),driver,service,clock:()=>NOW,ready:()=>{readyCalls++;return ready;},
  transcriber:async(data,options)=>{transcriptions.push(Buffer.from(data));optionsSeen.push(options);await asrHook?.(data,options);if(asrFailure)throw Error('PRIVATE_PATH_TOKEN_DO_NOT_RETURN');const result=transcript(data,options);return transcriptHook?transcriptHook(result):result;}};
 let voice=new QQVoice(settings);
 const admit=msg=>{pending.set(scope.address+'|'+msg.message_id,{scope,message:structuredClone(msg)});return voice.tools(msg,{scope,canAct:()=>allowed});};
 let tools=admit(source);
 t.after(async()=>{await voice.close();const target=realpathSync(root);assert.ok(target.startsWith(realpathSync(tmpdir())+sep));rmSync(target,{recursive:true,force:true});});
 return {root,scope,service,calls,transcriptions,optionsSeen,pending,source,get voice(){return voice;},get readyCalls(){return readyCalls;},admit,
  ready:value=>{ready=value;},allow:value=>{allowed=value;},bytes:value=>{bytes=value;},reply:value=>{reply=value;},known:value=>{known=value;},driver:fn=>{driverHook=fn;},asr:fn=>{asrHook=fn;},asrFailure:value=>{asrFailure=value;},response:fn=>{resultHook=fn;},transcript:fn=>{transcriptHook=fn;},
  async reopen(){await voice.close();voice=new QQVoice(settings);tools=admit(source);},
  async run(name='listen_qq_voice',args={},selected=tools){return JSON.parse(await selected.find(tool=>tool.name===name).handler(args));},
  counts:()=>({transcripts:voice.db.prepare('SELECT count(*) n FROM qq_voice_transcripts').get().n,observations:voice.db.prepare('SELECT count(*) n FROM qq_voice_observations').get().n})};
}

test('status exposes only record ordinals/direct reply IDs and performs no conversion or decoder execution',async t=>{
 const source=message(100,{segments:[{type:'text',data:{text:'Synthetic caption'}},{type:'record',data:{file:'one'}},{type:'reply',data:{id:'99'}},{type:'record',data:{file:'two'}}]}),f=fixture(t,{source});
 assert.equal(f.readyCalls,0,'construction does not initialize or download the model');
 const status=await f.run('qq_voice_status');assert.equal(status.status,'ready');assert.deepEqual(status.records,[{index:0},{index:1}]);assert.deepEqual(status.direct_reply_ids,['99']);
 assert.equal(status.audio_understood,false);assert.equal(status.non_speech_understood,false);assert.match(status.notice,/misrecognize/);
 assert.equal(f.calls.length,0);assert.equal(f.transcriptions.length,0);assert.doesNotMatch(JSON.stringify(status),/Synthetic caption|"one"|"two"/);
 f.ready(false);assert.equal((await f.run()).reason,'decoder-unavailable');assert.equal(f.calls.length,0);
});

test('current record preserves real source/time/index, actual WAV duration and speech limitations without opening API paths',async t=>{
 const source=message(100,{segments:[{type:'text',data:{text:'caption'}},{type:'record',data:{file:'first'}},{type:'record',data:{file:'second'}}]}),f=fixture(t,{source,bytes:wav({seconds:2.25,rate:44100,channels:2,bits:16})});
 const result=await f.run('listen_qq_voice',{index:1});
 assert.equal(result.status,'transcribed');assert.equal(result.cached,false);assert.equal(result.media.duration_seconds,Math.round(2.25*44100)/44100);
 assert.deepEqual(f.calls.map(row=>row.name),['get_record']);assert.deepEqual(f.calls[0].args,{file:'second',out_format:'wav'});
 assert.equal(result.source.scope,'group:'+GROUP);assert.equal(result.source.event,'100');assert.equal(result.source.author_id,HUMAN);
 assert.equal(result.source.at,NOW-10000);assert.equal(result.source.time_basis,'original-message-time');assert.equal(result.source.index,1);
 assert.equal(result.source.recording_voice_identity_verified,false);assert.deepEqual(result.transcript.source,result.source);
 assert.equal(result.transcript.words_may_be_misrecognized,true);assert.equal(result.whole_record_processed,true);
 assert.equal(f.optionsSeen[0].duration,result.media.duration_seconds);assert.equal(f.optionsSeen[0].maxSeconds,300);assert.ok(f.optionsSeen[0].signal instanceof AbortSignal);
 assert.deepEqual(f.counts(),{transcripts:1,observations:1});
});

test('only a directly replied same-scope message is resolved, retaining its different true author',async t=>{
 const f=fixture(t,{source:message(100,{segments:[{type:'reply',data:{id:'99'}},{type:'record',data:{file:'current'}}]})});
 f.known({sender_id:OTHER});const result=await f.run('listen_qq_voice',{message_id:'99'});
 assert.equal(result.status,'transcribed');assert.equal(result.source.relation,'direct-reply');assert.equal(result.source.author_id,OTHER);assert.equal(result.source.event,'99');assert.equal(result.source.current_event,'100');
 assert.deepEqual(f.calls.map(row=>row.name),['get_msg','get_record']);assert.deepEqual(f.calls[0].args,{message_id:99});
 const before=f.calls.length;await assert.rejects(f.run('listen_qq_voice',{message_id:'98'}),/directly-referenced/);assert.equal(f.calls.length,before);
 f.reply(message(99,{user:OTHER,group:'910490005'}));assert.equal((await f.run('listen_qq_voice',{message_id:'99'})).reason,'source-mismatch');
 f.reply(message(98,{user:OTHER}));assert.equal((await f.run('listen_qq_voice',{message_id:'99'})).reason,'source-mismatch');
 const conflict=message(99,{user:OTHER});conflict.sender.user_id=Number(HUMAN);f.reply(conflict);assert.equal((await f.run('listen_qq_voice',{message_id:'99'})).reason,'source-mismatch');
 f.reply(message(99,{user:HUMAN}));assert.equal((await f.run('listen_qq_voice',{message_id:'99'})).reason,'source-mismatch');
 assert.equal(f.calls.filter(row=>row.name==='get_record').length,1);
});

test('private source cannot be rebound to another peer and forwarded/nested reply IDs are never admitted',async t=>{
 const source=message(100,{kind:'private',segments:[{type:'forward',data:{message:[{type:'reply',data:{id:'99'}}]}},{type:'record',data:{file:'private'}}]}),f=fixture(t,{source,kind:'private',id:HUMAN});
 assert.equal((await f.run()).source.scope,'private:'+HUMAN);await assert.rejects(f.run('listen_qq_voice',{message_id:'99'}));
 assert.throws(()=>f.voice.tools(source,{scope:conversationScope('private',OTHER),canAct:()=>true}),/source-mismatch/);
 const unadmitted=message(101,{kind:'private'});assert.throws(()=>f.voice.tools(unadmitted,{scope:f.scope,canAct:()=>true}),/admitted/);
 const initialCalls=f.calls.length;f.pending.delete(f.scope.address+'|100');await assert.rejects(f.run(),/admitted/);assert.equal(f.calls.length,initialCalls);
});

test('same actual bytes reuse one CPU transcript across concurrent calls, sources and restart without copying source author',async t=>{
 const f=fixture(t),first=await Promise.all([f.run(),f.run()]);assert.deepEqual(first.map(result=>result.cached),[false,true]);assert.equal(f.transcriptions.length,1);
 const other=f.admit(message(101,{user:OTHER})),next=await f.run('listen_qq_voice',{},other);
 assert.equal(next.cached,true);assert.equal(next.source.author_id,OTHER);assert.equal(next.transcript.source.author_id,OTHER);assert.equal(next.source.event,'101');assert.equal(f.transcriptions.length,1);
 await f.reopen();assert.equal((await f.run()).cached,true);assert.equal(f.transcriptions.length,1);
 f.bytes(wav({seed:2}));assert.equal((await f.run()).cached,false);assert.equal(f.transcriptions.length,2);
 assert.deepEqual(f.counts(),{transcripts:2,observations:5});
});

test('bad WAV/base64 and overlong recordings remain unread; duration uses chunks rather than API file_size',async t=>{
 const f=fixture(t);f.response(()=>({file:'synthetic-unopened-file',url:'https://must-not-fetch.invalid/audio'}));
 assert.equal((await f.run()).reason,'wav-base64-unavailable');f.response(null);
 const corrupt=wav();corrupt.writeUInt32LE(1,28);f.bytes(corrupt);assert.equal((await f.run()).reason,'invalid-wav');
 f.bytes(wav({seconds:301,rate:8000,bits:8}));const over=await f.run();assert.equal(over.status,'not-transcribed');assert.equal(over.reason,'duration-over-limit');
 assert.equal(over.media.duration_seconds,301);assert.equal(over.whole_record_processed,false);assert.equal(f.transcriptions.length,0);
 for(const args of [{index:2},{index:-1},{index:null},{file:'model-controlled-path'},{url:'https://example.org'}]){
  try{const result=await f.run('listen_qq_voice',args);assert.equal(result.reason,'record-index-unavailable');}catch(error){assert.match(error.message,/invalid-selection/);}
 }
 assert.equal(f.counts().transcripts,0);
});

test('decoder failure remains a short uncertain reason and retries only after an explicit tool call',async t=>{
 const f=fixture(t);f.asrFailure(true);const failed=await f.run();
 assert.equal(failed.status,'unavailable');assert.equal(failed.reason,'voice-read-or-transcription-failed');assert.equal(failed.automatic_retry,false);assert.doesNotMatch(JSON.stringify(failed),/PRIVATE_PATH_TOKEN/);
 assert.equal(f.transcriptions.length,1);assert.equal(f.counts().transcripts,0);
 await turn();assert.equal(f.transcriptions.length,1);f.asrFailure(false);
 assert.equal((await f.run()).status,'transcribed');assert.equal(f.transcriptions.length,2);assert.equal((await f.run()).cached,true);assert.equal(f.transcriptions.length,2);
});

test('empty speech, partial processing and invalid transcript attribution stay distinct',async t=>{
 const f=fixture(t);
 f.transcript(result=>({...result,segments:result.segments.map(segment=>({...segment,text:'',state:'no_transcript'}))}));
 const empty=await f.run();assert.equal(empty.status,'no-transcript');assert.equal(empty.whole_record_processed,true);assert.equal(empty.audio_understood,false);
 f.bytes(wav({seed:2}));f.transcript(result=>({...result,segments:result.segments.map(segment=>({...segment,end_ms:500}))}));
 const partial=await f.run();assert.equal(partial.status,'partial');assert.equal(partial.whole_record_processed,false);assert.deepEqual(partial.transcript.unprocessed_ranges,[{start_ms:500,end_ms:1000}]);
 f.bytes(wav({seed:3}));f.transcript(result=>({...result,media_sha256:'0'.repeat(64)}));
 const bad=await f.run();assert.equal(bad.reason,'invalid-transcript');assert.equal(bad.status,'unavailable');assert.equal(f.counts().transcripts,2);
});

test('pause drains conversion and queued callers, ignores late returned WAV, and resume never revives old work',async t=>{
 const f=fixture(t),entered=deferred(),release=deferred();f.driver(async name=>{if(name==='get_record'){entered.resolve();await release.promise;}});
 const pending=f.run(),failed=assert.rejects(pending);await entered.promise;
 const queued=f.run(),queuedFailed=assert.rejects(queued);let drained=false;const stopping=f.voice.pause().then(()=>{drained=true;});
 try{await turn();assert.equal(drained,false);f.voice.resume();}finally{release.resolve();}
 await Promise.all([failed,queuedFailed,stopping]);assert.deepEqual(f.counts(),{transcripts:0,observations:0});assert.equal(f.transcriptions.length,0);assert.equal(f.calls.length,1);
 f.driver(null);assert.equal((await f.run()).status,'transcribed');assert.equal(f.calls.length,2);
});

test('cancellation or admission revocation during local transcription prevents cache and observation writes',async t=>{
 const f=fixture(t),entered=deferred(),release=deferred(),controller=new AbortController();
 f.asr(async(_bytes,{signal})=>{entered.resolve();await release.promise;assert.equal(signal.aborted,true);});
 const tools=f.voice.tools(f.source,{scope:f.scope,signal:controller.signal,canAct:()=>true}),running=f.run('listen_qq_voice',{},tools),failed=assert.rejects(running);
 await entered.promise;controller.abort();release.resolve();await failed;assert.deepEqual(f.counts(),{transcripts:0,observations:0});
 f.asr(()=>f.pending.delete(f.scope.address+'|100'));await assert.rejects(f.run(),/admitted/);assert.deepEqual(f.counts(),{transcripts:0,observations:0});
});

test('close waits for decoder drain, rejects new work and never commits the late transcript',async t=>{
 const f=fixture(t),entered=deferred(),release=deferred();f.asr(async()=>{entered.resolve();await release.promise;});
 const running=f.run(),failed=assert.rejects(running);await entered.promise;
 let drained=false;const closing=f.voice.close();closing.then(()=>{drained=true;});assert.equal(f.voice.close(),closing);
 await turn();assert.equal(drained,false);assert.deepEqual(f.counts(),{transcripts:0,observations:0});const newRejected=assert.rejects(f.run());
 release.resolve();await failed;await newRejected;await closing;assert.throws(()=>f.voice.resume(),/closed/);assert.equal(f.voice.pending.size,0);
 await f.reopen();assert.deepEqual(f.counts(),{transcripts:0,observations:0});
});

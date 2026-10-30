// Synthetic local data only. Optional pinned local model test; no downloads/network/QQ.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readdirSync,rmSync,linkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import worker from './audio-worker.cjs';
import {planAudioSegments,readAudioConfig,createVideoAudioTranscriber,audioDecoderAvailable,transcribeVideoAudio} from './video-audio.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const roots=[];
const temp=()=>{const path=mkdtempSync(join(tmpdir(),'whale-audio-test-'));roots.push(path);return path;};
function wav(seconds=1,value=1000){
  const count=Math.round(seconds*16000),b=Buffer.alloc(44+count*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);for(let i=44;i<b.length;i+=2)b.writeInt16LE(value,i);return b;
}
function fakeNative(text='合成测试文字'){
  const calls={models:0,streams:0,decoded:0};
  return {calls,async createOfflineRecognizerAsync(config){calls.models++;assert.equal(config.featConfig.sampleRate,16000);assert.equal(config.modelConfig.provider,'cpu');return {};},
    createOfflineStream(){calls.streams++;return {};},acceptWaveformOffline(stream,value){assert.ok(value.samples instanceof Float32Array);assert.equal(value.sampleRate,16000);},
    async decodeOfflineStreamAsync(){calls.decoded++;return JSON.stringify({text});}};
}
function job(segments=[{file:'clip-0.wav',start_seconds:0,seconds:1}]){return {version:1,language:'auto',media_sha256:'a'.repeat(64),source_duration_seconds:segments.at(-1).start_seconds+segments.at(-1).seconds,start_seconds:segments[0].start_seconds,segments};}
function configFixture(){
  const root=temp(),bytes=Buffer.from('synthetic pinned asset'),hash=sha(bytes);
  const file=name=>{const path=join(root,name);writeFileSync(path,bytes);return {path,sha256:hash};};
  const config={version:1,model_id:'sensevoice-small-int8-2024-07-17',language:'auto',model:file('model'),tokens:file('tokens'),native_files:['sherpa-onnx.node','onnxruntime.dll','onnxruntime_providers_shared.dll','sherpa-onnx-c-api.dll','sherpa-onnx-cxx-api.dll'].map(name=>({name,...file(name)}))};
  const configPath=join(root,'config.json');writeFileSync(configPath,JSON.stringify(config));return {root,configPath,config};
}
function fakeBoundary({seconds,edit,fail,waitForAbort=false}={}){
  const state={prepared:0,ran:0,closed:false};return {state,ready:()=>true,async prepare(){state.prepared++;return {synthetic:true};},async run({work,job,signal}){
    state.ran++;
    try{
      if(waitForAbort)await new Promise((ok,no)=>{const abort=()=>no(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
      if(fail)throw Error(fail);
      for(const s of job.segments)writeFileSync(join(work,s.file),wav(Math.min(s.seconds,seconds??s.seconds)));
      const result=await worker.transcribeWavs(job,{root:work,native:fakeNative()});edit?.(result,work);writeFileSync(join(work,'transcript.json'),JSON.stringify(result));
      return {synthetic:true,backend:'synthetic-boundary'};
    }finally{state.closed=true;}
  }};
}

test('duration/segments/input bounds stay explicit',async()=>{
  const p=planAudioSegments({duration:900});assert.equal(p.seconds,120);assert.equal(p.segments.length,4);assert.deepEqual(p.segments.map(x=>x.start_seconds),[0,30,60,90]);
  assert.equal(planAudioSegments({duration:900,maxSeconds:300}).segments.length,10);
  assert.deepEqual(planAudioSegments({duration:900,startSeconds:305,maxSeconds:45}).segments.map(s=>[s.start_seconds,s.seconds]),[[305,30],[335,15]]);
  for(const options of [{duration:0},{duration:Infinity},{duration:1,maxSeconds:301},{duration:100,segmentSeconds:0},{duration:300,segmentSeconds:1},{duration:1,timeoutMs:999},{duration:10,startSeconds:-1},{duration:10,startSeconds:10}])assert.throws(()=>planAudioSegments(options),/bound/);
  const fixture=configFixture(),boundary=fakeBoundary(),run=createVideoAudioTranscriber({configPath:fixture.configPath,boundary});
  await assert.rejects(()=>run(Buffer.alloc(64_000_001),{root:join(fixture.root,'runs'),duration:1}),/audio-input-bound/);assert.equal(boundary.state.prepared,0);
});

test('config only permits known pinned assets; readiness missing file is false',()=>{
  const f=configFixture();assert.equal(readAudioConfig(f.configPath).native_files.length,5);
  const bad={...f.config,native_files:[...f.config.native_files.slice(1),f.config.native_files[1]]};writeFileSync(f.configPath,JSON.stringify(bad));assert.throws(()=>readAudioConfig(f.configPath),/native-list/);
  writeFileSync(f.configPath,JSON.stringify({...f.config,model:{path:'relative.onnx',sha256:'a'.repeat(64)}}));assert.throws(()=>readAudioConfig(f.configPath),/config/);
  assert.equal(audioDecoderAvailable({configPath:join(f.root,'not-installed.json')}),false);
});

test('WAV decoder rejects wrong rate/stereo/truncation and keeps actual sample time',()=>{
  const bytes=wav(0.25);assert.equal(worker.parsePcmWav(bytes).samples.length,4000);assert.equal(worker.parsePcmWav(bytes).seconds,0.25);
  for(const at of [22,24,34]){const bad=Buffer.from(bytes);bad[at]=0;assert.throws(()=>worker.parsePcmWav(bad),/invalid-pcm/);}
  assert.throws(()=>worker.parsePcmWav(bytes.subarray(0,bytes.length-1)),/invalid-pcm/);
  assert.throws(()=>worker.parsePcmWav(wav(2),1),/invalid-pcm/);
  assert.throws(()=>worker.parsePcmWav(wav(15+7/16000),15),e=>e.message==='invalid-pcm-wav:sample-bound'&&e.pcm_diagnostics.samples===240007&&e.pcm_diagnostics.max_samples===240000);
});

test('one recognizer serves all segments, times come from local PCM not ASR tokens',async()=>{
  const root=temp(),native=fakeNative('<|zh|><|NEUTRAL|> 这是合成内容。 '),segments=[{file:'clip-0.wav',start_seconds:0,seconds:30},{file:'clip-1.wav',start_seconds:30,seconds:30}];
  writeFileSync(join(root,'clip-0.wav'),wav(0.5));writeFileSync(join(root,'clip-1.wav'),wav(0.75));
  const result=await worker.transcribeWavs(job(segments),{root,native});assert.equal(native.calls.models,1);assert.equal(native.calls.decoded,2);
  assert.deepEqual(result.segments.map(x=>[x.start_ms,x.end_ms]),[[0,500],[30000,30750]]);assert.equal(result.segments[0].text,'这是合成内容。');assert.equal(result.audio_understood,false);assert.equal(result.non_speech_understood,false);assert.equal(result.alignment,'segment-window-not-word-timestamps');
});

test('empty ASR is not declared no-speech; exact PCM silence has no invented transcript',async()=>{
  const root=temp(),native=fakeNative(''),segments=[{file:'clip-0.wav',start_seconds:0,seconds:1},{file:'clip-1.wav',start_seconds:1,seconds:1}];writeFileSync(join(root,'clip-0.wav'),wav(1,0));writeFileSync(join(root,'clip-1.wav'),wav(1,500));
  const result=await worker.transcribeWavs(job(segments),{root,native});assert.deepEqual(result.segments.map(s=>s.state),['silent_pcm','no_transcript']);assert.deepEqual(result.segments.map(s=>s.text),['','']);assert.equal(native.calls.decoded,1);
});

test('ASR errors, excess text, unsafe WAV and arbitrary local job paths fail',async()=>{
  const root=temp();writeFileSync(join(root,'clip-0.wav'),wav());
  await assert.rejects(()=>worker.transcribeWavs(job(),{root,native:fakeNative('x'.repeat(4001))}),/text-limit/);
  const native=fakeNative();native.decodeOfflineStreamAsync=async()=>{throw Error('synthetic-asr-failure');};await assert.rejects(()=>worker.transcribeWavs(job(),{root,native}),/audio-asr-decode-failed/);
  await assert.rejects(()=>worker.transcribeWavs(job([{file:'../outside.wav',start_seconds:0,seconds:1}]),{root,native:fakeNative()}),/invalid-audio-job/);
  linkSync(join(root,'clip-0.wav'),join(root,'linked.wav'));await assert.rejects(()=>worker.transcribeWavs(job(),{root,native:fakeNative()}),/unsafe-audio-artifact/);
});

test('full orchestrator preserves source hashes, partial coverage and unread ranges',async()=>{
  const f=configFixture(),boundary=fakeBoundary({seconds:1}),root=join(f.root,'runs'),bytes=Buffer.from('synthetic media bytes'),run=createVideoAudioTranscriber({configPath:f.configPath,boundary});
  const result=await run(bytes,{root,duration:200,startSeconds:5,maxSeconds:60});assert.equal(result.kind,'speech-transcript');assert.equal(result.media_sha256,sha(bytes));assert.equal(result.evidence.model_sha256,f.config.model.sha256);
  assert.deepEqual(result.evidence.coverage,[{start_ms:5000,end_ms:6000},{start_ms:35000,end_ms:36000}]);assert.deepEqual(result.evidence.unprocessed_ranges,[{start_ms:0,end_ms:5000},{start_ms:6000,end_ms:35000},{start_ms:36000,end_ms:200000}]);assert.equal(result.evidence.requested_start_seconds,5);assert.equal(result.evidence.requested_seconds,60);assert.equal(result.evidence.whole_video_watched,false);assert.equal(result.evidence.synthetic,true);assert.deepEqual(readdirSync(root),[]);assert.equal(boundary.state.closed,true);
});

test('host rejects forged timings/samples/hash and oversized transcript artifacts',async()=>{
  for(const edit of [r=>r.segments[0].end_ms=99999,r=>r.segments[0].samples++,r=>r.media_sha256='b'.repeat(64),r=>r.segments[0].text='x'.repeat(132000)]){
    const f=configFixture(),root=join(f.root,'runs'),run=createVideoAudioTranscriber({configPath:f.configPath,boundary:fakeBoundary({edit})});await assert.rejects(()=>run(Buffer.from('media'),{root,duration:1}),/audio.*artifact/);assert.deepEqual(readdirSync(root),[]);
  }
});

test('decode failure and cancellation return no transcript and clean after boundary close',async()=>{
  const f=configFixture(),root=join(f.root,'runs'),failed=fakeBoundary({fail:'audio-decode-failed'}),run=createVideoAudioTranscriber({configPath:f.configPath,boundary:failed});await assert.rejects(()=>run(Buffer.from('media'),{root,duration:1}),/decode-failed/);assert.equal(failed.state.closed,true);assert.deepEqual(readdirSync(root),[]);
  const before=new AbortController();before.abort();const untouched=fakeBoundary();await assert.rejects(()=>createVideoAudioTranscriber({configPath:f.configPath,boundary:untouched})(Buffer.from('media'),{root,duration:1,signal:before.signal}),{name:'AbortError'});assert.equal(untouched.state.prepared,0);
  const during=new AbortController(),waiting=fakeBoundary({waitForAbort:true}),pending=createVideoAudioTranscriber({configPath:f.configPath,boundary:waiting})(Buffer.from('media'),{root,duration:1,signal:during.signal});setImmediate(()=>during.abort());await assert.rejects(()=>pending,{name:'AbortError'});assert.equal(waiting.state.closed,true);assert.deepEqual(readdirSync(root),[]);
});

test('optional real zero-capability ffmpeg + pinned local ASR, synthetic PCM only',{skip:process.env.WHALE_AUDIO_NATIVE_TEST!=='1'},async()=>{
  const root=temp(),bytes=wav(0.25,1000),result=await transcribeVideoAudio(bytes,{root:join(root,'runs'),duration:0.25,maxSeconds:0.25,timeoutMs:60000});
  assert.equal(result.kind,'speech-transcript');assert.equal(result.media_sha256,sha(bytes));assert.equal(result.audio_understood,false);assert.equal(result.non_speech_understood,false);
  assert.equal(result.evidence.appcontainer,true);assert.equal(result.evidence.capabilities,0);assert.equal(result.evidence.process_tree_drained,true);assert.equal(result.evidence.profile_cleanup,true);assert.deepEqual(result.evidence.coverage,[{start_ms:0,end_ms:250}]);assert.deepEqual(result.evidence.unprocessed_ranges,[]);assert.deepEqual(readdirSync(join(root,'runs')),[]);
  // The input is not speech; no expected transcript is invented for it.
});

test.after(()=>{const parent=realpathSync(tmpdir());for(const root of roots){const target=realpathSync(root);assert.ok(target.startsWith(parent+sep)&&resolve(root)===resolve(target));rmSync(root,{recursive:true,force:true});}});

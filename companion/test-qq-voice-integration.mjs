import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {ConversationService} from './conversation-service.mjs';
import {QQVoice,inspectVoiceWav} from './qq-voice.mjs';

const SELF='910490001',HUMAN='910490002',OTHER='910490003',GROUP='910490004';
const phrase='合成语音里的紫色风筝',now=Date.now();
const call=(name,args,id)=>({response:{output:[{type:'function_call',name,call_id:id,arguments:JSON.stringify(args)}]}});
const answer=()=>({response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'这句听到了，机器转写也可能有误。'}]}]}});
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function wave(){const b=Buffer.alloc(32044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(32000,40);return b;}
function fixture(t,{quoted=false,decodeGate=null}={}){
 const root=mkdtempSync(join(tmpdir(),'whale-voice-integration-')),bytes=wave(),sends=[],requests=[];let result,service;
 const current={post_type:'message',message_type:quoted?'group':'private',message_id:101,user_id:Number(HUMAN),sender:{user_id:Number(HUMAN)},time:Math.floor(now/1000),
  ...(quoted?{group_id:Number(GROUP)}:{}),message:quoted?[{type:'at',data:{qq:SELF}},{type:'reply',data:{id:'100'}},{type:'text',data:{text:'听听这条语音'}}]:[{type:'record',data:{file:'already-received-record'}}]};
 const original={...current,message_id:100,user_id:Number(OTHER),sender:{user_id:Number(OTHER)},time:current.time-60,message:[{type:'record',data:{file:'quoted-record'}}]};
 service=new ConversationService({root,botId:SELF,guardianIds:[HUMAN],publicProfile:'Synthetic conversational voice fixture.',isAllowed:()=>true,wait:async()=>{},
  client:{respond:async req=>{requests.push(req);if(requests.length===1){assert.ok(req.tools.some(x=>x.name==='listen_qq_voice'),'received record automatically exposes the voice capability');return call('listen_qq_voice',quoted?{message_id:'100'}:{},'voice');}
   result=JSON.parse(req.input.find(x=>x.type==='function_call_output').output);return answer();}},send:async x=>sends.push(x)});
 const voice=new QQVoice({path:join(root,'voice.sqlite3'),root:join(root,'jobs'),service,ready:()=>true,driver:{callApi:async(name,args)=>{if(name==='get_msg'){assert.equal(args.message_id,100);return original;}assert.equal(name,'get_record');return {base64:bytes.toString('base64')};}},
  transcriber:async(data,{duration,signal})=>{if(decodeGate){decodeGate.entered.resolve();await decodeGate.release.promise;signal.throwIfAborted();}
   return {version:1,kind:'speech-transcript',media_sha256:inspectVoiceWav(data).sha256,alignment:'segment-window-not-word-timestamps',audio_understood:false,non_speech_understood:false,
    segments:[{start_ms:0,end_ms:1000,text:phrase,state:'transcribed'}],evidence:{source_duration_seconds:duration}};}});
 service.qqVoice=voice;
 t.after(async()=>{await service.close();const target=realpathSync(root);assert.ok(target.startsWith(realpathSync(tmpdir())+sep));rmSync(target,{recursive:true,force:true});});
 return {root,service,voice,current,original,sends,requests,get result(){return result;}};
}
test('plain received voice is discoverable on the actual service and saved with its original author/time',async t=>{
 const f=fixture(t);assert.equal((await f.service.receiveAdmitted(f.current)).status,'sent');
 assert.equal(f.result.status,'transcribed');assert.equal(f.result.memory.status,'recorded');assert.equal(f.sends.length,1);
 const row=f.service.cognition.store.db.prepare("SELECT id FROM experiences WHERE event='voice:101:0'").get(),memory=f.service.cognition.store.get({id:row.id});
 assert.equal(memory.sender_id,HUMAN);assert.equal(memory.at,f.current.time*1000);assert.equal(memory.scope,'private:'+HUMAN);assert.match(memory.text,/紫色风筝/);
 const plain=f.service.cognition.store.db.prepare("SELECT current_revision FROM experiences WHERE event='101' AND role='user'").get();
 assert.ok(plain);const original=f.service.cognition.store.db.prepare('SELECT text FROM experience_versions WHERE id=?').get(plain.current_revision).text;
 assert.doesNotMatch(original,/紫色风筝/);assert.equal(JSON.parse(memory.text).recording_voice_identity_verified,false);
 // Unified recall remains possible from a later, different destination.
 assert.ok(f.service.cognition.store.search({query:'紫色风筝'}).records.some(x=>x.id===row.id));
});
test('quoted group voice remains the quoted author and minute, never the person asking to listen',async t=>{
 const f=fixture(t,{quoted:true});assert.equal((await f.service.receiveAdmitted(f.current)).status,'sent');
 assert.equal(f.result.source.author_id,OTHER);assert.equal(f.result.source.at,f.original.time*1000);assert.equal(f.result.source.relation,'direct-reply');
 const row=f.service.cognition.store.db.prepare("SELECT sender_id,at,scope FROM experiences WHERE event='voice:100:0'").get();
 assert.equal(row.sender_id,OTHER);assert.equal(row.at,f.original.time*1000);assert.equal(row.scope,'group:'+GROUP);assert.equal(String(f.sends[0].target.id),GROUP);
});
test('service pause drains local recognition and cannot record or send a late result',async t=>{
 const gate={entered:defer(),release:defer()},f=fixture(t,{decodeGate:gate});
 const running=f.service.receiveAdmitted(f.current);await gate.entered.promise;const paused=f.service.pause();gate.release.resolve();await paused;await running;
 assert.equal(f.sends.length,0);assert.equal(f.voice.db.prepare('SELECT count(*) n FROM qq_voice_observations').get().n,0);
 assert.equal(f.service.cognition.store.db.prepare("SELECT count(*) n FROM experiences WHERE event LIKE 'voice:%'").get().n,0);
 f.service.resume();assert.equal(f.voice.paused,false);await f.service.close();assert.equal(f.voice.closed,true);
});

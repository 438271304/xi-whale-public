import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {EventLedger} from './event-ledger.mjs';
const [app,plugin,pinned]=process.argv.slice(2);
const {prepareScopedAssembly}=await import(pinned?pathToFileURL(join(pinned,'scoped-assembly.mjs')).href:new URL('./scoped-assembly.mjs',import.meta.url).href);
await import(pathToFileURL(join(app,'build/cortico/src/extensions/runtime.ts')).href);
const {QQWorld}=await import(pathToFileURL(join(plugin,'src/world.ts')).href);
const root=mkdtempSync(join(tmpdir(),'whale-image-qq-')),world=new QQWorld({wsUrl:'ws://127.0.0.1:1',groups:[12345],privates:[],token:''});mkdirSync(join(root,'source'));
let sent=0,shared=0,visions=0,replies=0;
world.start=async function(host){this.host=host;this.driver={setGroups:()=>{},identity:{selfId:34567,groups:new Map()},callApi:async action=>{assert.equal(action,'send_group_msg');return {message_id:++sent+1000};}};};world.stop=async()=>{};
const ledger=new EventLedger(':memory:'),now=new Date('2026-10-25T12:00:00+08:00');
const route=prepareScopedAssembly({world,root:join(root,'scoped'),workspace:join(root,'workspace'),sourceData:join(root,'source'),policy:{group_id:'12345',bot_id:'34567'},ledger,clock:()=>now,publicProfile:'Synthetic image assembly test',manifest:'companion/sticker-seed.json',assets:'companion/assets/stickers',fetcher:async()=>new Response(readFileSync('companion/artifacts/image-synthetic-20261025.png'),{headers:{'content-type':'application/octet-stream'}}),client:{respond:async req=>{
 if(req.instructions.startsWith('You analyze one image')){visions++;assert.equal(req.input[0].content[1].type,'input_image');return {response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({description:'synthetic red square and blue circle',ocr_text:'SEA 731',uncertainty:'synthetic fixture'})}]}]}};}
 replies++;const body=JSON.stringify(req.input);assert.ok(body.includes('vision-ok')&&body.includes('SEA 731'));assert.ok(!body.includes('rkey=SECRET'));assert.ok(!req.tools.some(t=>t.name==='write_note'||t.name==='workroom_publish'));return {response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic image understood.'}]}]}};
}}});
assert.equal(route.service.imageAnalyzer.capabilities.vision,true);
let paused=true;route.attachCore({bus:{isPaused:()=>paused,setPaused:value=>paused=value}});await world.start({pushEvent:async()=>shared++});route.resume();
const result=await world.handleEvent({post_type:'message',message_type:'group',group_id:12345,user_id:45678,message_id:1,time:now.getTime()/1000,message:[{type:'image',data:{file:'https://multimedia.nt.qq.com.cn/synthetic?rkey=SECRET'}}]});
assert.equal(result.status,'sent');assert.equal(visions,1);assert.equal(replies,1);assert.equal(sent,1);assert.equal(shared,0);
const row=route.service.media.list({kind:'group',id:12345}).find(r=>r.analysis_status==='vision-ok');assert.ok(row);assert.ok(route.service.media.analysis({kind:'group',id:12345},row.id).ocr.text.includes('731'));
await world.stop();ledger.close();console.log('PASS pinned QQWorld -> file/official CDN -> actual fixed decode/local OCR -> fake vision -> scoped chat -> fake QQ send; no live QQ or paid call');

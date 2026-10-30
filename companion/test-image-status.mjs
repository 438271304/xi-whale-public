import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ConversationService} from './conversation-service.mjs';
const scope={kind:'group',id:'12345'},root=mkdtempSync(join(tmpdir(),'whale-image-status-'));let analyses=0,requests=0,seen;
const service=new ConversationService({root,publicProfile:readFileSync('companion/identity/SCOPED_PROFILE.md','utf8'),botId:'34567',isAllowed:()=>true,send:async()=>{},imageAnalyzer:{capabilities:{vision:true,ocr:'local-windows'},analyze:async()=>{analyses++;throw Error('No new image');}},client:{respond:async req=>{
 requests++;if(requests===1){seen=JSON.parse(req.input.at(-1).content).transport.image_runtime;assert.equal(seen.current_message_has_image,false);assert.equal(seen.vision_configured,true);assert.equal(seen.received_in_current_chat,0);assert.equal(seen.public_sticker_seeds,1);return {response:{output:[{type:'function_call',call_id:'status',name:'image_status',arguments:'{}'}]}};}
 const status=JSON.parse(req.input.at(-1).output);assert.equal(status.analyzer_configured,true);assert.equal(status.vision_configured,true);assert.equal(status.history_backfill_guaranteed,false);return {response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'当前识图已配置；没有新图，旧图不会自动补收。'}]}]}};
}}});
service.media.importApprovedSeed(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(16)]),'synthetic approved sticker');
const seed=service.media.list(scope)[0];assert.equal(seed.origin,'public-sticker-seed');assert.equal(seed.analysis_status,'not-analyzed');
await service.engine.receive('group:12345','old','{"body":"[image]"}',{listenOnly:true});
const result=await service.receiveAdmitted({message_type:'group',group_id:12345,user_id:45678,message_id:1,time:Date.now()/1000,message:[{type:'text',data:{text:'图片接好了吗，旧图不在清单？'}}]});assert.equal(result.status,'sent');assert.equal(analyses,0);assert.equal(requests,2);
assert.equal(service.imageStatus({kind:'private',id:'12345'},false).received_in_current_chat,0);await service.close();
console.log('PASS image availability/inventory separation: text-only current status, unseen old image not replayed, public seed origin/unanalysed distinct, status tool read-only/no vision call, source isolation');

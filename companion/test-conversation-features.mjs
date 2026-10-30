import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ConversationService} from './conversation-service.mjs';
import {conversationExtras,importStickerSeeds} from './conversation-extras.mjs';
const root=mkdtempSync(join(tmpdir(),'whale-features-')),workspace=join(root,'workspace');
const file=join(workspace,'projects/home/card.json');
const extras=conversationExtras({workspace,notesRoot:join(root,'notes'),familyGroup:'12345',fetcher:async url=>{
 assert.equal(url,'http://127.0.0.1:17790/api/home');
 return new Response(JSON.stringify({at:new Date().toISOString(),card:existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{},stickers:[]}),{status:200});
}});
const privateTools=extras({kind:'private',id:'23456'}),familyTools=extras({kind:'group',id:'12345'});
assert.ok(!privateTools.some(t=>t.name==='home_update'));assert.ok(privateTools.some(t=>t.name==='public_read'));
await privateTools.find(t=>t.name==='home_draft').handler({text:'PRIVATE_DRAFT'});assert.equal(existsSync(file),false);
const update=JSON.parse(await familyTools.find(t=>t.name==='home_update').handler({mood:'好奇',today:'准备看海'}));
assert.equal(update.page_readback_verified,true);assert.ok(!readFileSync(file,'utf8').includes('PRIVATE_DRAFT'));
let calls=0,sent=0,captured;
const service=new ConversationService({root:join(root,'service'),publicProfile:'public',isAllowed:()=>true,extraTools:extras,client:{respond:async req=>{
 calls++;captured=req;return {response:{output:[{type:'function_call',name:'stay_quiet',call_id:'quiet',arguments:'{}'}]}};
}},send:async()=>sent++});
assert.deepEqual(importStickerSeeds(service.media,{manifest:'companion/sticker-seed.json',assets:'companion/assets/stickers'}),{seeds:7});
importStickerSeeds(service.media,{manifest:'companion/sticker-seed.json',assets:'companion/assets/stickers'});
assert.equal(service.media.list({kind:'private',id:'23456'}).length,7);assert.ok(service.media.list({kind:'private',id:'23456'})[0].description.length>0);
const result=await service.receiveAdmitted({message_type:'group',group_id:12345,user_id:45678,message_id:101,time:1792880000,message:[{type:'text',data:{text:'随便聊聊'}}]});
assert.equal(result.status,'quiet');assert.equal(calls,1);assert.equal(sent,0);
const envelope=JSON.parse(captured.input[0].content);assert.equal(envelope.transport.sender_id,'45678');assert.equal(envelope.transport.conversation,'group:12345');
assert.equal(service.engine.db.prepare("SELECT COUNT(*) n FROM turns WHERE role='assistant'").get().n,0);
await service.close();console.log('PASS silence in one model call, sender attribution, home read/write/draft boundaries, reading shelf mounted, seven real stickers imported once with descriptions; no network or QQ sends');

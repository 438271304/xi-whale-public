// In-memory media/catalog, synthetic catalog transport, existing approved PNG
// fixtures. No provider, analysis, download, QQ driver or external delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {LifeShareMedia} from './life-share-media.mjs';
import {ScopedMedia} from './scoped-media.mjs';
import {FixedFisharchiveCatalog} from './fisharchive-stickers.mjs';
import {buildNativeMessage} from './qq-face-output.mjs';

const SELF='910010001',HUMAN='910010003';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const jpeg=label=>Buffer.concat([Buffer.from([255,216,255,224]),Buffer.from(sha(label),'hex')]);
const clone=value=>JSON.parse(JSON.stringify(value));
const legacy=()=>readFileSync(new URL('./assets/stickers/deepseek-bixin.png',import.meta.url));
function fixture(t){
 const media=new ScopedMedia(':memory:'),service={botId:SELF,media,paused:false,closed:false},requests=[];
 const row={filename:'fixture.png',original:'media/fixture.png',preview:'previews/fixture.webp',large:'large/fixture.webp',alt:'Synthetic site label',tags:['fixture'],width:320,height:320};
 const cat=new FixedFisharchiveCatalog({path:':memory:',media,request:async url=>{requests.push(url);return url.endsWith('manifest.json')?Buffer.from(JSON.stringify([row])):jpeg('synthetic catalog asset');},
  prepare:async()=>({ok:true,mime:'image/jpeg',base64:jpeg('normalized fixture').toString('base64'),width:320,height:320,metadata_stripped:true,first_frame_only:false})});
 service.stickers=cat;const adapter=new LifeShareMedia({service});
 t.after(async()=>{await cat.close();media.close();});return {media,service,cat,adapter,requests,
  seed:()=>media.importApprovedSeed(legacy(),'Approved historical label'),catalog:async()=>(await cat.collect(row.filename)).image_id};
}

test('empty plans keep the text-only expression unchanged and do not require media or acquire new authority',()=>{
 const adapter=new LifeShareMedia({service:{paused:true,closed:true}});
 for(const selection of [undefined,null,{}, {native_face_ids:[]}])assert.equal(adapter.prepare(selection),null);
 for(const plan of [undefined,null])assert.deepEqual({text:'unchanged',...adapter.revalidate(plan)},{text:'unchanged'});
 const controller=new AbortController();controller.abort();assert.deepEqual(adapter.revalidate(null,{signal:controller.signal}),{});
});

test('mapped native faces are canonical, bounded and serializable; no image is added automatically',t=>{
 const f=fixture(t),found=f.adapter.findFaces({query:'微笑'});assert.ok(found.matches.length);
 const ids=[found.matches[0].id],plan=f.adapter.prepare({native_face_ids:ids});
 assert.deepEqual(plan.native_face_ids,ids);assert.equal(plan.metadata.native_faces[0].name,found.matches[0].name);
 assert.deepEqual(plan.metadata.native_face_map,found.source);assert.ok(Object.isFrozen(plan.metadata.native_faces[0]));
 assert.deepEqual(f.adapter.revalidate(clone(plan)),{faces:plan.metadata.native_faces});assert.equal(f.requests.length,0);
 for(const native_face_ids of [['999999'],['1','2','3','4'],['https://example.org/a'],['/tmp/a'],null])assert.throws(()=>f.adapter.prepare({native_face_ids}));
 for(const extra of [{url:'https://example.org/a'},{path:'C:/secret'},{target_id:HUMAN},{faces:[{id:'0'}]}])assert.throws(()=>f.adapter.prepare(extra));
});

test('only the seven exact deployed PNG hashes are accepted as legacy public assets',t=>{
 const f=fixture(t),names=['deepseek-bao-jing-shui-jiao','deepseek-bixin','deepseek-bu-lai','deepseek-da-ku','deepseek-jushou-dazhaohu','deepseek-touding-wenhao','deepseek-zhangkai-shuangshou-huanhu'];
 for(const name of names){
  const bytes=readFileSync(new URL('./assets/stickers/'+name+'.png',import.meta.url));
  const imported=f.media.importApprovedSeed(bytes,'Approved seed'),plan=f.adapter.prepare({public_image_id:imported.id});
  assert.equal(plan.metadata.public_image.source.seed_id,name);assert.equal(plan.metadata.public_image.sha256,sha(bytes));
  assert.equal(plan.metadata.public_image.mime,'image/png');assert.deepEqual(f.adapter.revalidate(clone(plan)).imageBytes,bytes);
 }
 const unapproved=f.media.importApprovedSeed(jpeg('unapproved'),'deepseek-bixin');
 assert.throws(()=>f.adapter.prepare({public_image_id:unapproved.id}),/Verified public sticker/);
 assert.equal(f.requests.length,0);
});

test('real catalog provenance and saved bytes are pinned without carrying labels, paths, URLs or image understanding into intent metadata',async t=>{
 const f=fixture(t),id=await f.catalog(),before=f.requests.length;
 const scopes=[],imageBytes=f.media.imageBytes.bind(f.media);f.media.imageBytes=(scope,id)=>{scopes.push(scope.key);return imageBytes(scope,id);};
 const plan=f.adapter.prepare({native_face_ids:['0'],public_image_id:id});
 assert.equal(plan.metadata.public_image.source.kind,'fixed-public-catalog');assert.equal(plan.metadata.public_image.source.author_known,false);
 assert.equal(plan.metadata.public_image.source.metadata_stripped,true);assert.equal(plan.metadata.public_image.sha256,sha(jpeg('normalized fixture')));
 assert.doesNotMatch(JSON.stringify(plan),/https:|fixture label|base64|C:\\|vision|analysis/i);assert.ok(JSON.stringify(plan).length<2500);
 const restored=new LifeShareMedia({service:f.service}).revalidate(clone(plan));
 assert.equal(restored.faces[0].id,'0');assert.deepEqual(restored.imageBytes,jpeg('normalized fixture'));assert.equal(restored.mime,'image/jpeg');
 assert.equal(f.requests.length,before);assert.equal(f.media.db.prepare('SELECT count(*) n FROM image_analysis').get().n,0);
 assert.ok(scopes.length>0);assert.ok(scopes.every(scope=>scope==='private-'+SELF));
});

test('public inventory is bounded and excludes private owner rows and arbitrary approved labels',async t=>{
 const f=fixture(t);f.seed();const id=await f.catalog();
 const privateImage=f.media.insert('private-'+HUMAN,legacy(),'synthetic-private-event');
 const ownPrivate=f.media.insert('private-'+SELF,legacy(),'synthetic-own-private-event');
 const other=f.media.importApprovedSeed(jpeg('arbitrary'),'Approved historical label');
 for(const denied of [privateImage.id,ownPrivate.id,other.id])assert.throws(()=>f.adapter.prepare({public_image_id:denied}));
 const first=f.adapter.listPublicImages({limit:1});assert.equal(first.public_seed_candidates,3);assert.equal(first.unavailable_in_page,1);assert.equal(first.next_offset,1);
 const second=f.adapter.listPublicImages({offset:1,limit:1});assert.equal(second.items[0].public_image_id,id);assert.equal(second.items[0].label_is_image_understanding,false);
 const last=f.adapter.listPublicImages({offset:2,limit:1});assert.equal(last.items[0].source.kind,'approved-legacy-sticker');assert.equal(last.next_offset,null);
 assert.throws(()=>f.adapter.listPublicImages({scope:'private:'+HUMAN}));assert.throws(()=>f.adapter.listPublicImages({limit:21}));
});

test('sending revalidation rejects byte tampering, changed images and removed or relabeled provenance after durable preparation',async t=>{
 const f=fixture(t),id=await f.catalog(),plan=clone(f.adapter.prepare({public_image_id:id}));
 const original=f.media.db.prepare('SELECT bytes,sha FROM scoped_media WHERE id=?').get(id);
 f.media.db.prepare('UPDATE scoped_media SET bytes=? WHERE id=?').run(jpeg('tampered'),id);
 assert.throws(()=>f.adapter.revalidate(plan),/integrity/);
 f.media.db.prepare('UPDATE scoped_media SET bytes=?,sha=? WHERE id=?').run(jpeg('replaced'),sha(jpeg('replaced')),id);
 assert.throws(()=>f.adapter.revalidate(plan),/Verified public sticker/);
 f.media.db.prepare('UPDATE scoped_media SET bytes=?,sha=? WHERE id=?').run(original.bytes,original.sha,id);
 f.media.db.prepare('UPDATE scoped_media SET owner=? WHERE id=?').run('private-'+HUMAN,id);
 assert.throws(()=>f.adapter.revalidate(plan),/Approved public image/);
 f.media.db.prepare("UPDATE scoped_media SET owner='public-seed' WHERE id=?").run(id);
 const source=f.cat.sourceForImage(id);source.manifest_sha256='f'.repeat(64);
 f.cat.db.prepare('UPDATE fisharchive_assets SET source=? WHERE image_id=?').run(JSON.stringify(source),id);
 assert.throws(()=>f.adapter.revalidate(plan),/plan changed/);
 f.cat.db.prepare('DELETE FROM fisharchive_assets WHERE image_id=?').run(id);assert.throws(()=>f.adapter.revalidate(plan),/Verified public sticker/);
});

test('even another approved legacy image cannot replace a saved chosen image under the same ID',t=>{
 const f=fixture(t),id=f.seed().id,plan=clone(f.adapter.prepare({public_image_id:id}));
 const replacement=readFileSync(new URL('./assets/stickers/deepseek-da-ku.png',import.meta.url));
 f.media.db.prepare('UPDATE scoped_media SET bytes=?,sha=? WHERE id=?').run(replacement,sha(replacement),id);
 assert.throws(()=>f.adapter.revalidate(plan),/plan changed/);
});

test('saved metadata is strictly validated, order-independent and never evaluated through getters',t=>{
 const f=fixture(t),plan=f.adapter.prepare({native_face_ids:['0']});
 const reordered={metadata:clone(plan.metadata),native_face_ids:['0'],schema:1};assert.deepEqual(f.adapter.revalidate(reordered).faces,plan.metadata.native_faces);
 for(const mutation of [p=>p.schema=2,p=>p.metadata.native_faces[0].name='forged',p=>p.metadata.native_face_map.version='other',p=>p.metadata.url='https://example.org',p=>p.target={kind:'private',id:HUMAN},p=>p.metadata={...p.metadata,text:'hidden'}]){
  const changed=clone(plan);mutation(changed);assert.throws(()=>f.adapter.revalidate(changed));
 }
 let getter=0;const selection={};Object.defineProperty(selection,'public_image_id',{enumerable:true,get(){getter++;return 'fake';}});
 assert.throws(()=>f.adapter.prepare(selection));const ids=[];Object.defineProperty(ids,'0',{enumerable:true,get(){getter++;return '0';}});
 assert.throws(()=>f.adapter.prepare({native_face_ids:ids}));assert.equal(getter,0);
 const extra=['0'];extra['00']='1';assert.throws(()=>f.adapter.prepare({native_face_ids:extra}));
});

test('nonempty attachments honor pause, close and abort at prepare and final revalidation without writes or retry',t=>{
 const f=fixture(t),id=f.seed().id,plan=f.adapter.prepare({public_image_id:id}),controller=new AbortController();
 f.service.paused=true;assert.throws(()=>f.adapter.prepare({native_face_ids:['0']}),/paused/);assert.throws(()=>f.adapter.revalidate(plan),/paused/);
 f.service.paused=false;f.service.closed=true;assert.throws(()=>f.adapter.revalidate(plan),/closed/);f.service.closed=false;
 controller.abort();assert.throws(()=>f.adapter.revalidate(plan,{signal:controller.signal}),{name:'AbortError'});
 assert.equal(f.media.db.prepare('SELECT count(*) n FROM image_sends').get().n,0);assert.equal(f.requests.length,0);
});

test('revalidated text, faces and image form one existing OneBot message, with no separate attachment send or target choice',t=>{
 const f=fixture(t),plan=f.adapter.prepare({native_face_ids:['0','1'],public_image_id:f.seed().id});
 const expression={text:'A single deliberate expression',...f.adapter.revalidate(clone(plan))};
 const message=buildNativeMessage(expression),captured=[];
 const fakeTransport=payload=>{captured.push(payload);return {message_id:1};};
 fakeTransport({message});assert.equal(captured.length,1);assert.deepEqual(message.map(item=>item.type),['text','face','face','image']);
 assert.equal(message[0].data.text,expression.text);assert.match(message[3].data.file,/^base64:\/\//);
 assert.equal(f.media.db.prepare('SELECT count(*) n FROM image_sends').get().n,0);
 assert.doesNotMatch(JSON.stringify(plan),/target|recipient|scope|owner/);
});

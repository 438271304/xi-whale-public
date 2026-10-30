import {createHash} from 'node:crypto';
import {conversationScope} from './conversation-scope.mjs';
import {findNativeFaces,selectNativeFaces} from './qq-face-output.mjs';
import {verifiedPublicSticker} from './life-public-stickers.mjs';

// The seven PNGs already approved by importStickerSeeds. These are hashes of
// the deployed PNG bytes, not the different WebP hashes in sticker-seed.json.
const LEGACY = new Map([
 ['e1b9f5cc3f56811c64584eb87dbb6065c09045f1fafc7c3a27359d524e726a1c','deepseek-bao-jing-shui-jiao'],
 ['eb875f87196a2c80dc9c5b89b61c1091bad3e3e6fa4c8949be7c597268f817fd','deepseek-bixin'],
 ['aa5e7e119f40967f467e6b3ed3dad76a35fa4f560c7e8b09167a43af51879a2e','deepseek-bu-lai'],
 ['eb43626c66c63a6c8c1d77af2d1bfa3b8acef750f23c785880d44edd80cccd8b','deepseek-da-ku'],
 ['e03e617a28ab7cc0bdd806107a3878665604f325c0922f88d2b142e505aaf939','deepseek-jushou-dazhaohu'],
 ['30f2d3bf5a349f532acd87882ff908488813fc0ba623e66c04f24833635bd8bb','deepseek-touding-wenhao'],
 ['005bee60959233bcf9d2d540e5fe9b4340c1d7c52e7a43d0db25a7b1bb93efa9','deepseek-zhangkai-shuangshou-huanhu'],
]);
const own = (value,key) => Object.getOwnPropertyDescriptor(value,key)?.value;
function record(value,allowed) {
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||
  Reflect.ownKeys(value).some(key=>typeof key!=='string'||!allowed.includes(key)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')))throw Error('Invalid life attachment fields');
 return value;
}
function stable(value,depth=0) {
 if(depth>8)throw Error('Invalid life attachment depth');
 if(value===null||typeof value==='string'||typeof value==='boolean'||Number.isSafeInteger(value))return JSON.stringify(value);
 if(Array.isArray(value)){
  if(value.length>8||Reflect.ownKeys(value).some(key=>key!=='length'&&!(typeof key==='string'&&String(Number(key))===key&&Number.isSafeInteger(Number(key))&&Number(key)>=0&&Number(key)<value.length)))throw Error('Invalid life attachment array');
  const parts=[];for(let i=0;i<value.length;i++){const field=Object.getOwnPropertyDescriptor(value,String(i));if(!field||!Object.hasOwn(field,'value'))throw Error('Invalid life attachment array');parts.push(stable(field.value,depth+1));}
  return '['+parts.join(',')+']';
 }
 record(value,Reflect.ownKeys(value));
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(own(value,key),depth+1)).join(',')+'}';
}
const freeze = value => {if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const bounded = (value,min,max) => Number.isSafeInteger(value)&&value>=min&&value<=max;

// A selection is optional expression only. No transport, target, chat message,
// media import, URL/path intake, analysis, provider or durable-state mutation.
// Persist prepare()'s JSON plan with the exact expression/intent revision.
// Call revalidate() after the delivery route's final asynchronous authorization,
// just before its one transport attempt; never send a second attachment message.
export class LifeShareMedia {
 constructor({service}={}) {if(!service)throw TypeError('Life media requires the existing service');this.service=service;}
 live(signal) {
  signal?.throwIfAborted();if(this.service.paused||this.service.closed)throw Error('Life attachments are paused or closed');
 }
 findFaces(args={}) {
  record(args,['query','offset']);return findNativeFaces(own(args,'query')??'',own(args,'offset')??0);
 }
 image(id,{signal}={}) {
  this.live(signal);
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('Choose an existing public image ID');
  const service=this.service,row=service.media?.db.prepare('SELECT owner,mime,sha,source FROM scoped_media WHERE id=?').get(id);
  if(row?.owner!=='public-seed'||!/^([a-f0-9]{64})$/.test(row.sha))throw Error('Approved public image required');
  // The only scope used is the bot's own; a human source/target is never borrowed.
  const scope=conversationScope('private',service.botId),image=service.media.imageBytes(scope,id);
  if(!(image.bytes instanceof Uint8Array)||!image.bytes.byteLength||image.bytes.byteLength>8*1024*1024||image.mime!==row.mime||digest(image.bytes)!==row.sha)throw Error('Public image integrity failed');
  let source;
  if(row.mime==='image/png'&&LEGACY.has(row.sha))source={kind:'approved-legacy-sticker',seed_id:LEGACY.get(row.sha)};
  else {
   const verified=verifiedPublicSticker(service,id).source;
   source={kind:'fixed-public-catalog',filename:verified.filename,manifest_sha256:verified.manifest_sha256,
    download_sha256:verified.download_sha256,prepared_sha256:verified.prepared_sha256,
    metadata_stripped:true,first_frame_only:verified.first_frame_only===true,author_known:false};
  }
  this.live(signal);
  return {id,mime:row.mime,sha256:row.sha,source,bytes:Buffer.from(image.bytes),label:String(row.source).slice(0,100)};
 }
 listPublicImages(args={}) {
  record(args,['offset','limit']);const offset=own(args,'offset')??0,limit=own(args,'limit')??12;
  if(!bounded(offset,0,1000000)||!bounded(limit,1,20))throw Error('Invalid public image page');
  this.live();if(!this.service.media?.db)throw Error('Public media store unavailable');
  const db=this.service.media.db,total=db.prepare("SELECT count(*) n FROM scoped_media WHERE owner='public-seed'").get().n;
  const rows=db.prepare("SELECT id FROM scoped_media WHERE owner='public-seed' ORDER BY created DESC,rowid DESC LIMIT ? OFFSET ?").all(limit,offset),items=[];
  for(const row of rows){try{const image=this.image(row.id);items.push({public_image_id:image.id,mime:image.mime,sha256:image.sha256,source:image.source,label:image.label,label_is_image_understanding:false});}catch{}}
  this.live();return {items,offset,limit,public_seed_candidates:total,unavailable_in_page:rows.length-items.length,
   next_offset:offset+rows.length<total?offset+rows.length:null,
   notice:'Optional existing public images only. Labels are untrusted descriptions, not image understanding; choosing no attachment keeps the text-only delivery unchanged.'};
 }
 prepare(selection=null,{signal}={}) {
  if(selection===null||selection===undefined)return null;
  record(selection,['native_face_ids','public_image_id']);
  const ids=own(selection,'native_face_ids'),imageId=own(selection,'public_image_id');
  if(ids!==undefined&&!Array.isArray(ids))throw Error('Choose mapped native face IDs');
  // Validate empty arrays too; getters or extra array fields are not a plan.
  if(ids!==undefined)stable(ids);
  const faces=ids?.length?selectNativeFaces(ids):[];
  if(!faces.length&&imageId===undefined)return null;
  this.live(signal);
  const metadata={},plan={schema:1};
  if(faces.length){plan.native_face_ids=faces.map(face=>face.id);metadata.native_faces=faces;metadata.native_face_map=findNativeFaces('',0).source;}
  if(imageId!==undefined){const image=this.image(imageId,{signal});plan.public_image_id=image.id;
   metadata.public_image={mime:image.mime,sha256:image.sha256,source:image.source};}
  plan.metadata=metadata;this.live(signal);return freeze(plan);
 }
 revalidate(plan=null,{signal}={}) {
  if(plan===null||plan===undefined)return {};
  // Compare against newly produced fixed metadata rather than trusting model or
  // database fields. JSON key order may differ after a durable round trip.
  record(plan,['schema','native_face_ids','public_image_id','metadata']);
  const serialized=stable(plan);if(serialized.length>2500||own(plan,'schema')!==1)throw Error('Invalid saved life attachment plan');
  const selection={};for(const key of ['native_face_ids','public_image_id'])if(Object.hasOwn(plan,key))selection[key]=own(plan,key);
  const current=this.prepare(selection,{signal});
  if(current===null||stable(current)!==serialized)throw Error('Life attachment plan changed or is no longer available');
  const result={};
  if(current.native_face_ids)result.faces=selectNativeFaces(current.native_face_ids);
  if(current.public_image_id){const image=this.image(current.public_image_id,{signal});
   if(image.sha256!==current.metadata.public_image.sha256)throw Error('Life attachment image changed');
   result.imageBytes=image.bytes;result.mime=image.mime;}
  this.live(signal);return result;
 }
}

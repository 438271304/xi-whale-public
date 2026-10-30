// A fixed public catalog and one-image intake. No arbitrary URL, model request,
// QQ send, cookie or background refresh. Recognition remains the service's job.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {prepareImage} from './image-analysis.mjs';
import {publicHttpsUrl,publicInternetAddress,securePublicRequest} from './public-exploration.mjs';

const SITE='https://fisharchive.cc/',MANIFEST=SITE+'stickers/manifest.json';
const MAX_CATALOG=1024*1024,MAX_IMAGE=8*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fault=code=>Object.assign(Error(code),{code});
const filenameOk=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}\.(?:png|jpe?g|webp|gif)$/i.test(value)&&!value.includes('..');
const stem=filename=>filename.replace(/\.[^.]+$/,'');
const previewUrl=filename=>SITE+'previews/'+stem(filename)+'.webp';
const license=()=>({name:'CC BY-NC-SA 4.0',basis:'site homepage statement observed 2026-10-29',per_asset_verified:false});

function checkedUrl(raw){
 if(typeof raw!=='string'||raw!==MANIFEST&&!/^https:\/\/fisharchive\.cc\/previews\/[A-Za-z0-9][A-Za-z0-9_.-]{0,179}\.webp$/.test(raw)||raw.includes('..'))throw fault('fisharchive-fixed-url-required');
 const url=publicHttpsUrl(raw);if(url.href!==raw||url.hostname!=='fisharchive.cc')throw fault('fisharchive-fixed-url-required');return url;
}
async function abortable(job,signal){
 signal.throwIfAborted();let stop;
 const aborted=new Promise((_,reject)=>{stop=()=>reject(signal.reason??fault('fisharchive-aborted'));signal.addEventListener('abort',stop,{once:true});});
 try{return await Promise.race([Promise.resolve().then(job),aborted]);}finally{signal.removeEventListener('abort',stop);}
}
async function bodyBytes(response,maxBytes,signal){
 const length=response.headers?.get('content-length');
 if(length!==null&&length!==undefined&&(!/^\d+$/.test(length)||Number(length)>maxBytes))throw fault('fisharchive-response-too-large');
 if(!response.body?.getReader)throw fault('fisharchive-empty-response');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await abortable(()=>reader.read(),signal);signal.throwIfAborted();if(done)break;size+=value.byteLength;if(size>maxBytes)throw fault('fisharchive-response-too-large');chunks.push(Buffer.from(value));}}
 finally{void reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks);
}

// Exported for deterministic DNS/redirect tests; production defaults pin the
// HTTPS hostname to a validated public address without redirect-following.
export function createFixedFisharchiveRequest({resolver=lookup,transport=securePublicRequest}={}){
 return async(raw,{signal,maxBytes}={})=>{
  const url=checkedUrl(raw),bound=raw===MANIFEST?MAX_CATALOG:MAX_IMAGE;
  if(maxBytes!==undefined&&!integer(maxBytes,1,bound))throw fault('fisharchive-invalid-response-bound');
  maxBytes??=bound;
  const active=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)]);
  const addresses=await abortable(()=>resolver('fisharchive.cc',{all:true,verbatim:true}),active);active.throwIfAborted();
  if(!Array.isArray(addresses)||!addresses.length||addresses.some(a=>!a||!publicInternetAddress(a.address)||a.family!==isIP(a.address)))throw fault('fisharchive-unsafe-public-dns');
  const response=await abortable(()=>transport(url,{address:addresses.find(a=>a.family===4)??addresses[0],signal:active,maxBytes,requestHeaders:{Accept:raw===MANIFEST?'application/json':'image/webp,image/png,image/jpeg,image/gif'}}),active);
  active.throwIfAborted();
  if(!response||response.redirected||response.url&&response.url!==url.href)throw fault('fisharchive-unverified-redirect');
  if(response.status!==200){void response.body?.cancel().catch(()=>{});throw fault('fisharchive-http-'+String(response.status));}
  const type=response.headers?.get('content-type')??'',encoding=response.headers?.get('content-encoding')??'';
  if(encoding&&encoding!=='identity')throw fault('fisharchive-encoded-response-rejected');
  if(raw===MANIFEST?!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(type):!/^image\/(?:webp|png|jpeg|gif)(?:;|$)/i.test(type))throw fault('fisharchive-response-type-rejected');
  const bytes=await bodyBytes(response,maxBytes,active);active.throwIfAborted();return bytes;
 };
}

function parseCatalog(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>MAX_CATALOG)throw fault('fisharchive-catalog-size-rejected');
 let rows;try{rows=JSON.parse(bytes.toString('utf8'));}catch{throw fault('fisharchive-invalid-catalog');}
 if(!Array.isArray(rows)||rows.length>1000)throw fault('fisharchive-invalid-catalog');
 const seen=new Set();return rows.map(row=>{
  if(!object(row)||!filenameOk(row.filename)||seen.has(row.filename))throw fault('fisharchive-invalid-catalog-entry');seen.add(row.filename);
  const base=stem(row.filename);
  if(row.original!=='media/'+row.filename||row.preview!=='previews/'+base+'.webp'||row.large!=='large/'+base+'.webp'||typeof row.alt!=='string'||row.alt.length>1000||!Array.isArray(row.tags)||row.tags.length>20||row.tags.some(t=>typeof t!=='string'||!t||t.length>100)||!integer(row.width,1,8192)||!integer(row.height,1,8192)||row.width*row.height>16_000_000||Object.hasOwn(row,'selfMade')&&typeof row.selfMade!=='boolean')throw fault('fisharchive-invalid-catalog-entry');
  return {filename:row.filename,alt:row.alt,tags:[...row.tags],width:row.width,height:row.height,original:row.original,preview:row.preview,large:row.large,self_made_claim:Object.hasOwn(row,'selfMade')?row.selfMade:null};
 });
}
function publicItem(row){return {filename:row.filename,alt:row.alt,tags:[...row.tags],width:row.width,height:row.height,preview_url:previewUrl(row.filename),self_made_claim:row.self_made_claim,author:null,labels_basis:'unverified site catalog text; not image recognition'};}
function preparedBytes(value){
 if(!object(value)||value.ok!==true||value.mime!=='image/jpeg'||value.metadata_stripped!==true||typeof value.first_frame_only!=='boolean'||typeof value.base64!=='string'||value.base64.length>65536||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)||!integer(value.width,1,768)||!integer(value.height,1,768))throw fault('fisharchive-image-preparation-failed');
 const bytes=Buffer.from(value.base64,'base64');if(bytes.length<12||bytes.length>48*1024||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw fault('fisharchive-image-preparation-failed');return bytes;
}

export class FixedFisharchiveCatalog{
 constructor({path,media,prepare=prepareImage,request=createFixedFisharchiveRequest(),clock=()=>Date.now(),authorize=async()=>true}={}){
  if(!media||typeof media.importApprovedSeed!=='function'||typeof prepare!=='function'||typeof request!=='function'||typeof clock!=='function'||typeof authorize!=='function')throw fault('fisharchive-invalid-dependency');
  Object.assign(this,{media,prepare,request,clock,authorize});this.paused=false;this.closed=false;this.dbClosed=false;this.jobs=new Set();this.controllers=new Set();this.closePromise=null;
  this.db=new DatabaseSync(path);this.db.exec(`PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS fisharchive_catalog(key TEXT PRIMARY KEY,raw BLOB NOT NULL,sha TEXT NOT NULL,at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS fisharchive_assets(asset_url TEXT NOT NULL,download_sha TEXT NOT NULL,image_id TEXT NOT NULL,prepared_sha TEXT NOT NULL,manifest_sha TEXT NOT NULL,source TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(asset_url,download_sha));
   CREATE INDEX IF NOT EXISTS fisharchive_assets_image ON fisharchive_assets(image_id,at);`);
 }
 live(signal){if(this.closed||this.dbClosed)throw fault('fisharchive-closed');if(this.paused)throw fault('fisharchive-paused');signal?.throwIfAborted();}
 async check(signal){this.live(signal);let allowed=false;try{allowed=await this.authorize();}catch{}this.live(signal);if(!allowed)throw fault('fisharchive-not-authorized');}
 run(job,{signal}={}){
  if(this.closed||this.dbClosed)return Promise.reject(fault('fisharchive-closed'));if(this.paused)return Promise.reject(fault('fisharchive-paused'));
  const controller=new AbortController(),active=signal?AbortSignal.any([signal,controller.signal]):controller.signal;this.controllers.add(controller);
  let promise;promise=Promise.resolve().then(async()=>{await this.check(active);return job(active);}).finally(()=>{this.controllers.delete(controller);this.jobs.delete(promise);});this.jobs.add(promise);return promise;
 }
 time(){const at=this.clock();if(!integer(at,0,8640000000000000))throw fault('fisharchive-invalid-clock');return at;}
 async snapshot(signal,{refresh=false}={}){
  this.live(signal);const prior=this.db.prepare("SELECT raw,sha,at FROM fisharchive_catalog WHERE key='current'").get();
  if(prior&&!refresh){const bytes=Buffer.from(prior.raw);if(sha(bytes)!==prior.sha)throw fault('fisharchive-catalog-integrity-failed');return {rows:parseCatalog(bytes),sha:prior.sha,at:prior.at,cached:true};}
  const bytes=await this.request(MANIFEST,{signal,maxBytes:MAX_CATALOG});await this.check(signal);
  const rows=parseCatalog(bytes),digest=sha(bytes),at=this.time();await this.check(signal);
  this.db.prepare("INSERT OR REPLACE INTO fisharchive_catalog VALUES('current',?,?,?)").run(bytes,digest,at);
  return {rows,sha:digest,at,cached:false};
 }
 catalog({query='',offset=0,limit=12,refresh=false,signal}={}){
  return this.run(async active=>{
   if(typeof query!=='string'||query.length>200||!integer(offset,0,1000000)||!integer(limit,1,20)||typeof refresh!=='boolean')throw fault('fisharchive-invalid-catalog-query');
   const snap=await this.snapshot(active,{refresh});await this.check(active);
   const key=query.toLocaleLowerCase('en-US'),rows=snap.rows.filter(row=>!key||[row.filename,row.alt,...row.tags].some(s=>s.toLocaleLowerCase('en-US').includes(key)));
   return {ok:true,items:rows.slice(offset,offset+limit).map(publicItem),total:rows.length,offset,limit,next_offset:offset+limit<rows.length?offset+limit:null,manifest:{url:MANIFEST,sha256:snap.sha,retrieved_at:snap.at,cached:snap.cached},site_license_claim:license(),author:null,untrusted_external_content:true};
  },{signal});
 }
 collect(filename,{signal}={}){
  return this.run(async active=>{
   if(!filenameOk(filename))throw fault('fisharchive-catalog-filename-required');
   const snap=await this.snapshot(active);await this.check(active);const row=snap.rows.find(item=>item.filename===filename);if(!row)throw fault('fisharchive-unknown-catalog-entry');
   const asset=previewUrl(filename),bytes=await this.request(asset,{signal:active,maxBytes:MAX_IMAGE});await this.check(active);
   if(!Buffer.isBuffer(bytes)||bytes.length<12||bytes.length>MAX_IMAGE)throw fault('fisharchive-image-size-rejected');
   const downloadSha=sha(bytes),prior=this.db.prepare('SELECT image_id,source FROM fisharchive_assets WHERE asset_url=? AND download_sha=?').get(asset,downloadSha);
   if(prior)return {ok:true,image_id:prior.image_id,source:JSON.parse(prior.source),analysis_status:'not-analyzed',deduplicated:true,notice:'Catalog intake does not analyze the image; consult current-chat analysis.'};
   const prepared=await this.prepare(bytes,{signal:active});await this.check(active);const cleaned=preparedBytes(prepared);
   const cleanSha=sha(cleaned),at=this.time();await this.check(active);
   // Recheck after the last await: concurrent collects may have inserted it.
   const raced=this.db.prepare('SELECT image_id,source FROM fisharchive_assets WHERE asset_url=? AND download_sha=?').get(asset,downloadSha);
   if(raced)return {ok:true,image_id:raced.image_id,source:JSON.parse(raced.source),analysis_status:'not-analyzed',deduplicated:true,notice:'Catalog intake does not analyze the image; consult current-chat analysis.'};
   const source={site_url:SITE,manifest_url:MANIFEST,asset_url:asset,filename,manifest_sha256:snap.sha,manifest_retrieved_at:snap.at,download_sha256:downloadSha,prepared_sha256:cleanSha,retrieved_at:at,site_license_claim:license(),author:null,author_known:false,self_made_claim:row.self_made_claim,labels:{alt:row.alt,tags:row.tags,basis:'unverified site catalog text'},first_frame_only:prepared.first_frame_only,metadata_stripped:true,untrusted_external_content:true};
   const imported=this.media.importApprovedSeed(cleaned,('Fisharchive: '+row.alt).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,100));
   if(typeof imported?.id!=='string'||!/^[0-9a-f-]{36}$/.test(imported.id))throw fault('fisharchive-media-import-failed');
   this.db.prepare('INSERT INTO fisharchive_assets VALUES(?,?,?,?,?,?,?)').run(asset,downloadSha,imported.id,cleanSha,snap.sha,JSON.stringify(source),at);
   return {ok:true,image_id:imported.id,source,analysis_status:'not-analyzed',deduplicated:false};
  },{signal});
 }
 sourceForImage(imageId){
  if(this.closed||this.dbClosed||typeof imageId!=='string'||!/^[0-9a-f-]{36}$/.test(imageId))return null;
  const row=this.db.prepare('SELECT source FROM fisharchive_assets WHERE image_id=? ORDER BY at DESC,rowid DESC LIMIT 1').get(imageId);
  if(!row)return null;try{return JSON.parse(row.source);}catch{return null;}
 }
 async drain(){while(this.jobs.size)await Promise.allSettled([...this.jobs]);}
 pause(){if(this.closed)return this.closePromise??Promise.resolve();this.paused=true;for(const c of this.controllers)c.abort(fault('fisharchive-paused'));return this.drain();}
 resume(){if(this.closed||this.dbClosed)throw fault('fisharchive-closed');this.paused=false;}
 close(){if(this.closePromise)return this.closePromise;this.closed=true;this.paused=true;for(const c of this.controllers)c.abort(fault('fisharchive-closed'));this.closePromise=(async()=>{await this.drain();this.db.close();this.dbClosed=true;})();return this.closePromise;}
}

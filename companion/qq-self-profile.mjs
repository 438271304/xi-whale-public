// Fixed-account, reversible self-expression. No arbitrary OneBot or filesystem tool.
import {DatabaseSync} from 'node:sqlite';import {createHash,randomUUID} from 'node:crypto';
import {toolFault} from './tool-feedback.mjs';
const SELF='900000004',digest=x=>createHash('sha256').update(x).digest('hex');
const profileFields={nickname:'nickname',signature:'signature',avatar:'avatar_sha'};
const localTime=at=>Number.isFinite(at)?new Date(at+8*60*60*1000).toISOString().replace('Z','+08:00'):null;
const known=(data,field)=>typeof data?.[field]==='string';
function compareProfile(before,after){const changed=[],unknown=[];for(const [name,field] of Object.entries(profileFields)){if(!known(before,field)||!known(after,field))unknown.push(name);else if(before[field]!==after[field])changed.push(name);}return {changed,unknown};}
function picture(value){const bytes=Buffer.from(value??[]);if(bytes.length<12||bytes.length>8*1024*1024)throw toolFault('ARGUMENT_VALUE_INVALID');const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;if(!png&&!jpeg)throw toolFault('ARGUMENT_VALUE_INVALID');return {bytes,sha:digest(bytes)};}
export class QQSelfProfile{
 constructor({path,driver,authorize=async()=>true,avatars=null,clock=()=>Date.now()}){Object.assign(this,{driver,authorize,avatars,clock});this.queue=Promise.resolve();this.paused=false;this.closed=false;this.dbClosed=false;this.epoch=0;this.pending=new Set();this.controllers=new Set();this.closePromise=null;this.db=new DatabaseSync(path);this.db.exec('PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS qq_self_capabilities(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE IF NOT EXISTS qq_self_versions(version TEXT PRIMARY KEY,data TEXT,at INTEGER);CREATE TABLE IF NOT EXISTS qq_self_avatars(sha TEXT PRIMARY KEY,bytes BLOB,at INTEGER);CREATE TABLE IF NOT EXISTS qq_self_operations(id TEXT PRIMARY KEY,before_version TEXT,after_version TEXT,state TEXT,actions TEXT,at INTEGER);');this.db.exec("UPDATE qq_self_operations SET state='failed-or-uncertain' WHERE state='prepared'");}
 run(job,{signal,canAct=()=>true}={},serialized=false){
  if(typeof canAct!=='function')return Promise.reject(Error('Invalid self-profile lifecycle callback'));
  const epoch=this.epoch,controller=new AbortController(),abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();this.controllers.add(controller);
  const check=()=>{controller.signal.throwIfAborted();if(this.closed||this.paused||epoch!==this.epoch)throw toolFault('ACTION_PAUSED_OR_CONTEXT_ENDED');};
  const guard=async()=>{check();if(await canAct()!==true)throw toolFault('ACTION_PAUSED_OR_CONTEXT_ENDED');check();if(!await this.authorize())throw toolFault('ACTION_NOT_AUTHORIZED');check();};
  const context={signal:controller.signal,check,guard,wait:async fn=>{await guard();check();const value=await fn(controller.signal);await guard();check();return value;}};
  const execute=async()=>{await guard();check();return job(context);};
  const pending=(serialized?this.queue.catch(()=>{}).then(execute):Promise.resolve().then(execute));
  if(serialized)this.queue=pending;
  this.pending.add(pending);pending.finally(()=>{signal?.removeEventListener('abort',abort);this.controllers.delete(controller);this.pending.delete(pending);}).catch(()=>{});return pending;
 }
 identity(options={}){return this.run(context=>this.readIdentity(context),options);}
 async readIdentity(context){const login=await context.wait(()=>this.driver.callApi('get_login_info',{}));context.check();if(String(login?.user_id)!==SELF)throw toolFault('ACTION_NOT_AUTHORIZED');return login;}
 saveAvatar(bytes){const image=picture(bytes);this.db.prepare('INSERT OR IGNORE INTO qq_self_avatars VALUES(?,?,?)').run(image.sha,image.bytes,this.clock());return image;}
 versionData(version){const row=version?this.db.prepare('SELECT data FROM qq_self_versions WHERE version=?').get(version):null;if(!row)return null;try{return JSON.parse(row.data);}catch{return null;}}
 operationSummary(row,current=null){
  if(!row)return null;
  const before=this.versionData(row.before_version),after=this.versionData(row.after_version),comparison=compareProfile(before,after);let actions=[];try{actions=JSON.parse(row.actions);}catch{}
  const baseline=actions.includes('avatar-baseline-restore-verification'),effect=baseline?'verification-only':row.state!=='verified'||!before||!after?'unconfirmed':comparison.changed.length?'changed':comparison.unknown.length?'partially-observed-unchanged':'unchanged';
  const meanings={changed:'该次回读前后有字段变化，且请求值已确认；哪些字段实际调用过修改API须另看executed_actions，不能仅凭时间顺序推断所有变化由本次造成。',unchanged:'该次操作前后回读相同，本次没有新变化；不能据此否定以前已成功的修改，也不能推断回读延迟。','partially-observed-unchanged':'可比对字段未见变化，另有字段回读未知；不能把未知当作未修改成功。',unconfirmed:'该次回执未确认完成；不据此推断成功或重复执行。','verification-only':'这是重用原头像验证恢复通道，不代表选择了新外观。'};
  const summary={operation_id:row.id,state:row.state,operation_at:row.at,operation_time:localTime(row.at),time_basis:'saved operation start/record time; verification completion time was not recorded',executed_actions:actions,observed_changes:comparison.changed,action_backed_changes:comparison.changed.filter(name=>actions.includes(name)),unknown_fields:comparison.unknown,effect,explanation:meanings[effect],before_version:row.before_version,after_version:row.after_version};
  if(comparison.changed.includes('avatar'))summary.avatar_change={before_sha:before.avatar_sha,after_sha:after.avatar_sha,meaning:'observed bytes fingerprint changed; not a claim about visual content'};
  if(current){
   const relations={};for(const name of comparison.changed){const field=profileFields[name];relations[name]=!known(current,field)||!known(after,field)?'unknown':current[field]===after[field]?'matches':'different';}
   summary.current_result_relation=relations;
   summary.current_matches_observed_result=Object.values(relations).includes('different')?'different':Object.values(relations).includes('unknown')||!Object.keys(relations).length?'unknown':'matches';
  }
  return summary;
 }
 receiptSummary(current){
  const latest=this.db.prepare('SELECT * FROM qq_self_operations ORDER BY at DESC,rowid DESC LIMIT 1').get();
  // Compare retained snapshots, not the action list. A later same-state verification
  // must not hide the older operation that established the current appearance.
  const clause=field=>"(json_type(b.data,'$."+field+"')='text' AND json_type(a.data,'$."+field+"')='text' AND json_extract(b.data,'$."+field+"')<>json_extract(a.data,'$."+field+"'))";
  const lastChanged=fields=>this.db.prepare("SELECT o.* FROM qq_self_operations o JOIN qq_self_versions b ON b.version=o.before_version JOIN qq_self_versions a ON a.version=o.after_version WHERE o.state='verified' AND o.actions NOT LIKE '%avatar-baseline-restore-verification%' AND ("+fields.map(clause).join(' OR ')+") ORDER BY o.at DESC,o.rowid DESC LIMIT 1").get();
  const changed=lastChanged(Object.values(profileFields)),avatar=this.operationSummary(lastChanged(['avatar_sha']),current),observedAt=this.clock();
  return {observed_at:observedAt,observed_time:localTime(observedAt),current_fields:Object.fromEntries(Object.entries(profileFields).map(([name,field])=>[name,known(current,field)?'observed':'unknown'])),latest_operation:this.operationSummary(latest,current),last_verified_change:this.operationSummary(changed,current),last_verified_avatar_change:avatar?{operation_id:avatar.operation_id,operation_at:avatar.operation_at,operation_time:avatar.operation_time,time_basis:avatar.time_basis,...avatar.avatar_change,current_relation:avatar.current_result_relation.avatar}:null,notice:'Current inspection, this operation and the last real observed change are separate facts. API actions/verified alone do not prove a new change. No evidence here establishes delayed mirrors or unseen visual differences.'};
 }
 read(options={}){return this.run(context=>this.readWith(context),options);}
 async readWith(context){const login=await this.readIdentity(context),detail=await context.wait(()=>this.driver.callApi('get_stranger_info',{user_id:Number(SELF)}));context.check();if(String(detail?.user_id)!==SELF)throw toolFault('ACTION_NOT_AUTHORIZED');const data={self_id:SELF,nickname:typeof detail.nickname==='string'&&detail.nickname?detail.nickname:login.nickname,signature:typeof detail.long_nick==='string'?detail.long_nick:null,avatar_sha:null};
  let avatarError=null;if(this.avatars?.current){try{const bytes=await context.wait(signal=>this.avatars.current({signal}));context.check();if(bytes)data.avatar_sha=this.saveAvatar(bytes).sha;}catch{await context.guard();avatarError='Trusted self avatar snapshot currently unavailable';}}
  context.check();
  const rollbackVerified=!this.avatars?.requiresRestoreProof||this.db.prepare("SELECT value FROM qq_self_capabilities WHERE key='avatar-baseline-restore'").get()?.value==='verified';const version=digest(JSON.stringify(data));this.db.prepare('INSERT OR IGNORE INTO qq_self_versions VALUES(?,?,?)').run(version,JSON.stringify(data),this.clock());return {...data,version,avatar_source:this.avatars?.source??null,avatar_snapshot_error:avatarError,avatar_snapshot_retained:!!data.avatar_sha,avatar_restore_verified:rollbackVerified,avatar_reversible:!!data.avatar_sha&&rollbackVerified&&typeof this.avatars?.resolve==='function',receipt_summary:this.receiptSummary(data),capabilities:{nickname:true,signature:data.signature!==null,avatar_set:!!data.avatar_sha&&rollbackVerified&&typeof this.avatars?.resolve==='function',avatar_note:data.avatar_sha?rollbackVerified?'Trusted current bytes retained; baseline restore path verified':'Trusted current bytes retained; baseline restore path not yet verified':'No trusted current avatar bytes; changes unavailable until an actual self snapshot is available'}};
 }
 exclusive(job,options={}){return this.run(job,options,true);}
 update(args,options={}){return this.exclusive(context=>this.apply(args,null,context),options);}
 async apply(args,restoreAvatar=null,context=null){
  if(!context)return this.exclusive(active=>this.apply(args,restoreAvatar,active));
  if(!args||Object.keys(args).some(k=>!['expected_version','nickname','signature','avatar_id'].includes(k)))throw toolFault('ARGUMENT_VALUE_INVALID');
  if(typeof args.expected_version!=='string')throw toolFault('PRECONDITION_MISSING');
  if(args.nickname!==undefined&&(typeof args.nickname!=='string'||!args.nickname.trim()||args.nickname.length>64))throw toolFault('ARGUMENT_VALUE_INVALID');
  if(args.signature!==undefined&&(typeof args.signature!=='string'||args.signature.length>255))throw toolFault('ARGUMENT_VALUE_INVALID');
  const before=await this.readWith(context);context.check();if(before.version!==args.expected_version)throw toolFault('VERSION_CONFLICT');
  if(args.signature!==undefined&&before.signature===null)throw toolFault('PRECONDITION_MISSING');
  let avatar=restoreAvatar;
  if(args.avatar_id!==undefined){if(typeof args.avatar_id!=='string'||!this.avatars?.resolve||!before.avatar_reversible)throw toolFault('PRECONDITION_MISSING');avatar=picture(await context.wait(signal=>this.avatars.resolve(args.avatar_id,{signal})));context.check();}
  if(avatar){if(!before.avatar_reversible)throw toolFault('PRECONDITION_MISSING');avatar=this.saveAvatar(avatar.bytes??avatar);}
  const actions=[],id=randomUUID();let attempted=false;this.db.prepare("INSERT INTO qq_self_operations VALUES(?,?,NULL,'prepared',?,?)").run(id,before.version,'[]',this.clock());
  const write=async(name,args,label)=>{await this.readIdentity(context);await context.guard();context.check();attempted=true;actions.push(label);this.db.prepare('UPDATE qq_self_operations SET actions=? WHERE id=?').run(JSON.stringify(actions),id);await this.driver.callApi(name,args);await context.guard();context.check();};
  try{
   if(args.nickname!==undefined&&args.nickname!==before.nickname)await write('set_qq_profile',{nickname:args.nickname},'nickname');
   if(args.signature!==undefined&&args.signature!==before.signature)await write('set_self_longnick',{longNick:args.signature},'signature');
   if(avatar&&avatar.sha!==before.avatar_sha)await write('set_qq_avatar',{file:'base64://'+avatar.bytes.toString('base64')},'avatar');
   const after=await this.readWith(context);context.check();let avatarMatch=!avatar||after.avatar_sha===avatar.sha,avatarVerification=!avatar?'not-changed':avatarMatch?'exact-bytes':'unconfirmed';
   if(avatar&&!avatarMatch&&after.avatar_sha&&this.avatars?.matches){const actual=this.db.prepare('SELECT bytes FROM qq_self_avatars WHERE sha=?').get(after.avatar_sha);avatarMatch=!!actual&&await context.wait(signal=>this.avatars.matches(avatar.bytes,Buffer.from(actual.bytes),{signal}));context.check();if(avatarMatch)avatarVerification='decoded-appearance-matches; QQ may recompress';}
   const matches=(args.nickname===undefined||after.nickname===args.nickname)&&(args.signature===undefined||after.signature===args.signature)&&avatarMatch,state=matches?'verified':'readback-uncertain';
   this.db.prepare('UPDATE qq_self_operations SET after_version=?,state=?,actions=? WHERE id=?').run(after.version,state,JSON.stringify(actions),id);after.receipt_summary=this.receiptSummary(after);const receipt=this.operationSummary(this.db.prepare('SELECT * FROM qq_self_operations WHERE id=?').get(id),after);return {operation_id:id,state,avatar_verification:avatarVerification,changed:receipt.observed_changes,executed_actions:actions,effect:receipt.effect,receipt,before_version:before.version,after,notice:!matches?'The API returned but profile readback did not confirm the requested values; do not retry blindly':receipt.effect==='unchanged'?'Requested values are already current; this attempt made no new observed change. Earlier successful changes remain valid.':'Readback matches requested values; inspect observed_changes separately from API actions'};
  }catch(error){const state=attempted?'failed-or-uncertain':'failed-before-send';this.db.prepare('UPDATE qq_self_operations SET state=?,actions=? WHERE id=?').run(state,JSON.stringify(actions),id);throw Object.assign(toolFault(attempted?'ACTION_OUTCOME_UNCERTAIN':'ACTION_ENDED_BEFORE_WRITE',{operation_id:id,state,write_attempted:attempted}),{cause:error});}
 }
 restore({version,expected_version},options={}){return this.exclusive(async context=>{const row=this.db.prepare('SELECT data FROM qq_self_versions WHERE version=?').get(version);if(!row)throw toolFault('RESOURCE_UNAVAILABLE');const old=JSON.parse(row.data),args={expected_version,nickname:old.nickname};if(old.signature!==null)args.signature=old.signature;const avatar=old.avatar_sha?this.db.prepare('SELECT bytes FROM qq_self_avatars WHERE sha=?').get(old.avatar_sha):null;return this.apply(args,avatar?{bytes:Buffer.from(avatar.bytes)}:null,context);},options);}
 // Trusted maintenance only; never exposed as a chat tool. Reapplies the SAME
 // fetched avatar to validate the restore transport without choosing a new look.
 verifyAvatarBaselineRestore(options={}){return this.exclusive(async context=>{
  const before=await this.readWith(context);context.check();if(!before.avatar_sha||!this.avatars?.matches)throw Error('Trusted avatar snapshot required');const saved=this.db.prepare('SELECT bytes FROM qq_self_avatars WHERE sha=?').get(before.avatar_sha),image=picture(saved.bytes),id=randomUUID();let attempted=false;
  this.db.prepare("INSERT INTO qq_self_operations VALUES(?,?,NULL,'prepared',?,?)").run(id,before.version,JSON.stringify(['avatar-baseline-restore-verification']),this.clock());
  try{await this.readIdentity(context);await context.guard();context.check();attempted=true;await this.driver.callApi('set_qq_avatar',{file:'base64://'+image.bytes.toString('base64')});await context.guard();const after=await this.readWith(context);context.check();const bytes=after.avatar_sha?this.db.prepare('SELECT bytes FROM qq_self_avatars WHERE sha=?').get(after.avatar_sha):null,matches=!!bytes&&await context.wait(signal=>this.avatars.matches(image.bytes,Buffer.from(bytes.bytes),{signal}));context.check();
   const state=matches?'verified':'readback-uncertain';this.db.prepare('UPDATE qq_self_operations SET after_version=?,state=? WHERE id=?').run(after.version,state,id);if(matches)this.db.prepare("INSERT OR REPLACE INTO qq_self_capabilities VALUES('avatar-baseline-restore','verified')").run();
   return {operation_id:id,state,baseline_reapplied:true,new_look_selected:false,before_version:before.version,after_version:after.version,appearance_matches:matches,notice:'Same current QQ CDN avatar reapplied and read back; QQ may recompress. No arbitrary new avatar selected.'};
  }catch(error){const state=attempted?'failed-or-uncertain':'failed-before-send';this.db.prepare('UPDATE qq_self_operations SET state=? WHERE id=?').run(state,id);throw Object.assign(toolFault(attempted?'ACTION_OUTCOME_UNCERTAIN':'ACTION_ENDED_BEFORE_WRITE',{operation_id:id,state,write_attempted:attempted}),{cause:error});}
 },options);}
 history(){return {versions:this.db.prepare('SELECT version,data,at FROM qq_self_versions ORDER BY at DESC,rowid DESC LIMIT 20').all().map(x=>({...x,data:JSON.parse(x.data)})),operations:this.db.prepare('SELECT * FROM qq_self_operations ORDER BY at DESC,rowid DESC LIMIT 20').all().map(x=>({...x,actions:JSON.parse(x.actions),interpretation:this.operationSummary(x)})),notice:'Saved version times are first observations, not the latest inspection. Operation times are recorded starts. Equal before/after means no newly observed change in that attempt, not that earlier changes failed. actions records API calls, while interpretation.observed_changes compares retained field values.'};}
 tools(options={}){const decl=(name,description,properties,required,handler)=>({name,description,parameters:{type:'object',properties,required,additionalProperties:false},handler:async a=>JSON.stringify(await handler(a))});return [
  decl('self_profile_read','Inspect your current own QQ profile and compact receipt summary: current observable fields, latest attempt effect, last verified actual field change, exact stored operation time and whether current values still match. Same-state/idempotent receipt does not negate an older success. Unknown readback is unknown; never invent mirror delay. Xi identity only.',{},[],()=>this.read(options)),
  decl('self_avatar_list','List approved public whale images usable for your own avatar. Private received photos are not automatically public avatar candidates. No account change occurs.',{},[],()=>this.exclusive(async context=>{await this.readIdentity(context);const assets=this.avatars?.list?await context.wait(signal=>this.avatars.list({signal})):[];context.check();return {assets,notice:'Read self_profile_read first; old avatar must be retained before changing.'};},options)),
  decl('self_profile_update','Express yourself through your own supported QQ nickname/signature or an explicitly configured safe avatar asset. Read first, use expected_version. Actual values and old avatar bytes are retained; never change someone else or invoke arbitrary APIs.',{expected_version:{type:'string'},nickname:{type:'string',maxLength:64},signature:{type:'string',maxLength:255},avatar_id:{type:'string'}},['expected_version'],a=>this.update(a,options)),
  decl('self_profile_history','Read saved own-profile versions and interpreted receipts. actions are API calls, observed_changes are actual retained before/after differences; unchanged latest receipt is not historical failure. Times label their source, and uncertain operations must not be retried blindly.',{},[],()=>this.run(()=>this.history(),options)),
  decl('self_profile_restore','Restore a saved self-profile version after reading current expected_version. Avatar restoration requires retained actual bytes.',{version:{type:'string'},expected_version:{type:'string'}},['version','expected_version'],a=>this.restore(a,options))
 ];}
 drain(){return Promise.allSettled([...this.pending]);}
 pause(){this.paused=true;this.epoch++;for(const controller of this.controllers)controller.abort(Error('Profile action paused'));return this.drain();}
 resume(){if(this.closed)throw Error('Profile is closed');this.paused=false;}
 close(){if(this.closePromise)return this.closePromise;this.closed=true;this.paused=true;this.epoch++;for(const controller of this.controllers)controller.abort(Error('Profile is closed'));return this.closePromise=this.drain().then(()=>{this.db.close();this.dbClosed=true;});}
}

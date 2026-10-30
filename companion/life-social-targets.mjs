// Target membership comes only from the installed QQ world's watched groups and
// its current friend API. Labels are display data, never identity or authority.
const registries=new WeakMap();
const devices=new Set(['2113929217','2113929218','2113929219']);
const account=value=>['string','number'].includes(typeof value)&&/^[1-9]\d{4,14}$/.test(String(value))&&(typeof value!=='number'||Number.isSafeInteger(value))?String(value):null;
const label=(value,fallback)=>typeof value==='string'?Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu,'').replace(/\s+/gu,' ').trim()).slice(0,80).join('')||fallback:fallback;
const ordered=map=>[...map].sort(([a],[b])=>Number(a)-Number(b));
function destination(target){
 if(!target||typeof target!=='object'||Array.isArray(target)||!['group','private'].includes(target.kind)||!account(target.id))throw Error('Invalid social target');
 return {kind:target.kind,id:account(target.id)};
}

export function lifeSocialTargets(world,policy){
 if(!registries.has(world))registries.set(world,new LifeSocialTargets({world,policy}));
 return registries.get(world);
}

export class LifeSocialTargets{
 #friends=new Map();#friendState='unverified';#started=false;#sequence=0;#committed=0;
 constructor({world,policy}){
  if(!world||typeof world!=='object'||typeof world.getWatched!=='function'||!policy||typeof policy!=='object'||Array.isArray(policy))throw Error('Social targets need an installed QQ world and policy');
  this.world=world;this.policy=policy;
 }
 #allowedPrivate(id){
  return !!id&&this.policy.friend_private_enabled===true&&!devices.has(id)&&id!==account(this.policy.bot_id)&&id!==account(this.world.driver?.identity?.selfId);
 }
 #groups(){
  let watched;try{watched=this.world.getWatched()?.groups;}catch{return new Map();}
  const groups=new Map();
  if(Array.isArray(watched))for(const value of watched){
   const id=account(value);if(!id||groups.has(id))continue;
   const names=this.world.driver?.identity?.groups;
   const name=typeof names?.get==='function'?(names.get(Number(id))??names.get(id))?.groupName:null;
   groups.set(id,label(name,id));
  }
  return groups;
 }
 async refresh({signal}={}){
  signal?.throwIfAborted();
  const sequence=++this.#sequence;this.#started=true;
  let rows=null;
  if(this.policy.friend_private_enabled===true){
   try{rows=await this.world.driver.callApi('get_friend_list',{});}catch{rows=null;}
  }
  signal?.throwIfAborted();
  // An older asynchronous response cannot revive a friend removed by a newer
  // lookup. Callers authorizing a send also require their own completed lookup.
  if(sequence!==this.#sequence)return this.list();
  const friends=new Map();
  if(this.policy.friend_private_enabled!==true)this.#friendState='disabled';
  else if(!Array.isArray(rows))this.#friendState='unavailable';
  else{
   this.#friendState='available';
   for(const row of rows){
    const id=account(row?.user_id);if(!this.#allowedPrivate(id)||friends.has(id))continue;
    const name=label(row?.remark,'')||label(row?.nickname,id);friends.set(id,name);
   }
  }
  this.#friends=friends;this.#committed=sequence;
  return this.list();
 }
 #targets(){
  const groups=this.#groups(),friends=new Map([...this.#friends].filter(([id])=>this.#allowedPrivate(id))),targets=[],seen=new Set();
  const add=(recipient,kind,id,name)=>{const key=kind+':'+id;if(!id||seen.has(key))return;seen.add(key);targets.push({recipient,target_kind:kind,target_id:id,label:name});};
  for(const [recipient,kind,id,name] of [
   ['family','group',account(this.policy.group_id),'家庭群'],
   ['father','private',account(this.policy.father_id),'老爹'],
   ['mother','private',account(this.policy.mother_id),'妈妈'],
  ])if((kind==='group'?groups:friends).has(id))add(recipient,kind,id,name);
  for(const [id,name] of ordered(groups))add('group:'+id,'group',id,name);
  for(const [id,name] of ordered(friends))add('private:'+id,'private',id,name);
  return targets;
 }
 list({offset=0,limit=20}={}){
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Use a nonnegative offset and a limit from 1 to 100');
  const targets=this.#targets(),end=Math.min(targets.length,offset+limit);
  return {targets:targets.slice(offset,end),total:targets.length,next_offset:end<targets.length?end:null,friend_state:this.policy.friend_private_enabled===true?this.#friendState:'disabled'};
 }
 resolve(recipient,reason){
  if(typeof recipient!=='string'||typeof reason!=='string'||!reason.trim()||reason.length>400)throw Error('Choose a listed recipient and a bounded reason');
  let target=this.#targets().find(item=>item.recipient===recipient);
  // Old unbound family intents may be loaded before the first refresh. This
  // migration path does not list unverified people or bypass check/authorize.
  if(!target&&!this.#started){
   const aliases={family:['group',this.policy.group_id],father:['private',this.policy.father_id],mother:['private',this.policy.mother_id]};
   const alias=Object.hasOwn(aliases,recipient)?aliases[recipient]:null,id=account(alias?.[1]);
   if(id&&(alias[0]==='group'||this.#allowedPrivate(id)))target={recipient,target_kind:alias[0],target_id:id};
  }
  if(!target)throw Error('Social recipient is no longer listed');
  return {recipient:target.recipient,target_kind:target.target_kind,target_id:target.target_id,recipient_reason:reason.trim()};
 }
 check(target){
  const {kind,id}=destination(target);
  if(kind==='group'?!this.#groups().has(id):!this.#allowedPrivate(id)||this.#friendState!=='available'||!this.#friends.has(id))throw Error('Social target is no longer available');
  return true;
 }
 async authorize(target,{signal}={}){
  const selected=destination(target);signal?.throwIfAborted();
  if(selected.kind==='private'){
   if(!this.#allowedPrivate(selected.id))throw Error('Private social contact is disabled or invalid');
   const sequence=this.#sequence+1;await this.refresh({signal});signal?.throwIfAborted();
   if(sequence!==this.#sequence||sequence!==this.#committed)throw Error('Friend verification was superseded');
  }
  signal?.throwIfAborted();return this.check(selected);
 }
}

import {heartbeatDelay} from './guardian-persona.mjs';
const outgoingChecks=new WeakMap();
// Only a guarded world receives this internal route. No model-supplied purpose
// string can turn an ordinary private reply into a life initiation.
const lifeDeliveries=new WeakMap();
export async function authorizeScopedQQDelivery(world,target){
 const check=outgoingChecks.get(world);if(!check)throw Error('Guardian: scoped outgoing checks are not installed');
 await check(target);
}

function deliveryFailure(error,attempted){
 try{if(error&&(typeof error==='object'||typeof error==='function')){Object.defineProperty(error,'deliveryAttempted',{value:attempted,writable:true,configurable:true,enumerable:true});return error;}}catch{}
 const wrapped=new Error(typeof error?.message==='string'?error.message:'Life QQ delivery failed',{cause:error});
 wrapped.name=typeof error?.name==='string'?error.name:'Error';wrapped.deliveryAttempted=attempted;return wrapped;
}

export async function sendLifeQQDelivery(world,target,text,options={}){
 let attempted=false;
 try{
  const route=lifeDeliveries.get(world);if(!route)throw Error('Guardian: life delivery requires an installed QQ guard');
  if(!options||typeof options!=='object'||Array.isArray(options))throw Error('Guardian: invalid life delivery callbacks');
  const {beforeTransport,onTransportAttempt}=options;
  if(beforeTransport!==undefined&&typeof beforeTransport!=='function'||onTransportAttempt!==undefined&&typeof onTransportAttempt!=='function')throw Error('Guardian: invalid life delivery callbacks');
  if(!['group','private'].includes(target?.kind)||!/^\d{5,15}$/.test(String(target.id))||typeof text!=='string'||!text.trim()||text.length>500)throw Error('Guardian: invalid life delivery');
  const destination=Object.freeze({kind:target.kind,id:String(target.id)});
  await route.authorize(destination); // Includes the asynchronous current-friend lookup.
  if(await beforeTransport?.()===false)throw Error('Guardian: life delivery was declined before transport');
  route.check(destination); // Final synchronous clock/target/watch/feature check.
  onTransportAttempt?.();
  attempted=true;
  // QQWorld's original API accepts an expression object, not a bare string.
  return await route.transport.call(world,destination,{text});
 }catch(error){throw deliveryFailure(error,attempted);}
}

// Called with OneBot protocol fields, never with model-generated claims of a mention.
export function classifyQQ(message, policy, now = new Date()) {
  const group = String(message.group_id ?? '');
  const sender = String(message.user_id ?? '');
  if (message.post_type !== 'message' || message.message_type !== 'group' || !(policy.group_ids ?? [policy.group_id]).map(String).includes(group)) {
    return {accept:false,wake:false,reason:'outside-family-group'};
  }
  if (sender === policy.bot_id) return {accept:false,wake:false,reason:'self-message'};
  const mentioned = Array.isArray(message.message) && message.message.some(s =>
    s.type === 'at' && String(s.data?.qq ?? '') === policy.bot_id);
  const resting = heartbeatDelay(now, 1) === null;
  return {accept:true,wake:!resting || mentioned,mentioned,reason:resting && !mentioned ? 'resting' : 'allowed'};
}

export function inboundAdapter(original, policy, clock = () => new Date()) {
  return async function(message, ...rest) {
    const decision = classifyQQ(message, policy, clock());
    if (!decision.accept || !decision.wake) return {skipped:true,reason:decision.reason};
    return original.call(this,message,...rest);
  };
}

export function guardQQWorld(world, policy, clock = () => new Date(), ledger = null) {
  if (world.host) throw new Error('Install guardian before starting the QQ World');
  if (typeof world.handleEvent !== 'function' || typeof world.setWatched !== 'function' || typeof world.sendToTarget !== 'function') {
    throw new Error('Pinned QQWorld entry points changed; refuse activation');
  }
  // Version-specific adapter. Must revalidate before upgrading QQWorld.
  const groups = () => policy.follow_configured_groups ? world.getWatched().groups.map(String) : (policy.group_ids ?? [policy.group_id]).map(String);
  if(!policy.follow_configured_groups)world.setWatched(groups().map(Number), []);
  const wakeUntil = new Map();
  const privateLeases = new Map();
  const peerBotTurns = new Map();
  const peerBots = new Set((policy.peer_bot_ids ?? []).map(String));
  const devices = new Set(['2113929217','2113929218','2113929219']);
  async function isFriend(id) {
    if (!policy.friend_private_enabled || id === policy.bot_id || devices.has(id)) return false;
    try {
      const friends = await world.driver?.callApi('get_friend_list', {});
      return Array.isArray(friends) && friends.some(f => String(f.user_id) === id);
    } catch { return false; }
  }
  const incoming = world.handleEvent;
  world.handleEvent = async function(message, ...rest) {
    const now = clock();
    if (message.post_type === 'message' && message.message_type === 'private') {
      const id = String(message.user_id ?? '');
      if (message.sub_type !== 'friend' || !/^\d+$/.test(id) || !await isFriend(id)) return {skipped:true,reason:'not-verified-friend'};
      if (ledger && !ledger.claim(message, now.getTime())) return {skipped:true,reason:'stale-or-duplicate'};
      // Reply permission belongs only to this correspondent, never wakes the group.
      privateLeases.set(id, now.getTime() + 5 * 60_000);
      this.setWatched(groups().map(Number), [...privateLeases.keys()].map(Number));
      this.guardianInboundVersion = (this.guardianInboundVersion ?? 0) + 1;
      return incoming.call(this, message, ...rest);
    }
    const decision = classifyQQ(message, {...policy,group_ids:groups()}, now);
    // Until peer-bot identities are configured, new groups require a guardian mention.
    if (decision.accept && String(message.group_id)!==String(policy.group_id) && policy.new_groups_guardian_mention_only && (!decision.mentioned || ![policy.father_id,policy.mother_id].includes(String(message.user_id)))) return {skipped:true,reason:'new-group-needs-guardian-mention'};
    if (!decision.accept || !decision.wake) return {skipped:true, reason:decision.reason};
    const groupKey=String(message.group_id), isPeerBot=peerBots.has(String(message.user_id));
    if(isPeerBot){
      const allowance=peerBotTurns.get(groupKey);
      if(!allowance || allowance.left<=0 || now.getTime()>allowance.until)return {skipped:true,reason:'peer-bot-conversation-limit'};
    }
    if (ledger && !ledger.claim(message, now.getTime())) return {skipped:true,reason:'stale-or-duplicate'};
    if(isPeerBot)peerBotTurns.get(groupKey).left--;
    else peerBotTurns.set(groupKey,{left:policy.peer_bot_max_turns ?? 6,until:now.getTime()+(policy.peer_bot_window_minutes ?? 10)*60_000});
    this.guardianInboundVersion = (this.guardianInboundVersion ?? 0) + 1;
    // Short family-wide lease, not a claim that every response belongs to this event.
    if (decision.mentioned && !isPeerBot) wakeUntil.set(String(message.group_id), now.getTime() + 5 * 60_000);
    return incoming.call(this, message, ...rest);
  };
  const outgoing = world.sendToTarget;
  const checkLife=target=>{
    if(heartbeatDelay(clock(),1)===null)throw Error('Guardian: life delivery is resting');
    if(target.kind==='group'){
      const watched=world.getWatched?.().groups;
      if(String(policy.group_id)!==target.id||!Array.isArray(watched)||!watched.map(String).includes(target.id))throw Error('Guardian: life group is not the watched family group');
    }else{
      const parents=[policy.father_id,policy.mother_id].filter(Boolean).map(String);
      if(!policy.friend_private_enabled||!parents.includes(target.id)||target.id===String(policy.bot_id)||devices.has(target.id))throw Error('Guardian: life private target must be an enabled parent');
    }
  };
  const lifeRoute={
    transport:lifeDeliveries.get(world)?.transport??outgoing,
    check:checkLife,
    authorize:async target=>{
      checkLife(target);
      if(target.kind==='private'&&!await isFriend(target.id))throw Error('Guardian: life private target must be a current friend');
      checkLife(target); // The friend lookup may have crossed midnight or a policy change.
    }
  };
  outgoingChecks.set(world,async target=>{
    const now = clock();
    if (target?.kind === 'private') {
      const id = String(target.id);
      if (now.getTime() >= (privateLeases.get(id) ?? 0) || !await isFriend(id)) throw new Error('Guardian: private reply requires a fresh message from a current friend');
      return;
    }
    if (target?.kind !== 'group' || !groups().includes(String(target.id))) {
      throw new Error('Guardian: outgoing target is outside the family group');
    }
    if (heartbeatDelay(now, 1) === null && now.getTime() >= (wakeUntil.get(String(target.id)) ?? 0)) {
      throw new Error('Guardian: resting; a fresh family mention is required');
    }
  });
  world.sendToTarget = async function(target, ...rest) {
    await authorizeScopedQQDelivery(this,target);
    return outgoing.call(this,target,...rest);
  };
  lifeDeliveries.set(world,lifeRoute);
  return world;
}

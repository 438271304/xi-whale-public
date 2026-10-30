import {buildNativeMessage,nativeSummary} from './qq-face-output.mjs';
import {authorizeScopedQQDelivery} from './qq-event-policy.mjs';
// Only the admitted scoped destination and preselected expression reach this sender.
// Ordinary sends retain the pinned QQWorld implementation.
export async function sendScopedReply(world,target,{text='',faces=[],imageBytes=null,replyMessageId=null},botId){
 if(!faces.length)return world.sendToTarget(target,{text,...(imageBytes?{imageBytes}:{}),...(replyMessageId!==null?{replyMessageId}:{})});
 if(!['group','private'].includes(target?.kind)||!/^\d{5,15}$/.test(String(target.id)))throw Error('Invalid scoped QQ destination');
 if(!world.host?.pushEvent||!world.driver?.callApi)throw Error('Scoped QQ sender not ready');
 const message=buildNativeMessage({text,faces,imageBytes,replyMessageId});
 await authorizeScopedQQDelivery(world,target);
 const result=await world.driver.callApi(target.kind==='group'?'send_group_msg':'send_private_msg',{[target.kind==='group'?'group_id':'user_id']:Number(target.id),message});
 if(!Number.isSafeInteger(result?.message_id))throw Error('QQ delivery has no definite message receipt; do not retry');
 const ts=new Date().toISOString(),summary=[text,nativeSummary(faces),imageBytes?'[image attachment]':''].filter(Boolean).join('\n');
 const env=await world.host.pushEvent({type:'qq.self',source:'qq',ts,text:summary,meta:{message_id:result.message_id,user_id:String(botId),conv:{kind:target.kind,id:String(target.id)},native_faces:faces.map(f=>({id:f.id,name:f.name}))}});
 world.knownMessages?.set(String(result.message_id),{conv:target,ts:env?.ts??ts});
 return '[sent #'+result.message_id+' → '+target.kind+':'+target.id+']';
}

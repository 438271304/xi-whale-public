// A reflection opportunity inside an already-running activity, never a new
// model/timer loop. The activity's existing model may omit it entirely.
export const DISCOVERY_REFLECTION_SCHEMA=Object.freeze({
 type:'object',description:'Optional durable interpretation from this actual exploration. Omit when nothing has changed; never manufacture emotion or affection scores.',
 properties:{kind:{type:'string',enum:['interest','unfinished']},key:{type:'string',maxLength:80},value:{type:'string',maxLength:1200},reason:{type:'string',maxLength:600},operation:{type:'string',enum:['record','correct','retire']},expected_revision:{type:'integer',minimum:0}},
 required:['kind','key','value','reason'],additionalProperties:false,
});
export const DISCOVERY_REFLECTION_PROMPT='save_discovery可以附reflection，记录这次真实所得是否让某个兴趣值得继续、留下了具体未完问题，或修正/放下此前想法。只有你确实形成了这样的认识才填；一般知识已保存在经历中，无须为了有成长记录而更新状态。kind只用interest或unfinished，key沿用同一话题的简短稳定名字，value说清目前想法，reason说明这次依据；纠正用correct，放下用retire。不要从文章替自己编造心情、给人打好感分或改身份和权限。';
const knownFields=new Set(['kind','key','value','reason','operation','expected_revision']);
const protectedKey=/identity|guardian|permission|capabilit|credential|password|affection|好感|亲密度|身份|监护|权限|凭证|密钥|核心/i;
const normalized=text=>text.trim().replace(/\s+/g,' ');
const result=(status,reason,extra={})=>({status,reason,...extra});
function evidenceFor(store,activityId,evidenceId){
 const record=store.get({id:evidenceId});
 if(!record?.found||record.event!=='activity:'+activityId||record.role!=='self'||record.metadata?.activity_id!==activityId||!record.sources?.some(s=>s.source==='public-exploration'))return null;
 let content;try{content=JSON.parse(record.text);}catch{return null;}
 if(typeof content.summary!=='string'||!content.summary.trim()||!Array.isArray(content.sources)||!content.sources.length)return null;
 const valid=content.sources.every(s=>{try{const url=new URL(s.url);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}});
 return valid?record:null;
}
export function reflectDiscovery({store,activityId,evidenceId,reflection,clock=()=>Date.now()}={}){
 if(reflection===undefined||reflection===null)return result('skipped','no-lasting-reflection-requested');
 if(!store||typeof store.get!=='function'||typeof store.getState!=='function'||typeof store.setState!=='function')throw Error('Reflection requires existing experience store');
 if(!reflection||typeof reflection!=='object'||Array.isArray(reflection)||Object.keys(reflection).some(k=>!knownFields.has(k)))return result('rejected','invalid-reflection-fields');
 const {kind}=reflection,operation=reflection.operation??'record';
 if(!['interest','unfinished'].includes(kind)||!['record','correct','retire'].includes(operation))return result('rejected','unsupported-reflection-kind-or-operation');
 if(typeof reflection.key!=='string'||!reflection.key.trim()||reflection.key.length>80||protectedKey.test(reflection.key))return result('rejected','invalid-or-protected-reflection-key');
 if(typeof reflection.value!=='string'||!reflection.value.trim()||reflection.value.length>1200||typeof reflection.reason!=='string'||!reflection.reason.trim()||reflection.reason.length>600)return result('rejected','reflection-needs-bounded-interpretation-and-reason');
 if(typeof activityId!=='string'||!activityId||activityId.length>100||typeof evidenceId!=='string')return result('rejected','invalid-activity-evidence-identity');
 if(reflection.expected_revision!==undefined&&(!Number.isSafeInteger(reflection.expected_revision)||reflection.expected_revision<0))return result('rejected','invalid-expected-revision');
 const evidence=evidenceFor(store,activityId,evidenceId);if(!evidence)return result('rejected','completed-public-discovery-evidence-required');
 const suppliedKey=normalized(reflection.key),key=suppliedKey.startsWith('reflection:')?suppliedKey:'reflection:'+suppliedKey,current=store.getState({kind,key,limit:1})[0]??null;
 if(reflection.expected_revision!==undefined&&reflection.expected_revision!==(current?.revision??0))return result('rejected','reflection-version-conflict',{current_revision:current?.revision??0});
 if(operation!=='record'&&!current)return result('rejected','no-prior-reflection-to-correct-or-retire');
 const history=store.getState({kind,key,limit:100,history:true});
 if(history.some(row=>row.evidence?.some(ref=>ref.type==='message'&&ref.id===evidenceId)))return result('skipped','experience-already-reflected',{kind,key,revision:current?.revision??null});
 const value=normalized(reflection.value),active=operation!=='retire';
 if(current?.value?.interpretation===value&&current.value.active===active)return result('skipped','interpretation-unchanged',{kind,key,revision:current.revision});
 const saved=store.setState({kind,key,value:{interpretation:value,reason:normalized(reflection.reason),active,activity_id:activityId,operation,previous_revision:current?.revision??null,reviewable:true},evidence:[{type:'message',id:evidenceId}],at:clock(),source:'activity-reflection'});
 return {status:'saved',kind,key,revision:saved.revision,previous_revision:current?.revision??null,operation,evidence_id:evidenceId};
}

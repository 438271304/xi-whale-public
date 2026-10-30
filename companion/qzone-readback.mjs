// Pure fixed-self QZone receipt checks. No API calls, persistence, clocks or text
// in the result. The bridge may remove CRLF/CR/LF; no other rewriting is allowed.
const SELF='900000004';
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u001f\u007f]/.test(value);
const own=(value,key)=>record(value)&&Object.getOwnPropertyDescriptor(value,key)?.value;
const fixedTarget=value=>value===SELF||value===Number(SELF);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const fold=value=>value.replace(/\r\n|[\r\n]/g,'');

function counts(value){
 if(typeof value!=='string')return null;
 let crlf=0,cr=0,lf=0;
 for(const match of value.matchAll(/\r\n|\r|\n/g)){
  if(match[0]==='\r\n')crlf++;else if(match[0]==='\r')cr++;else lf++;
 }
 return {chars:[...value].length,utf16_units:value.length,line_breaks:crlf+cr+lf,crlf,cr,lf};
}

export function compareQzoneText(expected,actual){
 const strings=typeof expected==='string'&&typeof actual==='string';
 const mode=!strings?'different':expected===actual?'exact':fold(expected)===fold(actual)?'line-break-folding':'different';
 return {matches:mode!=='different',mode,expected:counts(expected),actual:counts(actual)};
}

function sourceCheck(value,action,postId){
 const source=own(value,'source'),params=own(source,'parameters');
 const at=own(source,'observed_at');
 const checks={
  self:own(source,'self_id')===SELF,
  target:fixedTarget(own(source,'target_uin')),
  action:own(source,'action')===action,
  parameters_target:fixedTarget(own(params,'target_uin')),
  parameters_tid:action==='get_qzone_msg_list'?own(params,'tid')===undefined:own(params,'tid')===postId
 };
 return {valid:Object.values(checks).every(Boolean),checks,summary:{
  self_id:checks.self?SELF:null,target_uin:checks.target?SELF:null,
  action:checks.action?action:null,observed_at:integer(at)?at:null,
  observed_at_unit:'milliseconds',observed_at_known:integer(at),
  ...(action==='get_qzone_msg_detail'?{requested_tid:checks.parameters_tid?postId:null}:{})
 }};
}

export function qzoneReadback({postId,expectedContent,detail,list}={}){
 const detailSource=sourceCheck(detail,'get_qzone_msg_detail',postId),listSource=sourceCheck(list,'get_qzone_msg_list',postId);
 const detailData=own(detail,'data'),listData=own(list,'data'),rows=own(listData,'msglist'),total=own(listData,'total');
 const validPostId=validId(postId),matches=Array.isArray(rows)&&validPostId?rows.filter(row=>own(row,'tid')===postId):[];
 const listed=matches.length===1?matches[0]:null;
 const comparisons={detail:compareQzoneText(expectedContent,own(detailData,'content')),list:compareQzoneText(expectedContent,own(listed,'content'))};
 const checks={
  post_id:validPostId,
  expected_content:typeof expectedContent==='string'&&expectedContent.trim().length>0&&expectedContent.length<=20000,
  detail_ok:own(detail,'ok')===true,
  detail_kind:own(detail,'kind')==='own-post-detail',
  detail_source:detailSource.valid,
  detail_tid:validPostId&&own(detailData,'tid')===postId,
  detail_content:comparisons.detail.matches,
  list_ok:own(list,'ok')===true,
  list_kind:own(list,'kind')==='own-post-list',
  list_source:listSource.valid,
  list_shape:integer(total)&&Array.isArray(rows)&&rows.length<=100&&total>=rows.length,
  list_tid:matches.length===1,
  list_content:comparisons.list.matches
 };
 const verified=Object.values(checks).every(Boolean);
 return {verified,post_id:validPostId?postId:null,self_id:SELF,checks,comparisons,
  sources:{detail:detailSource.summary,list:listSource.summary},
  source_checks:{detail:detailSource.checks,list:listSource.checks},
  reason:verified?'detail-and-own-list-confirmed':Object.entries(checks).find(([,valid])=>!valid)?.[0]??'unconfirmed',
  text_basis:'exact-or-CRLF-CR-LF-removal-only',privacy_verified:false,images_verified:false,
  publication_time_verified:false,automatic_retry:false};
}

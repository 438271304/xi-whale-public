import assert from 'node:assert/strict';
import {compareQzoneText,qzoneReadback} from './qzone-readback.mjs';

const SELF='900000004',postId='synthetic-exact-tid';
const source=(action,at)=>({self_id:SELF,target_uin:Number(SELF),action,parameters:{target_uin:Number(SELF),pos:0,num:20,...(action==='get_qzone_msg_detail'?{tid:postId}:{})},observed_at:at,private_extra:'DO_NOT_RETURN_SOURCE_EXTRA'});
function pair(content='合成文字\n第二行 🐋'){
 return {postId,expectedContent:content,
  detail:{ok:true,kind:'own-post-detail',data:{tid:postId,content,comment_num:0,comments:[]},source:source('get_qzone_msg_detail',1793230002800)},
  list:{ok:true,kind:'own-post-list',data:{total:1,msglist:[{tid:postId,content,time:0}]},source:source('get_qzone_msg_list',1793230004100)}};
}
const copy=value=>structuredClone(value);
function fail(change,label){const value=pair();change(value);assert.equal(qzoneReadback(value).verified,false,label);}

assert.equal(compareQzoneText('🐋\n西','🐋西').mode,'line-break-folding');
assert.deepEqual(compareQzoneText('🐋\r\n甲\r乙\n','🐋甲乙').expected,{chars:7,utf16_units:8,line_breaks:3,crlf:1,cr:1,lf:1});
assert.equal(compareQzoneText('A\r\nB','A\nB').mode,'line-break-folding');
assert.equal(compareQzoneText('A\rB','AB').matches,true);
assert.equal(compareQzoneText('A\nB','A\r\nB').matches,true);
assert.equal(compareQzoneText('same\n','same\n').mode,'exact');
assert.equal(compareQzoneText('','').mode,'exact');
assert.equal(compareQzoneText('\r\n','').mode,'line-break-folding');
for(const [expected,actual] of [['a b','ab'],['a\tb','ab'],['a\u00a0b','ab'],['a\u3000b','ab'],['A','a'],['&amp;','&'],['🐋','🐳'],['👩‍💻','👩💻'],['é','e\u0301'],['a\u2028b','ab'],['a\u2029b','ab'],['a\u0085b','ab'],['a\nb','a b']])assert.equal(compareQzoneText(expected,actual).mode,'different');
for(const value of [null,undefined,1,{},[],new String('text')])assert.equal(compareQzoneText(value,value).matches,false);

const exact=qzoneReadback(pair());assert.equal(exact.verified,true);assert.equal(exact.comparisons.detail.mode,'exact');assert.equal(exact.comparisons.list.mode,'exact');
assert.equal(exact.sources.detail.observed_at,1793230002800);assert.equal(exact.sources.list.observed_at,1793230004100);assert.equal(exact.sources.detail.observed_at_unit,'milliseconds');
assert.equal(exact.publication_time_verified,false);assert.equal(exact.privacy_verified,false);assert.equal(exact.images_verified,false);assert.equal(exact.automatic_retry,false);
const folded=pair('甲\r\n乙\r丙\n🐋');folded.detail.data.content='甲乙丙🐋';folded.list.data.msglist[0].content='甲\n乙丙\r\n🐋';const receipt=qzoneReadback(folded);assert.equal(receipt.verified,true);assert.equal(receipt.comparisons.detail.mode,'line-break-folding');assert.equal(receipt.comparisons.list.mode,'line-break-folding');
const mixed=pair();mixed.list.data.msglist[0].content=mixed.expectedContent.replaceAll('\n','');assert.equal(qzoneReadback(mixed).verified,true);
const serialized=JSON.stringify(receipt);for(const privatePart of [folded.expectedContent,folded.detail.data.content,'DO_NOT_RETURN_SOURCE_EXTRA','content','comments'])assert.equal(serialized.includes(JSON.stringify(privatePart)),false);
assert.equal(qzoneReadback().verified,false);
for(const blank of ['', '\r\n', '   ']){const value=pair(blank);assert.equal(qzoneReadback(value).verified,false);}
for(const id of [null,undefined,'','x\ny',42])fail(v=>{v.postId=id;},'invalid post ID');
for(const side of ['detail','list']){
 fail(v=>{v[side].ok=false;},'API error is not empty success');
 fail(v=>{v[side].ok=1;},'truthy not success');
 fail(v=>{v[side].kind='wrong';},'wrong result kind');
 fail(v=>{v[side].source.self_id='123456789';},'wrong self account');
 fail(v=>{v[side].source.self_id=Number(SELF);},'self claim requires installed string contract');
 fail(v=>{v[side].source.target_uin=123456789;},'wrong target');
 fail(v=>{v[side].source.parameters.target_uin=123456789;},'wrong parameter target');
 fail(v=>{delete v[side].source;},'missing identity source');
 fail(v=>{v[side].source.action='send_qzone_msg';},'wrong action');
 fail(v=>{delete v[side].source.parameters;},'missing target parameters');
}
fail(v=>{v.detail.source.parameters.tid='other';},'detail requested other ID');
fail(v=>{v.list.source.parameters.tid=postId;},'list must be actual list request');
fail(v=>{v.detail.data.tid='same-text-other-id';},'matching text is not matching identity');
fail(v=>{v.list.data.msglist[0].tid='same-text-other-id';},'matching text in other post is not confirmation');
fail(v=>{v.detail.data.content='Other 🐋';},'only list matching fails');
fail(v=>{v.list.data.msglist[0].content='Other 🐋';},'only detail matching fails');
fail(v=>{v.detail.data.content=v.expectedContent.replace(' ','');},'other whitespace never folded');
fail(v=>{v.list.data.msglist[0].content=v.expectedContent.replace('🐋','🐳');},'emoji difference');
fail(v=>{v.list.data={total:0,msglist:[]};},'real empty list is valid read but no confirmation');
for(const data of [{total:1},{total:'1',msglist:[]},{total:-1,msglist:[]},{total:0,msglist:[{tid:postId,content:'same'}]},[],null])fail(v=>{v.list.data=data;},'malformed or contradictory list');
fail(v=>{v.list.data.msglist.push(copy(v.list.data.msglist[0]));v.list.data.total=2;},'ambiguous repeated post ID fails');
const unavailableTime=pair();delete unavailableTime.detail.source.observed_at;unavailableTime.list.source.observed_at=-1;const undated=qzoneReadback(unavailableTime);assert.equal(undated.verified,true);assert.equal(undated.sources.detail.observed_at,null);assert.equal(undated.sources.list.observed_at_known,false);
const otherRows=pair();otherRows.list.data.msglist.unshift({tid:'unrelated',content:'unrelated private text'});otherRows.list.data.total=2;assert.equal(qzoneReadback(otherRows).verified,true);
const original=pair();qzoneReadback(original);assert.deepEqual(original,pair(),'pure checks must not mutate evidence');
console.log('PASS QZone exact IDs plus two fixed-self inspect sources, only CRLF/CR/LF folding, no private text in receipts, Unicode/space/HTML differences rejected, empty/error/one-sided/other-ID readbacks unconfirmed; pure no network or writes');

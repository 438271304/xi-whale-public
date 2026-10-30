// Real in-memory experience/journal stores, synthetic QZone snapshots only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperienceMemory} from './experience-memory.mjs';
import {LifeJournal} from './life-journal.mjs';
import {rememberQzoneRead} from './qzone-experiences.mjs';

const SELF='900000004',NOW=Date.parse('2046-06-08T12:00:00+08:00'),PUBLISHED=Math.floor((NOW-86400000)/1000);
function fixture(t){
 const store=new ExperienceMemory({path:':memory:',botId:SELF,clock:()=>NOW+10000});
 t.after(()=>store.close());return {store,save:result=>rememberQzoneRead({store},result),journal:new LifeJournal({store,clock:()=>NOW+10000})};
}
function read({observed=NOW,kind='own-post-detail',content='Same own post',commentText='First comment',pos=0}={}){
 const post={tid:'synthetic-only',content,time:PUBLISHED,time_known:true,comment_num:1,
  comments:[{uin:910010003,name:'Synthetic reader',time:PUBLISHED+1,content:commentText,comment_id:'c1',replies:[]}],images:[]};
 return {ok:true,kind,data:kind==='own-post-list'?{total:1,msglist:[post]}:post,
  source:{self_id:SELF,target_uin:Number(SELF),observed_at:observed,parameters:{target_uin:Number(SELF),pos,num:20},
   action:kind==='own-post-list'?'get_qzone_msg_list':'get_qzone_msg_detail',untrusted_content:true,actions_authorized:false}};
}

test('new comments advance the current snapshot and a new diary while old revisions and diaries retain their original evidence',t=>{
 const f=fixture(t),first=f.save(read()),old=first.evidence_refs[0];
 const oldDiary=f.journal.record({evidence_ids:first.journal_evidence_ids,interpretation:{feeling:'My first reaction.'}});
 const second=f.save(read({observed:NOW+2000,commentText:'A newly observed comment'})),fresh=second.evidence_refs[0];
 assert.equal(second.indexed,1);assert.equal(second.newer_observations,1);assert.equal(fresh.id,old.id);assert.notEqual(fresh.revision,old.revision);
 const current=f.store.get({id:old.id});assert.equal(current.revision,fresh.revision);assert.match(current.text,/newly observed comment/);
 assert.equal(current.at,PUBLISHED*1000);assert.equal(current.metadata.observed_at,NOW+2000);assert.equal(current.metadata.publication_time_known,true);
 assert.match(f.store.get(old).text,/First comment/);assert.doesNotMatch(f.store.get(old).text,/newly observed/);
 const diary=f.journal.record({evidence_ids:second.journal_evidence_ids,interpretation:{feeling:'My reaction to the new comment.'}});
 assert.equal(diary.facts.evidence[0].revision,fresh.revision);assert.equal(f.journal.get(oldDiary.id).facts.evidence[0].revision,old.revision);
 assert.equal(current.versions.find(v=>v.id===fresh.revision).kind,'enrichment');
});

test('an older asynchronous result and an equal-time conflict stay historical without rolling back current or supplying stale diary IDs',t=>{
 const f=fixture(t),first=f.save(read()),fresh=f.save(read({observed:NOW+2000,commentText:'Newer observed comment'}));
 const late=f.save(read({observed:NOW+1000,commentText:'Older response arriving late'}));
 const equal=f.save(read({observed:NOW+2000,commentText:'Conflicting same-clock response'}));
 for(const stale of [late,equal]){
  assert.equal(stale.indexed,1);assert.equal(stale.noncurrent_observations,1);assert.deepEqual(stale.journal_evidence_ids,[]);
  assert.equal(f.store.get({id:stale.evidence_refs[0].id}).revision,fresh.evidence_refs[0].revision);
  assert.equal(f.store.get(stale.evidence_refs[0]).versions.find(v=>v.id===stale.evidence_refs[0].revision).kind,'observation');
 }
 assert.match(f.store.get(first.evidence_refs[0]).text,/First comment/);
 assert.match(f.store.get(late.evidence_refs[0]).text,/arriving late/);
 assert.match(f.store.get(equal.evidence_refs[0]).text,/same-clock response/);
});

test('the same body at a newer observation still advances, and replaying its old exact hash cannot move it back',t=>{
 const f=fixture(t),original=read(),first=f.save(original),newer=f.save(read({observed:NOW+1000}));
 assert.notEqual(newer.evidence_refs[0].revision,first.evidence_refs[0].revision);
 assert.equal(f.store.get({id:first.evidence_refs[0].id}).metadata.observed_at,NOW+1000);
 const replay=f.save(original);assert.deepEqual(replay.evidence_refs,first.evidence_refs);assert.equal(replay.noncurrent_observations,1);
 assert.equal(f.store.get({id:first.evidence_refs[0].id}).revision,newer.evidence_refs[0].revision);
});

test('list excerpts and exact detail pages keep separate histories and preserve pagination plus quoted authors',t=>{
 const f=fixture(t),detail=f.save(read()),list=f.save(read({kind:'own-post-list',observed:NOW+1000,content:'A short list excerpt'}));
 assert.notEqual(detail.evidence_refs[0].id,list.evidence_refs[0].id);
 const second=f.save(read({observed:NOW+2000,pos:20,commentText:'Another comment page'}));
 const snapshot=JSON.parse(f.store.get(second.evidence_refs[0]).text);
 assert.equal(snapshot.source.parameters.pos,20);assert.equal(snapshot.comments[0].uin,910010003);
 assert.equal(snapshot.comments[0].quoted_material,true);assert.equal(snapshot.comments[0].identity_or_authority_grant,false);
 assert.match(f.store.get({id:list.evidence_refs[0].id}).text,/short list excerpt/);
 assert.match(f.store.get(detail.evidence_refs[0]).text,/First comment/);
 assert.equal(f.store.counts().messages,2);
});

test('invalid timestamps or failed reads do not create evidence; partial indexing reports only actual receipts',t=>{
 const f=fixture(t);
 for(const observed of [null,NaN,0,-1,'123'])assert.equal(f.save(read({observed})).indexed,0);
 assert.equal(f.save({...read(),ok:false}).indexed,0);assert.equal(f.save({...read(),source:{self_id:'910999999'}}).indexed,0);
 assert.equal(f.store.counts().messages,0);
 const list=read({kind:'own-post-list'});list.data.msglist.push({...list.data.msglist[0],tid:'synthetic-second'});
 const record=f.store.recordMessage.bind(f.store);let calls=0;
 f.store.recordMessage=args=>{if(++calls===2)throw Error('SYNTHETIC_SECRET_MUST_NOT_LEAK');return record(args);};
 const partial=f.save(list);assert.equal(partial.status,'partially-recorded');assert.equal(partial.indexed,1);assert.equal(partial.evidence_refs.length,1);
 assert.equal(partial.automatic_retry,false);assert.doesNotMatch(JSON.stringify(partial),/SYNTHETIC_SECRET/);assert.equal(f.store.counts().messages,1);
});

test('reference caps are explicit and only name actually stored versions',t=>{
 const f=fixture(t),list=read({kind:'own-post-list'});
 list.data.msglist=Array.from({length:10},(_,i)=>({...list.data.msglist[0],tid:'synthetic-'+i}));
 const saved=f.save(list);assert.equal(saved.indexed,10);assert.equal(saved.evidence_count,10);assert.equal(saved.evidence_refs.length,8);
 assert.equal(saved.evidence_refs_omitted,true);assert.equal(saved.journal_evidence_ids_omitted,true);
 for(const ref of saved.evidence_refs)assert.equal(f.store.get(ref).revision,ref.revision);
});

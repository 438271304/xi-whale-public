import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {conversationExtras} from './conversation-extras.mjs';
import {conversationCapabilities} from './conversation-capabilities.mjs';
import {LifeContinuity} from './life-continuity.mjs';

test('chat discovery and independent life use the same unconfigured read tools', async()=>{
 const extras=conversationExtras({workspace:'.',notesRoot:'.',familyGroup:'12345'});
 const all=extras({kind:'private',id:'12345'},{});
 const discovered=conversationCapabilities(all,'今天能逛贴吧吗');
 for(const name of ['tieba_status','tieba_list','tieba_thread','tieba_floor']){
  assert.ok(discovered.some(t=>t.name===name));assert.ok(extras.publicTools().some(t=>t.name===name));
 }
 const state=JSON.parse(await discovered.find(t=>t.name==='tieba_status').handler({}));
 assert.equal(state.status,'unconfigured');assert.equal(state.claw_access_verified,false);
 const read=JSON.parse(await discovered.find(t=>t.name==='tieba_thread').handler({thread_id:'12345'}));
 assert.equal(read.status,'unconfigured');assert.deepEqual(read.sources,[]);
 await extras.close();
});
test('life evidence keeps list as a lead and preserves actual thread reading range',()=>{
 const db=new DatabaseSync(':memory:');const life=new LifeContinuity(db);
 assert.equal(life.recordReading('lead','activity','tieba_list',{evidence_level:'search-lead'}),'search-lead');
 const result={evidence_level:'thread-posts',thread_id:'12345',parent_post_id:'987',read_scope:{requested_page:2,next_page:3,whole_thread_read:false},gaps:['reply-targets-not-exposed']};
 assert.equal(life.recordReading('read','activity','tieba_floor',result),'thread-posts');
 const details=JSON.parse(db.prepare('SELECT details FROM life_reading_evidence WHERE discovery=?').get('read').details);
 assert.deepEqual(details.read_scope,result.read_scope);assert.equal(details.parent_post_id,'987');assert.deepEqual(details.gaps,result.gaps);db.close();
});

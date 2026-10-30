import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ExperienceMemory} from './experience-memory.mjs';

const root=mkdtempSync(join(tmpdir(),'whale-experience-')),paths=Object.fromEntries(['history','turns','media','context'].map(k=>[k+'Path',join(root,k+'.sqlite3')]));
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const at=1793010000000,structured={transport:{conversation:'group:12345',sender_id:'900000001',time:at/1000,message_id:'17'},body:'一起看看这个海洋看板',received_images:{ids:['img-ocean']}};
let db=new DatabaseSync(paths.historyPath);db.exec('CREATE TABLE history(scope TEXT,event TEXT,text TEXT,at TEXT,source TEXT,hash TEXT)');db.prepare('INSERT INTO history VALUES(?,?,?,?,?,?)').run('group-12345','17',JSON.stringify(structured),new Date(at).toISOString(),'admitted-transport','unused');db.close();
db=new DatabaseSync(paths.turnsPath);db.exec('CREATE TABLE turns(peer TEXT,event TEXT,role TEXT,text TEXT,at INTEGER,state TEXT)');db.prepare('INSERT INTO turns VALUES(?,?,?,?,?,?)').run('group:12345','17','user',JSON.stringify(structured),at,'completed');db.prepare('INSERT INTO turns VALUES(?,?,?,?,?,?)').run('private:900000001','18','user','刚才那张图你喜欢吗',at+2000,'accepted');db.close();
db=new DatabaseSync(paths.mediaPath);db.exec('CREATE TABLE scoped_media(id TEXT,owner TEXT,mime TEXT,sha TEXT,bytes BLOB,source TEXT,created INTEGER);CREATE TABLE image_analysis(id TEXT,owner TEXT,result TEXT,at INTEGER)');db.prepare('INSERT INTO scoped_media VALUES(?,?,?,?,?,?,?)').run('img-ocean','group-12345','image/png','sha-fixture',Buffer.from('PRIVATE_IMAGE_BYTES'),'17',at);db.prepare('INSERT INTO image_analysis VALUES(?,?,?,?)').run('img-ocean','group-12345',JSON.stringify({status:'vision-ok',vision:{status:'ok',description:'蓝色海洋看板，带小鲸鱼'}}),at+100);db.close();
db=new DatabaseSync(paths.contextPath);db.exec('CREATE TABLE qq_names(scope TEXT,id TEXT,label TEXT,at INTEGER)');db.prepare('INSERT INTO qq_names VALUES(?,?,?,?)').run('group-12345','900000001','老爹',at);db.close();
const originals=Object.fromEntries(Object.values(paths).map(p=>[p,digest(p)])),m=new ExperienceMemory({path:join(root,'experience.sqlite3'),clock:()=>at+3000});
try{
 const imported=m.importSources(paths);assert.equal(imported.counts.messages,2);assert.equal(imported.counts.attachments,1);assert.equal(imported.reports.history.skipped,0);assert.equal(imported.reports.media.skipped,0);
 const group=m.get({scope:{kind:'group',id:'12345'},event:'17'});assert.equal(group.found,true);assert.equal(group.sender_id,'900000001');assert.equal(group.sources.length,2);assert.ok(group.sources.some(s=>s.reference.store==='history.sqlite3'));assert.deepEqual(group.attachments,['img-ocean']);
 const repeated=m.importSources(paths);assert.equal(repeated.counts.messages,2);assert.equal(repeated.counts.versions,2);assert.equal(repeated.counts.attachments,1);
 const cross=m.search({query:'海洋看板',includeAttachments:true});assert.ok(cross.records.some(r=>r.id===group.id));assert.equal(cross.attachments[0].analysis_status,'vision-ok');assert.equal(cross.attachments[0].bytes_included,false);assert.equal(cross.attachments[0].message_id,group.id);
 const context=m.context({scope:'private:900000001',current:JSON.stringify({body:'刚才群里那张图呢'}),maxChars:6000});assert.ok(context.attachments.some(a=>a.id==='img-ocean'&&a.scope==='group:12345'));assert.ok([...context.related,...context.recent_other_sources].some(r=>r.id===group.id));assert.ok(JSON.stringify(context).length<=6000);assert.ok(!JSON.stringify(context).includes('PRIVATE_IMAGE_BYTES'));
 const duplicate=m.recordMessage({scope:'group:12345',event:'17',text:JSON.stringify(structured),at,source:'same-content'});assert.equal(duplicate.status,'duplicate');
 const conflicting=m.recordMessage({scope:'group:12345',event:'17',text:'不确定的另一份记录',at,source:'other-copy'});assert.equal(conflicting.status,'conflict-preserved');assert.equal(m.get({id:group.id}).text,JSON.stringify(structured));
 const correction=m.recordMessage({scope:'group:12345',event:'17',text:'已纠正：是海洋看板，不是壁纸',at,source:'explicit-correction',revisionKind:'correction'});assert.equal(m.get({id:group.id}).revision,correction.revision);assert.equal(m.get({id:group.id,revision:group.revision}).text,JSON.stringify(structured));assert.equal(m.get({id:group.id}).versions.length,3);
 const note=m.recordMessage({scope:'private:900000001',event:'note:ideas.md',role:'self',text:'我想做个海洋画框',source:'self-note',revisionKind:'note-update'});m.recordMessage({scope:'private:900000001',event:'note:ideas.md',role:'self',text:'我想做海洋相册',source:'self-note',revisionKind:'note-update'});assert.equal(m.get({id:note.id}).text,'我想做海洋相册');
 m.recordAttachment({scope:'group:12345',id:'img-ocean',event:'19',analysis:null});assert.equal(m.getAttachment('img-ocean').analysis_status,'vision-ok');assert.deepEqual(m.getAttachment('img-ocean').events,['17','19']);
 m.setState({kind:'interest',key:'海洋作品',value:'最近想画自己的海洋',evidence:[{type:'message',id:group.id}]});m.setState({kind:'interest',key:'海洋作品',value:'先做小鲸鱼相册',evidence:[{type:'attachment',id:'img-ocean'}]});assert.equal(m.getState({kind:'interest'})[0].value,'先做小鲸鱼相册');assert.equal(m.getState({kind:'interest',history:true}).length,2);assert.equal(m.getState({kind:'interest'})[0].basis,'linked-experience');
 const unverified=m.setState({kind:'unfinished',key:'想法',value:'也许想做个相框'});assert.equal(unverified.basis,'unverified-self-report');assert.throws(()=>m.setState({kind:'mood',key:'today',value:'开心',evidence:[{type:'message',id:'invented'}]}),/Unknown/);
 const unknown=m.recordMessage({scope:'unknown',event:'legacy-1',role:'unknown',text:'来源尚未核实的旧片段',source:'legacy-unattributed'});assert.equal(m.get({id:unknown.id}).source_known,false);assert.equal(m.get({id:unknown.id}).sender_id,null);assert.equal(m.get({id:'not-here'}).reason,'not-in-local-index');assert.equal(m.getAttachment('missing').reason,'attachment-not-in-local-index');
 for(const [p,old] of Object.entries(originals))assert.equal(digest(p),old,'Original source database changed: '+p);
 assert.ok(!JSON.stringify(m.search({query:''})).includes('PRIVATE_IMAGE_BYTES'));
 const long=m.recordMessage({scope:'private:900000001',event:'long',text:'x'.repeat(30000)}),page=m.get({id:long.id,maxChars:1000});assert.equal(page.text.length,1000);assert.equal(page.next_offset,1000);
 console.log('PASS unified QQ import/source trace, group image to private context, source DB immutability, idempotence, versioned conflict/correction, self-note/state evidence, missing/unknown markers, bounded paging, no image bytes');
}finally{m.close();rmSync(root,{recursive:true,force:true});}

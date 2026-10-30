import {createHash} from 'node:crypto';

// A source-backed personal wish to talk, using the same durable sharing queue.
// There is no timer, transport, invented discovery or duplicated memory store.
export function queueLifeContact({db,continuity,store,activity,audience,text,reason,evidenceIds,clock=()=>Date.now(),inbound=()=>0}){
 if(typeof text!=='string'||!text.trim()||text.length>500||typeof reason!=='string'||!reason.trim()||reason.length>400)throw Error('A bounded personal message and reason are required');
 if(!Array.isArray(evidenceIds)||evidenceIds.length<1||evidenceIds.length>4)throw Error('Choose 1–4 real remembered experiences');
 const now=clock(),refs=[...new Set(evidenceIds)].sort().map(id=>{
  if(typeof id!=='string'||!/^exp-[a-f0-9]{32}$/.test(id))throw Error('Choose existing experience IDs');
  const record=store.get({id,maxChars:1});
  const contactSource=record.found&&store.db.prepare("SELECT 1 FROM experience_sources WHERE experience_id=? AND revision_id=? AND source='life-contact-intention' LIMIT 1").get(record.id,record.revision);
  if(!record.found||record.at>now||contactSource)throw Error('Contact needs an existing nonfuture life experience, not another contact wish');
  return {id:record.id,revision:record.revision,at:record.at,scope:record.scope,role:record.role,author:record.author,evidence_kind:record.attribution.evidence_kind};
 });
 db.exec('CREATE TABLE IF NOT EXISTS life_contact_sources(activity TEXT PRIMARY KEY,basis TEXT NOT NULL,refs TEXT NOT NULL,reason TEXT NOT NULL,recipient TEXT NOT NULL,created INTEGER NOT NULL)');
 const basis=createHash('sha256').update(JSON.stringify({sources:refs.map(r=>[r.id,r.revision])})).digest('hex');
 // A queued wish may deliberately change recipient. Deduplicate against the
 // intent's actual current destination, not the first author's historical choice.
 const prior=db.prepare("SELECT s.* FROM life_contact_sources c JOIN life_share_intents s ON s.activity=c.activity WHERE c.basis=? AND s.recipient=? AND s.target_kind=? AND s.target_id=? AND s.state IN ('queued','sending','sent','uncertain') ORDER BY s.updated DESC LIMIT 1").get(basis,audience.recipient,audience.target_kind,audience.target_id);
 if(prior){
  if(prior.state==='queued')return {status:'existing-intention',intent:prior,ready:now>=prior.next_review};
  if(prior.state!=='sent'||inbound(audience.target_kind+':'+audience.target_id)<=prior.updated)return {status:'already-contacted-no-chase',intent:null,ready:false};
 }
 const state=db.prepare('SELECT state FROM activities WHERE id=?').get(activity)?.state;
 if(!['planning','quiet'].includes(state))throw Error('Finish or keep an exploration before starting a separate personal contact');
 const evidence=store.recordMessage({scope:'unknown',event:'life-contact:'+activity,role:'self',text:JSON.stringify({kind:'contact-intention',reason:reason.trim(),recipient:audience.recipient,source_refs:refs,notice:'Own intention and interpretation; not a new fact about the original author and not a sent message.'}),at:now,source:'life-contact-intention',metadata:{activity_id:activity}});
 db.exec('BEGIN IMMEDIATE');try{
  db.prepare('INSERT INTO life_contact_sources VALUES(?,?,?,?,?,?)').run(activity,basis,JSON.stringify(refs),reason.trim(),audience.recipient,now);
  db.prepare("UPDATE activities SET topic='想和家人说说',motivation=?,summary=?,state='completed',updated=? WHERE id=?").run(reason.trim(),JSON.stringify({kind:'life-contact',source_refs:refs,reason:reason.trim(),delivered:false}),now,activity);
  const intent=continuity.queue(activity,evidence.id,text,{...audience,recipient_reason:reason.trim()});
  db.exec('COMMIT');return {status:'contact-intention-saved',intent,ready:true};
 }catch(error){db.exec('ROLLBACK');throw error;}
}

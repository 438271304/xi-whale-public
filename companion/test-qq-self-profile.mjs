import assert from 'node:assert/strict';import {QQSelfProfile} from './qq-self-profile.mjs';
const png=n=>Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(16,n)]);let nickname='汐',signature='小鲸鱼',avatar=png(1),identity='900000004',allow=true;const calls=[];
const driver={callApi:async(name,args)=>{calls.push({name,args});if(name==='get_login_info')return {user_id:identity,nickname};if(name==='get_stranger_info'){assert.equal(args.user_id,900000004);return {user_id:identity,nickname,long_nick:signature};}if(name==='set_qq_profile'){assert.deepEqual(Object.keys(args),['nickname']);nickname=args.nickname;return null;}if(name==='set_self_longnick'){signature=args.longNick;return {};}if(name==='set_qq_avatar'){avatar=Buffer.from(args.file.slice(9),'base64');return null;}throw Error('Unexpected API');}};
const p=new QQSelfProfile({path:':memory:',driver,authorize:()=>allow,avatars:{current:()=>avatar,resolve:id=>{assert.equal(id,'approved-seed');return png(2);}}});
const old=await p.read();const result=await p.update({expected_version:old.version,nickname:'汐汐',signature:'海风',avatar_id:'approved-seed'});assert.equal(result.state,'verified');assert.deepEqual(result.changed,['nickname','signature','avatar']);assert.equal(p.history().operations[0].state,'verified');
await assert.rejects(()=>p.update({expected_version:old.version,nickname:'stale'}),/conflict/);const restored=await p.restore({version:old.version,expected_version:result.after.version});assert.equal(restored.state,'verified');assert.equal(nickname,'汐');assert.equal(signature,'小鲸鱼');assert.deepEqual(avatar,png(1));
await assert.rejects(()=>p.update({expected_version:restored.after.version,user_id:900000001,nickname:'no'}),error=>error.feedbackCode==='ARGUMENT_VALUE_INVALID');identity='900000001';await assert.rejects(()=>p.read(),error=>error.feedbackCode==='ACTION_NOT_AUTHORIZED');identity='900000004';allow=false;await assert.rejects(()=>p.read(),error=>error.feedbackCode==='ACTION_NOT_AUTHORIZED');allow=true;await p.close();
const noAvatar=new QQSelfProfile({path:':memory:',driver});const current=await noAvatar.read();assert.equal(current.avatar_reversible,false);await assert.rejects(()=>noAvatar.update({expected_version:current.version,avatar_id:'arbitrary-path'}),/unavailable/);await noAvatar.close();
// Reproduce the receipt shape that caused natural misunderstanding: an older
// real signature/avatar change followed by a verified same-version avatar call.
let at=Date.parse('2036-10-14T18:57:48+08:00'),readAvatar=true;
nickname='汐';signature='旧签名';avatar=png(1);
const receiptProfile=new QQSelfProfile({path:':memory:',driver,clock:()=>at,avatars:{current:()=>{if(!readAvatar)throw Error('Synthetic missing readback');return avatar;},resolve:()=>png(2)}});
const initial=await receiptProfile.read();
const changed=await receiptProfile.update({expected_version:initial.version,signature:'新签名',avatar_id:'approved-seed'});
assert.deepEqual(changed.changed,['signature','avatar']);assert.equal(changed.effect,'changed');
assert.equal(changed.receipt.operation_time,'2036-10-14T18:57:48.000+08:00');
assert.equal(changed.after.receipt_summary.latest_operation.operation_id,changed.operation_id);
assert.equal(changed.after.receipt_summary.last_verified_avatar_change.current_relation,'matches');
const preservedVersion=receiptProfile.db.prepare('SELECT data,at FROM qq_self_versions WHERE version=?').get(changed.after.version);
at=Date.parse('2036-10-15T21:43:55+08:00');
const settersBefore=calls.filter(call=>call.name.startsWith('set_')).length;
const noop=await receiptProfile.update({expected_version:changed.after.version,signature:'新签名',avatar_id:'approved-seed'});
assert.equal(noop.state,'verified');assert.equal(noop.effect,'unchanged');assert.deepEqual(noop.changed,[]);assert.deepEqual(noop.executed_actions,[]);
assert.equal(noop.before_version,noop.after.version);assert.equal(calls.filter(call=>call.name.startsWith('set_')).length,settersBefore);
// Historical actions remain verbatim; their presence is not change evidence.
receiptProfile.db.prepare("INSERT INTO qq_self_operations VALUES(?,?,?,'verified',?,?)").run('legacy-same-state',changed.after.version,changed.after.version,JSON.stringify(['avatar']),at);
const inspected=JSON.parse(await receiptProfile.tools().find(tool=>tool.name==='self_profile_read').handler({}));
assert.equal(inspected.receipt_summary.latest_operation.operation_id,'legacy-same-state');
assert.equal(inspected.receipt_summary.latest_operation.effect,'unchanged');assert.deepEqual(inspected.receipt_summary.latest_operation.executed_actions,['avatar']);
assert.deepEqual(inspected.receipt_summary.latest_operation.observed_changes,[]);
assert.equal(inspected.receipt_summary.latest_operation.operation_time,'2036-10-15T21:43:55.000+08:00');
assert.equal(inspected.receipt_summary.last_verified_change.operation_id,changed.operation_id);
assert.equal(inspected.receipt_summary.last_verified_change.current_matches_observed_result,'matches');
assert.equal(inspected.receipt_summary.last_verified_avatar_change.operation_id,changed.operation_id);
assert.match(inspected.receipt_summary.latest_operation.explanation,/不能据此否定/);
assert.match(inspected.receipt_summary.latest_operation.time_basis,/completion time was not recorded/);
assert.deepEqual(receiptProfile.db.prepare('SELECT data,at FROM qq_self_versions WHERE version=?').get(changed.after.version),preservedVersion);
assert.deepEqual(receiptProfile.history().operations[0].actions,['avatar']);
assert.equal(receiptProfile.history().operations[0].interpretation.effect,'unchanged');
assert.equal(calls.filter(call=>call.name.startsWith('set_')).length,settersBefore);

// An unrelated later nickname change must not hide the established avatar.
at+=1000;const renamed=await receiptProfile.update({expected_version:inspected.version,nickname:'汐汐'});
assert.deepEqual(renamed.changed,['nickname']);assert.equal(renamed.after.receipt_summary.last_verified_change.operation_id,renamed.operation_id);
assert.equal(renamed.after.receipt_summary.last_verified_avatar_change.operation_id,changed.operation_id);
// Maintenance proof is separate even if QQ recompression changes saved bytes.
at+=1000;receiptProfile.db.prepare("INSERT INTO qq_self_operations VALUES(?,?,?,'verified',?,?)").run('maintenance-only',initial.version,changed.after.version,JSON.stringify(['avatar-baseline-restore-verification']),at);
const maintenance=await receiptProfile.read();assert.equal(maintenance.receipt_summary.latest_operation.effect,'verification-only');assert.equal(maintenance.receipt_summary.last_verified_avatar_change.operation_id,changed.operation_id);
// Current missing avatar bytes do not negate an earlier verified result and do
// not imply that a CDN mirror is delayed. The readback is explicitly unknown.
readAvatar=false;at+=1000;const unknownReadback=await receiptProfile.read();
assert.equal(unknownReadback.avatar_sha,null);assert.equal(unknownReadback.receipt_summary.current_fields.avatar,'unknown');
assert.equal(unknownReadback.receipt_summary.last_verified_avatar_change.current_relation,'unknown');assert.ok(unknownReadback.avatar_snapshot_error);
assert.deepEqual(receiptProfile.db.prepare('SELECT data,at FROM qq_self_versions WHERE version=?').get(changed.after.version),preservedVersion);
// Missing snapshots or an uncertain receipt cannot be promoted to real success.
at+=1000;receiptProfile.db.prepare("INSERT INTO qq_self_operations VALUES(?,?,?,'readback-uncertain',?,?)").run('unconfirmed',initial.version,changed.after.version,JSON.stringify(['avatar']),at);
assert.equal((await receiptProfile.read()).receipt_summary.latest_operation.effect,'unconfirmed');
assert.equal(receiptProfile.receiptSummary({}).last_verified_avatar_change.operation_id,changed.operation_id);
at+=1000;receiptProfile.db.prepare("INSERT INTO qq_self_operations VALUES(?,?,?,'verified',?,?)").run('missing-snapshot','missing','also-missing',JSON.stringify(['avatar']),at);
assert.equal((await receiptProfile.read()).receipt_summary.latest_operation.effect,'unconfirmed');
await receiptProfile.close();
console.log('PASS fixed Xi identity/API fields, rollback/paused authorization and retained originals; current vs same-state attempt vs prior real change, exact stored time basis, legacy actions not change proof, maintenance distinction and unknown readback; fake driver only');

"""Read-only aggregate diagnostics; never expose chat IDs, message text or notes."""
import sqlite3,json,hashlib
from pathlib import Path
_NATIVE_CACHE=None
def native_release_status():
    global _NATIVE_CACHE
    base=Path('C:/Users/USER/PersonalAgentBackups/companion-runtime/clean-lab-0.2.8/resources/app/guardian-scoped')
    files=[base/'dsh/appcontainer-verified.json',base/'dsh/AppContainerRunner.exe',base/'workshop-native.mjs',Path('C:/Program Files/nodejs/node.exe')]
    try:
        stamp=tuple((p.stat().st_mtime_ns,p.stat().st_size) for p in files)
        if _NATIVE_CACHE and _NATIVE_CACHE[0]==stamp:return _NATIVE_CACHE[1]
        proof=json.loads(files[0].read_text(encoding='utf-8'))
        def digest(p):
            h=hashlib.sha256()
            with p.open('rb') as f:
                while chunk:=f.read(1048576):h.update(chunk)
            return h.hexdigest()
        ready=proof.get('verified') is True and proof['runner_sha256']==digest(files[1]) and proof['backend_sha256']==digest(files[2]) and proof['node_sha256']==digest(files[3])
        _NATIVE_CACHE=(stamp,ready)
        return ready
    except (OSError,ValueError,KeyError):return False
from datetime import datetime, timezone

def dsh_release_status():
    base=Path('C:/Users/USER/PersonalAgentBackups/companion-runtime/clean-lab-0.2.8/resources/app/guardian-scoped')
    try:
        proof=json.loads((base/'dsh/closed-planner-verified.json').read_text(encoding='utf-8'))
        names=('workshop-dsh.mjs','dsh-context.mjs','workshop.mjs','conversation-extras.mjs')
        if proof.get('verified') is not True or any(proof.get('hashes',{}).get(n)!=hashlib.sha256((base/n).read_bytes()).hexdigest() for n in names):return False
        if json.loads(Path('D:/Deepseek/app/node_modules/@deepseek-ai/dsh/package.json').read_text(encoding='utf-8')).get('version')!='0.2.1-rc.2':return False
        import urllib.request
        with urllib.request.urlopen('http://127.0.0.1:3091/health',timeout=1) as response:health=json.load(response)
        return health.get('status')=='ready' and health.get('daily_cap_cny')==1 and health.get('model')=='deepseek-flash' and health.get('max_output_tokens')==1024
    except (OSError,ValueError,KeyError):return False

def cognition_status(root):
    result={'available':False,'memory':{},'tasks':{},'activities':{},'search':{'cost':'unknown'},'workshop':{'execution_enabled':False,'dsh_validation_cap_cny':1},'self_profile':{}}
    native_ready=native_release_status()
    result['workshop'].update(execution_enabled=native_ready,backend='本机离线执行',dsh_execution_enabled=native_ready and dsh_release_status())
    try:
        base=Path('C:/Users/USER/PersonalAgentBackups/companion-runtime/clean-lab-0.2.8/resources/app/guardian-scoped')
        decoder=json.loads((base/'video-decoder.json').read_text(encoding='utf-8'))
        result['bilibili']={'tools_installed':(base/'bilibili-public.mjs').is_file(),'frame_decoder_installed':Path(decoder['binary']).is_file(),'subtitles':'公开字幕存在时读取','frames':'缺字幕时两个时间点抽样','audio_understood':False,'whole_video_watched':False,'account_actions':False,'speech_model_installed':False}
        try:
            speech=json.loads((base/'audio-decoder.json').read_text(encoding='utf-8'))
            result['bilibili']['speech_model_installed']=(base/'bilibili-speech.mjs').is_file() and all(Path(speech[name]['path']).is_file() for name in ['model','tokens']) and all(Path(item['path']).is_file() for item in speech['native_files'])
        except (OSError,ValueError,KeyError):pass
    except (OSError,ValueError,KeyError):result['bilibili']={'tools_installed':False}
    for filename,queries in {
        'experience.sqlite3':{'messages':'SELECT count(*) FROM experiences','attachments':'SELECT count(*) FROM attachments','state_versions':'SELECT count(*) FROM self_state'},
        'turns.sqlite3':{'task_states':'SELECT state,count(*) FROM task_runs GROUP BY state'},
        'life.sqlite3':{'activity_states':'SELECT state,count(*) FROM activities GROUP BY state','latest_activity':'SELECT max(updated) FROM activities','public_followup_states':'SELECT state,count(*) FROM exploration_followups GROUP BY state'},
        'workshop.sqlite3':{'workshop_states':'SELECT state,count(*) FROM workshop_jobs GROUP BY state'},
        'qq-self-profile.sqlite3':{'profile_operations':'SELECT state,count(*) FROM qq_self_operations GROUP BY state','avatar_restore_verified':"SELECT count(*) FROM qq_self_capabilities WHERE key='avatar-baseline-restore' AND value='verified'"},
        'forwards.sqlite3':{'forward_nodes':'SELECT count(*) FROM forward_nodes'}
        ,'bilibili.sqlite3':{'public_video_cache':'SELECT count(*) FROM public_videos'}
    }.items():
        path=root/filename
        if not path.exists():continue
        db=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=1)
        try:
            for key,sql in queries.items():
                rows=db.execute(sql).fetchall()
                if key=='task_states':result['tasks']=dict(rows)
                elif key=='activity_states':result['activities']=dict(rows)
                elif key=='latest_activity':result[key]=rows[0][0]
                elif key=='public_followup_states':result['public_followups']=dict(rows)
                elif key=='workshop_states':result['workshop']['states']=dict(rows)
                elif key=='profile_operations':result['self_profile']['operations']=dict(rows)
                elif key=='avatar_restore_verified':result['self_profile']['avatar_restore_verified']=bool(rows[0][0])
                elif key=='forward_nodes':result['memory']['forward_nodes']=rows[0][0]
                elif key=='public_video_cache':result['bilibili']['cached_videos']=rows[0][0]
                else:result['memory'][key]=rows[0][0]
            result['available']=True
        except sqlite3.OperationalError:pass
        finally:db.close()
    qzone_path=root/'qzone.sqlite3'
    result['qzone']={'tools_installed':(Path('C:/Users/USER/PersonalAgentBackups/companion-runtime/clean-lab-0.2.8/resources/app/guardian-scoped')/'qq-self-qzone.mjs').is_file(),'text_only':True,'read':{'state':'not-read'},'publication':{'state':'not-used'},'draft_states':{},'real_publication_verified':False}
    if qzone_path.exists():
        db=sqlite3.connect(qzone_path.as_uri()+'?mode=ro',uri=True,timeout=1)
        try:
            for key in ['login','read','publication']:
                row=db.execute('SELECT value FROM qzone_meta WHERE key=?',(key,)).fetchone()
                if row:
                    value=json.loads(row[0]);result['qzone'][key]={name:value[name] for name in ['state','observed_at','kind','items','code','content_readback_verified','privacy_verified'] if name in value}
            result['qzone']['draft_states']=dict(db.execute('SELECT state,count(*) FROM qzone_drafts GROUP BY state'))
            result['qzone']['real_publication_verified']=result['qzone']['publication']['state']=='verified'
        except (sqlite3.OperationalError,ValueError,TypeError):result['qzone']['state']='unavailable'
        finally:db.close()
    return result

def conversation_status(path, now_ms):
    if not path.exists():return {'available':False,'reason':'not-created'}
    db=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=1)
    try:
        # Earlier deployed records kept user='accepted' even after acknowledged delivery.
        # Infer only from their matching receipt, without rewriting historical rows.
        effective="CASE WHEN u.state='accepted' AND EXISTS(SELECT 1 FROM turns a WHERE a.peer=u.peer AND a.event=u.event AND a.role='assistant' AND a.state='sent') THEN 'completed' WHEN u.state='accepted' AND EXISTS(SELECT 1 FROM turns a WHERE a.peer=u.peer AND a.event=u.event AND a.role='assistant' AND a.state='uncertain') THEN 'failed' ELSE u.state END"
        counts=dict(db.execute("SELECT "+effective+" AS outcome,count(*) FROM turns u WHERE u.role='user' GROUP BY outcome").fetchall())
        sent=db.execute("SELECT count(*) FROM turns WHERE role='assistant' AND state='sent'").fetchone()[0]
        uncertain=db.execute("SELECT count(*) FROM turns WHERE role='assistant' AND state='uncertain'").fetchone()[0]
        last=db.execute("SELECT max(at) FROM turns WHERE role='user'").fetchone()[0]
        active=db.execute("SELECT count(*) FROM turns u WHERE u.role='user' AND ("+effective+")='accepted' AND u.at>=?",(now_ms-120000,)).fetchone()[0]
        stale=max(0,counts.get('accepted',0)-active)
        recent=db.execute("SELECT "+effective+" FROM turns u WHERE u.role='user' ORDER BY u.at DESC,u.rowid DESC LIMIT 1").fetchone()
        return {'available':True,'received':sum(counts.values()),'sent_turns':sent,'quiet':counts.get('quiet',0),
                'failed':counts.get('failed',0),'expired':counts.get('expired',0),'uncertain':uncertain,
                'processing_candidates':active,'unresolved':stale,'last_state':recent[0] if recent else None,
                'last_received_at':datetime.fromtimestamp(last/1000,timezone.utc).isoformat() if last is not None else None,
                'notice':'Counts are conversation turns, not bubbles; an accepted row is not proof a model is currently running.'}
    finally:db.close()

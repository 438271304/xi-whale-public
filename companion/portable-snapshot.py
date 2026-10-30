"""Quiesced companion snapshot, recovery-key encrypted, verified isolated restore.
No provider credentials, QQ login, upload, production restore or key output.
"""
import sys,json,hashlib,shutil,zipfile
from pathlib import Path
from datetime import datetime,timezone
PROJECT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(PROJECT/'scripts'))
from portable_backup import private_directory,decode_key,transform
from archive import create,restore

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def selected_data(data):
    """Explicit allowlist: session events and media, never runtime configuration."""
    for p in data.glob('*'):
        if p.is_file() and p.suffix in {'.jsonl','.sqlite3','.json'}:yield p
    for name in ('runs','qq-history-pages','media'):
        folder=data/name
        if folder.is_symlink() or (hasattr(folder,'is_junction') and folder.is_junction()):raise ValueError('Data directory link refused')
        for p in folder.rglob('*'):
            if p.is_symlink() or (hasattr(p,'is_junction') and p.is_junction()):raise ValueError('Data link refused')
            if not p.is_file():continue
            if name=='runs' and p.name not in {'events.jsonl','run.json'}:continue
            if name=='qq-history-pages' and p.suffix!='.jsonl':continue
            yield p
def main():
    runtime=Path('C:/Users/USER/PersonalAgentRuntime/whale-v1')
    receipt=json.loads((runtime/'runtime.json').read_text(encoding='utf-8'))
    if receipt.get('state')!='stopped':raise ValueError('Runtime must be stopped')
    custody=json.loads((PROJECT/'hub/reports/recovery-custody-verification.json').read_text())
    if custody.get('status')!='verified':raise ValueError('Recovery key custody not verified')
    key=decode_key((Path.home()/'.codex/local-credentials/personal-agent-recovery-v1.key').read_bytes())
    base=Path.home()/'PersonalAgentBackups'
    stage=private_directory(base);payload=stage/'payload';payload.mkdir()
    entries=[]
    def copy(source,target):
        if source.is_symlink() or (hasattr(source,'is_junction') and source.is_junction()):raise ValueError('Link refused')
        dest=payload/target;dest.parent.mkdir(parents=True,exist_ok=True)
        data=source.read_bytes();dest.write_bytes(data);entries.append((source,hashlib.sha256(data).hexdigest()))
    root=runtime/'home/companion'
    # Workspace has personal memories and attachment bytes. Exclude repository metadata.
    for p in (root/'workspace').rglob('*'):
        if '.git' in p.parts:continue
        if p.is_symlink() or (hasattr(p,'is_junction') and p.is_junction()):raise ValueError('Workspace link refused')
        if p.is_file():copy(p,Path('workspace')/p.relative_to(root/'workspace'))
    for p in selected_data(root/'data'):copy(p,Path('data')/p.relative_to(root/'data'))
    # New isolated chats hold their own history, image bytes and notes outside legacy data/.
    scoped=root/'scoped-chat'
    if scoped.is_symlink() or (hasattr(scoped,'is_junction') and scoped.is_junction()):raise ValueError('Scoped store link refused')
    def scoped_files():
        for branch in scoped.iterdir():
            if branch.name=='workshop-runs':continue  # disposable untrusted scratch; verified artifacts/checkpoints live in SQLite
            if branch.is_symlink() or (hasattr(branch,'is_junction') and branch.is_junction()):raise ValueError('Scoped content link refused')
            yield branch
            if branch.is_dir():yield from branch.rglob('*')
    for p in scoped_files():
        if p.is_symlink() or (hasattr(p,'is_junction') and p.is_junction()):raise ValueError('Scoped content link refused')
        if p.is_file():copy(p,Path('scoped-chat')/p.relative_to(scoped))
    selector=runtime/'core-entry.json'
    if selector.exists():copy(selector,Path('launch/core-entry.json'))
    for p in root.glob('guardian-*.sqlite3'):copy(p,Path(p.name))
    # A SQLite database that has not checkpointed must not be copied without its WAL.
    for p in root.rglob('*-wal'):
        if p.stat().st_size:raise ValueError('Nonempty WAL; require SQLite backup/checkpoint before snapshot')
    for p in (PROJECT/'companion').glob('*'):
        if p.is_file() and p.suffix in {'.mjs','.ts','.py','.ps1','.md','.json','.patch'}:copy(p,Path('implementation')/p.name)
    for name in ('AppContainerRunner.cs','AppContainerRunner.exe','appcontainer-verified.json','closed-planner-verified.json'):
        p=PROJECT/'companion/dsh'/name
        if p.exists():copy(p,Path('implementation/dsh')/name)
    for p in (PROJECT/'companion/identity').glob('*.md'):copy(p,Path('implementation/identity')/p.name)
    # Workroom data is inside scoped-chat; include the matching local viewer implementation.
    for p in (PROJECT/'companion/home').glob('*'):
        if p.is_file() and p.suffix in {'.py','.html','.js','.cjs','.css','.md','.ps1','.json'}:copy(p,Path('implementation/home')/p.name)
    (payload/'RESTORE-README.txt').write_text('Decrypt with the personal-agent recovery key, then use companion/archive.py restore into a NEW directory. Restore workspace and data only after validating a compatible runtime. Credentials are intentionally absent: reconfigure the model API and re-login QQ on the new computer. Do not start a second instance of the same QQ account. This archive is a local verified copy; cloud upload is separate.\n',encoding='utf-8')
    if any(sha(p)!=h for p,h in entries):raise ValueError('Source changed during snapshot')
    plain=stage/'snapshot.zip';created=create(payload,plain)
    target=base/('whale-portable-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.zip.pavlt')
    transform(plain,target,key)
    recovered=stage/'recovered.zip';transform(target,recovered,key,decrypt=True)
    if sha(recovered)!=sha(plain):raise ValueError('Envelope roundtrip mismatch')
    restored=stage/'restore-test';result=restore(recovered,restored)
    for p in payload.rglob('*'):
        if p.is_file() and sha(p)!=sha(restored/p.relative_to(payload)):raise ValueError('Restored bytes mismatch')
    report={'status':'local-portable-restore-verified','at':datetime.now(timezone.utc).isoformat(),'archive':str(target),'ciphertext_sha256':sha(target),'plaintext_sha256':created['sha256'],'files':created['files'],'restore':result,'credentials_included':False,'cloud_copy_verified':False,'runtime_included':'integration sources only; pinned vendor runtime not bundled','scope':'workspace, selected session/event data including runs events, QQ history pages, media, budget DB and integration sources'}
    (PROJECT/'hub/research/fish-20261023/portable-snapshot-latest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    # Delete only this freshly created, verified private staging directory.
    resolved=stage.resolve()
    if resolved.parent!=base.resolve() or not resolved.name.startswith('.vault-partial-'):raise ValueError('Unexpected staging path')
    shutil.rmtree(resolved)
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()

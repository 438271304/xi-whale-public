import sys,sqlite3,json,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'home'))
from conversation_status import cognition_status
with tempfile.TemporaryDirectory() as folder:
    root=Path(folder)
    db=sqlite3.connect(root/'experience.sqlite3')
    for table in ['experiences','attachments','self_state']:db.execute('CREATE TABLE '+table+'(private_text TEXT)');db.execute('INSERT INTO '+table+' VALUES(?)',('PRIVATE_CANARY',))
    db.commit();db.close()
    db=sqlite3.connect(root/'turns.sqlite3');db.execute('CREATE TABLE task_runs(state TEXT)');db.execute("INSERT INTO task_runs VALUES('working')");db.commit();db.close()
    db=sqlite3.connect(root/'life.sqlite3');db.execute('CREATE TABLE activities(state TEXT,updated INTEGER)');db.execute("INSERT INTO activities VALUES('completed',1)");db.commit();db.close()
    db=sqlite3.connect(root/'qzone.sqlite3');db.execute('CREATE TABLE qzone_meta(key TEXT,value TEXT)');db.execute('CREATE TABLE qzone_drafts(state TEXT,content TEXT)');db.execute("INSERT INTO qzone_meta VALUES('publication',?)",(json.dumps({'state':'verified','observed_at':123,'tid':'PRIVATE_TID','content':'PRIVATE_CANARY'}),));db.execute("INSERT INTO qzone_drafts VALUES('draft','PRIVATE_CANARY')");db.commit();db.close()
    result=cognition_status(root);assert result['memory']['messages']==1 and result['tasks']['working']==1
    assert 'PRIVATE_CANARY' not in json.dumps(result) and 'PRIVATE_TID' not in json.dumps(result)
    assert result['qzone']['real_publication_verified'] is True and result['qzone']['draft_states']['draft']==1
print('PASS home aggregate memory/tasks/activity status; no private text or IDs exported')

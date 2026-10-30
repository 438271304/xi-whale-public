"""Synthetic preview/HTTP isolation tests. No external requests or QQ traffic."""
import hashlib, http.client, json, sqlite3, sys, tempfile, threading
from html.parser import HTMLParser
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'home'))
import workroom_view as view
import server
from http.server import ThreadingHTTPServer

class Elements(HTMLParser):
    def __init__(self):super().__init__(convert_charrefs=True);self.elements=[]
    def handle_starttag(self,tag,attrs):self.elements.append((tag,dict(attrs)))

attacks='''<!doctype html><base href="http://127.0.0.1:17789/"><meta http-equiv="refresh" content="0;url=https://example.invalid/exfil">
<h1 onclick="fetch('/api/run/resume')">SAFE_STATIC_HEADING</h1>
<script>fetch('http://127.0.0.1:17789/api/status');parent.document.body.textContent='BAD';location='https://example.invalid/leak'</script>
<iframe srcdoc="<script>top.location='https://example.invalid'</script>"></iframe>
<form method="POST" action="http://127.0.0.1:17789/api/run/shutdown"><input name="secret"></form>
<a href="https://example.invalid/?data=private" target="_top">不可导航</a><img src="http://127.0.0.1:17789/api/status" onerror="alert(1)">
<svg viewBox="0 0 100 100"><foreignObject><iframe src="http://127.0.0.1:17789/"></iframe></foreignObject><use href="https://example.invalid/a.svg#x"/><rect width="50" height="40" fill="#237c83"/><animate attributeName="href" to="https://example.invalid"/></svg>
<style>@import 'https://example.invalid/x.css';body{background:url(https://example.invalid/track)}</style>
<p style="background:image-set('https://example.invalid' 1x)">静态文本</p>'''
rendered=view.preview_document('合成预览',1,'development-acceptance',{'index.html':attacks,'style.css':'body{color:#193d45}'}).decode()
outer=Elements();outer.feed(rendered);iframe=next(attrs for tag,attrs in outer.elements if tag=='iframe')
assert iframe['sandbox']=='' and iframe['referrerpolicy']=='no-referrer'
assert 'allow-scripts' not in rendered and 'allow-same-origin' not in rendered
inside=Elements();inside.feed(iframe['srcdoc']);tags={tag for tag,_ in inside.elements}
assert not tags.intersection({'script','iframe','object','embed','form','a','img','use','foreignobject','animate','base','input'})
for tag,attrs in inside.elements:
    assert not any(k.startswith('on') or k in {'href','src','srcdoc','action','formaction'} for k in attrs)
    if tag=='meta':assert attrs.get('http-equiv')=='Content-Security-Policy' or attrs.get('charset')=='utf-8'
assert 'example.invalid' not in iframe['srcdoc'] and 'SAFE_STATIC_HEADING' in iframe['srcdoc']
inner_policy=next(attrs['content'] for tag,attrs in inside.elements if tag=='meta' and attrs.get('http-equiv')=='Content-Security-Policy')
assert "script-src 'none'" in inner_policy and "connect-src 'none'" in inner_policy
assert not view.safe_css(r'body{background:u\72l(https://example.invalid)}')
assert view.safe_css('rect{fill:url(#gradient)}')

with tempfile.TemporaryDirectory(prefix='whale-preview-') as temp:
    path=Path(temp)/'workroom.sqlite3';db=sqlite3.connect(path)
    db.executescript('CREATE TABLE wr_projects(id TEXT PRIMARY KEY,deleted INTEGER,title TEXT,head INTEGER,origin TEXT,updated TEXT);CREATE TABLE wr_hidden(project TEXT PRIMARY KEY,at TEXT);CREATE TABLE wr_versions(project TEXT,version INTEGER,files TEXT,digest TEXT);CREATE TABLE wr_releases(project TEXT,title TEXT,version INTEGER,origin TEXT,at TEXT);')
    published='11111111-1111-4111-8111-111111111111';private='22222222-2222-4222-8222-222222222222'
    for project,version,files in [(published,1,{'index.html':attacks}),(published,2,{'index.html':'PRIVATE_NEW_DRAFT'}),(private,1,{'index.html':'PRIVATE_CHAT_CANARY'})]:
        serialized=json.dumps(files,separators=(',',':'));db.execute('INSERT INTO wr_versions VALUES(?,?,?,?)',(project,version,serialized,hashlib.sha256(serialized.encode()).hexdigest()))
    db.executemany('INSERT INTO wr_projects VALUES(?,0,?,?,?,?)',[(published,'开发验收',2,'development-acceptance','2026-10-25T00:00:00Z'),(private,'半成品',1,'chat','2026-10-25T00:00:00Z')])
    db.execute('INSERT INTO wr_releases VALUES(?,?,?,?,?)',(published,'开发验收',1,'development-acceptance','2026-10-25T00:00:00Z'));db.commit();db.close()
    assert len(view.public_projects(path))==2
    page=view.public_preview(path,published);assert b'PRIVATE_NEW_DRAFT' in page and b'PRIVATE_CHAT_CANARY' not in page
    assert b'PRIVATE_NEW_DRAFT' not in view.public_preview(path,published,version=1)
    assert b'PRIVATE_CHAT_CANARY' in view.public_preview(path,private)
    db=sqlite3.connect(path);db.execute('INSERT INTO wr_hidden VALUES(?,?)',(private,'now'));db.commit();db.close()
    assert len(view.public_projects(path))==1
    job='33333333-3333-4333-8333-333333333333';workshop=path.with_name('workshop.sqlite3');draft_db=sqlite3.connect(workshop);draft_db.execute('CREATE TABLE workshop_jobs(id TEXT,project TEXT,base_version INTEGER,state TEXT,result TEXT,updated INTEGER)');draft_db.execute('INSERT INTO workshop_jobs VALUES(?,?,1,?,?,123)',(job,published,'running',json.dumps({'draft_artifacts':{'index.html':'<h1>PARTIAL_ARTIFACT_DISTINCT_FROM_HEAD</h1>'}})));draft_db.commit();draft_db.close()
    cards=view.public_projects(path);assert len(cards)==2 and cards[1]['snapshot_kind']=='draft' and cards[1]['version']==1
    assert b'PARTIAL_ARTIFACT_DISTINCT_FROM_HEAD' in view.public_preview(path,published,draft=job)
    assert b'PRIVATE_NEW_DRAFT' in view.public_preview(path,published)
    try:view.public_preview(path,private);raise AssertionError('Explicitly hidden preview exposed')
    except LookupError:pass
    server.WORKROOM=path;server.INTERACTIVE_READY=False;httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler);thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
    def request(route,method='GET',host=None):
        if host is None:host='127.0.0.1:'+str(httpd.server_port)
        connection=http.client.HTTPConnection('127.0.0.1',httpd.server_port,timeout=3);connection.request(method,route,headers={'Host':host});response=connection.getresponse();result=response.status,dict(response.getheaders()),response.read();connection.close();return result
    status,headers,body=request('/api/workroom?scope=private');assert status==200 and private.encode() not in body
    status,headers,body=request('/workroom/'+published);assert status==200 and "script-src 'none'" in headers['Content-Security-Policy'] and "connect-src 'none'" in headers['Content-Security-Policy']
    assert headers['Referrer-Policy']=='no-referrer' and 'Access-Control-Allow-Origin' not in headers
    for route in ['/workroom/'+private,'/workroom/../runtime.json','/workroom/'+published+'/main.js','/api/run/resume']:
        assert request(route)[0]==404
    assert request('/api/workroom',host='attacker.invalid')[0]==403
    assert request('/api/workroom',method='POST')[0]==501
    httpd.shutdown();httpd.server_close();thread.join(timeout=2)
print('PASS static opaque iframe, active/navigation/resource removal, CSP network/script denial, head/version/hidden HTTP without review gate, no raw files/write API, hostile Host refusal; local synthetic only')

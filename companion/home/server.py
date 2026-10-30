from urllib.parse import urlsplit,parse_qs
"""Read-only, loopback-only home for Xi. No chat/credential/file browsing API."""
import json, sqlite3, urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from conversation_status import conversation_status,cognition_status
from qq_health import qq_connection
from workroom_view import public_projects,public_preview,PREVIEW_CSP
from interactive_workroom import public_interactive_preview,public_interactive_child,response_headers as interactive_headers
from life_view import life_view
from inner_life_view import inner_life_view

HERE = Path(__file__).resolve().parent
INTERACTIVE_READY = (HERE / 'interactive-release.json').is_file()
PROJECT = HERE.parent.parent
ROOT = Path('C:/Users/USER/PersonalAgentRuntime/whale-v1')
WORK = ROOT / 'home/companion/workspace'
BACKUPS = Path('C:/Users/USER/PersonalAgentBackups')
WORKROOM = ROOT / 'home/companion/scoped-chat/workroom.sqlite3'
LIFE = ROOT / 'home/companion/scoped-chat/life.sqlite3'
CHANNELS = Path('C:/Users/USER/PersonalAgentBackups/companion-runtime/clean-lab-0.2.8/resources/app/guardian/channels.json')
TZ = timezone(timedelta(hours=8))

def stamp(path):
    return datetime.fromtimestamp(path.stat().st_mtime, TZ).isoformat() if path.exists() else None

def snapshot():
    now = datetime.now(TZ)
    result = dict(at=now.isoformat(), name='汐', runtime={'online':False}, card={}, budget=None,
                  stickers=[], collection_count=0, backups=[], issues=[])
    try:
        with urllib.request.urlopen('http://127.0.0.1:17789/api/status', timeout=2) as r:
            core_status=json.load(r)
            loop = core_status['loop']
        result['runtime'] = dict(online=True, paused=loop.get('paused'), phase=loop.get('phase',{}).get('state'))
        result['runtime']['qq_route_ready']=core_status.get('qq_route',{}).get('ready')
        with urllib.request.urlopen('http://127.0.0.1:17789/api/worlds', timeout=2) as r:
            worlds=json.load(r).get('worlds',[])
        result['runtime'].update(qq_connection(worlds))
        if not result['runtime']['qq_connected']:result['issues'].append('核心正在运行，但QQ协议连接未就绪，暂时无法接收和回复QQ消息')
        elif result['runtime']['qq_route_ready'] is False:result['issues'].append('QQ协议已连接，但聊天服务未就绪，暂时无法处理QQ消息')
    except Exception:
        result['issues'].append('暂时读不到汐的运行状态')
    try:
        result['conversations']=conversation_status(ROOT/'home/companion/scoped-chat/turns.sqlite3',int(now.timestamp()*1000))
    except Exception:
        result['conversations']={'available':False,'reason':'unreadable'}
        result['issues'].append('新聊天记录状态暂不可读，不以零条代替')
    try:result['cognition']=cognition_status(ROOT/'home/companion/scoped-chat')
    except Exception:result['cognition']={'available':False}
    card = WORK / 'projects/home/card.json'
    try:
        if card.stat().st_size > 16384: raise ValueError()
        raw = json.loads(card.read_text(encoding='utf-8-sig'))
        for k in ['mood','energy','today','wish']:
            if isinstance(raw.get(k),str): result['card'][k] = raw[k][:400]
        for k in ['interests','learned']:
            if isinstance(raw.get(k),list): result['card'][k] = [s[:200] for s in raw[k][:8] if isinstance(s,str)]
        result['card_updated'] = stamp(card)
    except FileNotFoundError: pass
    except Exception: result['issues'].append('展示卡格式需要整理；旧内容未覆盖')
    try:
        dbpath = ROOT / 'home/companion/guardian-budget.sqlite3'
        db = sqlite3.connect(dbpath.as_uri()+'?mode=ro',uri=True,timeout=1)
        settled,calls=db.execute("SELECT COALESCE(SUM(actual),0),count(*) FROM calls WHERE day=? AND state='settled'",(now.date().isoformat(),)).fetchone()
        pending,count=db.execute("SELECT COALESCE(SUM(reserved),0),count(*) FROM calls WHERE state='pending'").fetchone()
        db.close()
        cap=None # This dedicated Whale runtime explicitly has no local monetary cap.
        result['budget']=dict(settled=settled/1e6,pending=pending/1e6,pending_count=count,calls=calls,cap=cap)
    except Exception: result['issues'].append('费用记录暂不可读，不以零元代替')
    seed = WORK/'blobs/stickers/seed'
    result['stickers'] = [p.name for p in sorted(seed.glob('*.png')) if not p.is_symlink()]
    result['collection_count'] = sum(1 for p in (WORK/'blobs').rglob('*') if p.is_file() and p.suffix.lower() in ['.png','.jpg','.jpeg','.webp','.gif'])
    files=list(BACKUPS.glob('whale*.dpapi'))+list(BACKUPS.glob('whale-portable-*.zip.pavlt'))
    for p in sorted(files,key=lambda p:p.stat().st_mtime,reverse=True)[:3]:
        result['backups'].append(dict(name=p.name,at=stamp(p),portable=p.suffix=='.pavlt'))
    return result

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get('Host') not in [f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}']:
            self.send_error(403);return
        path=self.path.split('?',1)[0]
        preview=False;custom_headers=None
        if path=='/api/workroom':
            try:data=json.dumps(dict(projects=public_projects(WORKROOM),mode='safe-sandbox-preview',work_in_progress_visible=True,review_required=False),ensure_ascii=False).encode();mime='application/json; charset=utf-8'
            except Exception:self.send_error(503,'Workroom temporarily unavailable');return
        elif any(path.startswith(prefix) for prefix in ['/workroom/','/workroom-static/','/workroom-frame/']):
            try:
                query=parse_qs(urlsplit(self.path).query);version=int(query['version'][0]) if 'version' in query else None;draft=query.get('draft',[None])[0]
                if version is not None and draft:raise LookupError('Choose one snapshot')
                if path.startswith('/workroom-static/'):
                    data=public_preview(WORKROOM,path[len('/workroom-static/'):],version,draft);preview=True
                elif path.startswith('/workroom-frame/'):
                    if not INTERACTIVE_READY:raise LookupError('Interactive preview not released')
                    data=public_interactive_child(WORKROOM,path[len('/workroom-frame/'):],version,draft,query.get('snapshot',[None])[0]);custom_headers=interactive_headers(child=True)
                else:
                    if INTERACTIVE_READY:
                        data=public_interactive_preview(WORKROOM,path[len('/workroom/'):],version,draft);custom_headers=interactive_headers()
                    else:data=public_preview(WORKROOM,path[len('/workroom/'):],version,draft);preview=True
                mime='text/html; charset=utf-8'
            except (LookupError,FileNotFoundError):self.send_error(404);return
            except Exception:self.send_error(503,'Preview temporarily unavailable');return
        elif path=='/api/life':
            data=json.dumps(life_view(LIFE),ensure_ascii=False).encode();mime='application/json; charset=utf-8'
        elif path=='/api/inner-life':
            try: policy=json.loads(CHANNELS.read_text(encoding='utf-8-sig'))
            except Exception: policy={}
            current=inner_life_view(LIFE.parent/'experience.sqlite3',LIFE.parent/'social.sqlite3',LIFE,policy,int(datetime.now(TZ).timestamp()*1000))
            data=json.dumps(current,ensure_ascii=False).encode();mime='application/json; charset=utf-8'
        elif path=='/api/home':
            data=json.dumps(snapshot(),ensure_ascii=False).encode();mime='application/json; charset=utf-8'
        elif path in ['/', '/index.html','/app.js','/style.css']:
            name='index.html' if path=='/' else path[1:]
            data=(HERE/name).read_bytes();mime={'html':'text/html; charset=utf-8','js':'text/javascript; charset=utf-8','css':'text/css; charset=utf-8'}[name.split('.')[-1]]
        elif path.startswith('/stickers/'):
            name=path[len('/stickers/'):]
            p=WORK/'blobs/stickers/seed'/name
            if '/' in name or '\\' in name or '%' in name or p.suffix!='.png' or p.is_symlink() or not p.is_file():
                self.send_error(404);return
            data=p.read_bytes();mime='image/png'
        else: self.send_error(404);return
        self.send_response(200);self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        if custom_headers is None:self.send_header('X-Frame-Options','DENY')
        self.send_header('Permissions-Policy','camera=(), microphone=(), geolocation=(), usb=(), payment=()')
        if custom_headers is None:self.send_header('Content-Security-Policy',PREVIEW_CSP if preview else "default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        else:
            for key in ['Content-Security-Policy','X-Frame-Options']:
                if key in custom_headers:self.send_header(key,custom_headers[key])
        self.end_headers();self.wfile.write(data)
    def log_message(self,*args): pass

if __name__=='__main__':
    print('汐的小窝 http://127.0.0.1:17790',flush=True)
    ThreadingHTTPServer(('127.0.0.1',17790),Handler).serve_forever()

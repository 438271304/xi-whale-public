"""Pure rendering adapter for saved interactive projects; no HTTP server or runner.

Server integration (the existing static renderer/routes remain unchanged):
  shell = public_interactive_preview(db_path, project, version=None, draft=None)
  child = public_interactive_child(db_path, project, version=int_or_none,
                                   draft=job_id_or_none, snapshot=query_hash)
Serve each bytes result with response_headers(child=False/True), respectively.
The shell targets CHILD_ROUTE and links STATIC_ROUTE for its static fallback.
Child headers MUST replace the server's default CSP/X-Frame-Options: DENY.

Scripts have an opaque sandbox origin and cannot read the parent, its storage or
host files. This is browser execution, NOT Node/DSH or proof of a workshop run.
No guarantee of zero network: arbitrary project JS can navigate its own frame.
The sandbox does not grant top navigation, popups, downloads, forms or same-origin
access. Real browser validation belongs to the integrating server.
"""
import base64
import hashlib
import html
import json
import os
import re
import subprocess
import threading
from collections import OrderedDict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode

from workroom_view import ATTRS, CASE, TAGS, released_files, safe_css

CHILD_ROUTE = '/workroom-frame/'
STATIC_ROUTE = '/workroom-static/'
_NODE = Path('C:/Program Files/nodejs/node.exe')
_BUNDLER = Path(__file__).resolve().with_name('bundle_workroom.cjs')
_BUNDLE_LOCK = threading.Lock()
_BUNDLE_CACHE = OrderedDict()
SHELL_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; img-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
# sandbox is an HTTP directive: the meta policy below is defense in depth only.
CHILD_CONTENT_CSP = "default-src 'none'; script-src data:; script-src-attr 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
CHILD_CSP = CHILD_CONTENT_CSP + "; sandbox allow-scripts; frame-ancestors 'self'"


def response_headers(child=False):
    headers = {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': CHILD_CSP if child else SHELL_CSP,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), payment=()',
    }
    if not child:
        headers['X-Frame-Options'] = 'DENY'
    # Child uses frame-ancestors 'self'. In particular, do not inherit DENY.
    return headers


def _selection(path, project, version, draft):
    if version is not None and (type(version) is not int or version < 1):
        raise LookupError('Choose an existing positive version')
    if version is not None and draft is not None:
        raise LookupError('Choose one snapshot')
    # This enforces the existing shown/hidden/deleted, version hash, and exact
    # project-to-draft binding. Never read project files from the filesystem.
    return released_files(path, project, version=version, draft=draft)


def _digest(files):
    serialized = json.dumps(files, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(serialized.encode('utf-8')).hexdigest()


def _script_path(source, files):
    if not isinstance(source, str) or not source or len(source) > 256:
        return None
    if source.startswith('./'):
        source = source[2:]
    # Deliberately no URL decoding, absolute paths, query strings, fragments,
    # backslashes, traversal, CDN aliases, or filesystem access.
    parts = source.split('/')
    if len(parts) > 4 or not all(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', part) for part in parts):
        return None
    if not source.endswith(('.js', '.mjs')):
        return None
    return source if source in files else None


def _bundle_modules(files, entries):
    payload = json.dumps({'files': files, 'entries': entries}, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(payload) > 600000:
        return {'outputs': [], 'error': '冻结作品过大，模块打包输入超过限制。'}
    key = hashlib.sha256(payload).hexdigest()
    if not _BUNDLE_LOCK.acquire(timeout=5):
        return {'outputs': [], 'error': '模块打包正忙，请稍后重新打开。'}
    try:
        if key in _BUNDLE_CACHE:
            _BUNDLE_CACHE.move_to_end(key)
            return _BUNDLE_CACHE[key]
        try:
            environment = {name: os.environ[name] for name in ('SystemRoot', 'WINDIR', 'TEMP', 'TMP') if name in os.environ}
            result = subprocess.run([str(_NODE), str(_BUNDLER)], input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    cwd=str(_BUNDLER.parent), timeout=5, shell=False, env=environment,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if len(result.stdout) > 2000000 or len(result.stderr) > 64000:
                raise ValueError('模块打包输出超过限制。')
            value = json.loads(result.stdout.decode('utf-8'))
            if not isinstance(value, dict) or not isinstance(value.get('outputs'), list):
                raise ValueError('模块打包器未返回有效结果。')
            if len(value['outputs']) != len(entries) and not value.get('error'):
                raise ValueError('模块打包结果数量不匹配。')
        except subprocess.TimeoutExpired:
            value = {'outputs': [], 'error': '模块打包超过五秒，已停止。'}
        except (OSError, ValueError, UnicodeError):
            value = {'outputs': [], 'error': '本地模块打包失败或暂不可用。'}
        _BUNDLE_CACHE[key] = value
        while len(_BUNDLE_CACHE) > 16:
            _BUNDLE_CACHE.popitem(last=False)
        return value
    finally:
        _BUNDLE_LOCK.release()


_TAGS = TAGS | {'canvas', 'input', 'select', 'option', 'output', 'progress', 'meter', 'details', 'summary'}
_ATTRS = ATTRS | {'value', 'min', 'max', 'step', 'checked', 'selected', 'multiple', 'size', 'maxlength', 'placeholder', 'tabindex', 'open', 'for'}
_BLOCKS = {'iframe', 'object', 'template', 'math', 'foreignobject', 'form', 'textarea', 'title', 'audio', 'video', 'noscript'}
_VOID = {'br', 'hr', 'input'}
_INPUT_TYPES = {'button', 'checkbox', 'color', 'date', 'number', 'radio', 'range', 'reset', 'search', 'text', 'time'}
_JS_TYPES = {'', 'text/javascript', 'application/javascript', 'module'}


class InteractiveMarkup(HTMLParser):
    """Keep a small DOM, collecting scripts separately after that DOM is built.

    Script contents remain arbitrary project code. Sanitizing markup is not a
    JavaScript sandbox; the separate child HTTP policy and iframe are essential.
    """
    def __init__(self, files):
        super().__init__(convert_charrefs=True)
        self.files = files
        self.out, self.styles, self.scripts, self.skip, self.errors = [], [], [], [], []
        self.script = None
        self.style = None
        self.nodes = 0

    def handle_starttag(self, tag, attrs):
        self.nodes += 1
        if self.nodes > 4000:
            raise ValueError('Markup complexity limit')
        values = dict(attrs)
        if self.skip:
            if tag in _BLOCKS or tag == 'script':
                self.skip.append(tag)
            return
        if tag in _BLOCKS:
            self.skip.append(tag)
            return
        if tag == 'script':
            kind = (values.get('type') or '').strip().lower()
            self.script = {'type': kind, 'src': values.get('src'), 'has_src': 'src' in values, 'text': []}
            return
        if tag == 'style':
            self.style = []
            return
        if tag not in _TAGS:
            return
        if tag == 'input' and (values.get('type') or 'text').lower() not in _INPUT_TYPES:
            return
        clean = []
        for key, value in attrs:
            if value is None:
                if key in {'checked', 'selected', 'multiple', 'open'}:
                    clean.append(key)
                continue
            if len(value) > 4096:
                continue
            if key == 'style':
                css = safe_css(value)
                if css:
                    clean.append('style="' + html.escape(css, quote=True) + '"')
            elif key == 'type':
                # Emit one normalized type below: duplicate source attributes
                # must not turn a validated text input into a file picker.
                continue
            elif key in _ATTRS or re.fullmatch(r'(?:data|aria)-[a-z0-9_.:-]+', key):
                if re.search(r'url\s*\(', value, re.I) and not re.fullmatch(r'url\(\s*#[a-zA-Z][\w-]*\s*\)', value, re.I):
                    continue
                if '\\' in value or re.search(r'javascript:|https?:|data:', value, re.I):
                    continue
                clean.append(CASE.get(key, key) + '="' + html.escape(value, quote=True) + '"')
        if tag == 'button':
            clean.append('type="button"')
        elif tag == 'input':
            clean.append('type="' + html.escape((values.get('type') or 'text').lower(), quote=True) + '"')
        self.out.append('<' + CASE.get(tag, tag) + (' ' + ' '.join(clean) if clean else '') + '>')

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.skip:
            if tag == self.skip[-1]:
                self.skip.pop()
            return
        if tag == 'script':
            if self.script:
                script = self.script
                if script['type'] in _JS_TYPES:
                    path = _script_path(script['src'], self.files) if script['has_src'] else None
                    source = self.files[path] if path is not None else None if script['has_src'] else ''.join(script['text'])
                    if isinstance(source, str) and source.strip():
                        self.scripts.append((source, script['type'] == 'module', path))
                    elif script['type'] == 'module' and script['has_src']:
                        self.errors.append('模块脚本不可用：只支持快照中的相对 .js/.mjs 文件。')
                self.script = None
            return
        if tag == 'style':
            if self.style is not None:
                css = safe_css(''.join(self.style))
                if css:
                    self.styles.append(css)
                self.style = None
            return
        if tag in _TAGS and tag not in _VOID:
            self.out.append('</' + CASE.get(tag, tag) + '>')

    def handle_data(self, data):
        if self.skip:
            return
        if self.script is not None:
            self.script['text'].append(data)
        elif self.style is not None:
            self.style.append(data)
        else:
            self.out.append(html.escape(data))


def _child_document(title, files):
    markup = InteractiveMarkup(files)
    markup.feed(files.get('index.html', files.get('index.svg', '<p>缺少预览入口</p>')))
    markup.close()
    css = '\n'.join(filter(None, [safe_css(value) for name, value in sorted(files.items()) if name.endswith('.css')] + markup.styles))
    scripts, errors = [], list(markup.errors)
    entries = [{'path': path} if path is not None else {'contents': source} for source, module, path in markup.scripts if module]
    bundled = _bundle_modules(files, entries) if entries else {'outputs': []}
    if bundled.get('error'):
        errors.append(bundled['error'])
    module_index = 0
    for source, module, _ in markup.scripts:
        if module:
            output = bundled['outputs'][module_index] if module_index < len(bundled['outputs']) else None
            module_index += 1
            if not output or not output.get('ok'):
                errors.append(output.get('error', '模块打包未完成。') if output else '模块打包未完成。')
                continue
            source = output['code']
        # Base64 keeps any </script>, quotes and Unicode out of HTML parsing.
        encoded = base64.b64encode(source.encode('utf-8')).decode('ascii')
        scripts.append('<script src="data:text/javascript;charset=utf-8;base64,' + encoded + '"></script>')
    failure = ('<section role="alert" class="workroom-bundle-error"><strong>这份作品的模块暂时没能运行</strong><pre>' +
               html.escape('\n'.join(str(error)[:800] for error in errors[:8])) + '</pre></section>') if errors else ''
    return ('<!doctype html><html><head><meta charset="utf-8"><title>' + html.escape(title) + '</title>'
            '<meta http-equiv="Content-Security-Policy" content="' + html.escape(CHILD_CONTENT_CSP, quote=True) + '">'
            '<style>' + css + '</style></head><body>' + failure + ''.join(markup.out) + ''.join(scripts) + '</body></html>').encode('utf-8')


def public_interactive_preview(path, project, version=None, draft=None):
    title, selected, origin, files = _selection(path, project, version, draft)
    selection = {'draft': draft} if draft is not None else {'version': selected}
    query = urlencode({**selection, 'snapshot': _digest(files)})
    child = CHILD_ROUTE + project + '?' + query
    fallback = STATIC_ROUTE + project + '?' + urlencode(selection)
    label = '开发验收合成作品 · 非汐自创' if origin == 'development-acceptance' else '可直接展示的作品／半成品'
    return ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>' + html.escape(title) + ' · 汐的工作间</title><style>body{margin:0;background:#f5f8f5;color:#193d45;font:16px/1.6 system-ui,sans-serif}header{padding:20px 5vw}iframe{display:block;width:90vw;height:72vh;margin:20px auto;border:1px solid #dce8e5;border-radius:16px;background:white}</style></head>'
            '<body><header><a href="/">回到小窝</a><h1>' + html.escape(title) + '</h1><p>' + html.escape(label) + ' · 版本 ' + html.escape(str(selected)) + '</p>'
            '<p>可以点点玩玩的独立预览。这里运行的是浏览器里的作品，不代表运行过宿主程序。</p>'
            '<a href="' + html.escape(fallback, quote=True) + '">查看静态版本</a></header>'
            '<iframe title="作品交互隔离预览" sandbox="allow-scripts" referrerpolicy="no-referrer" src="' + html.escape(child, quote=True) + '"></iframe></body></html>').encode('utf-8')


def public_interactive_child(path, project, version=None, draft=None, snapshot=None):
    if version is None and draft is None:
        raise LookupError('Choose the frozen snapshot from the preview shell')
    if not isinstance(snapshot, str) or not re.fullmatch(r'[a-f0-9]{64}', snapshot):
        raise LookupError('A snapshot binding is required')
    title, _, _, files = _selection(path, project, version, draft)
    if _digest(files) != snapshot:
        raise LookupError('Snapshot changed; reopen the preview')
    return _child_document(title, files)

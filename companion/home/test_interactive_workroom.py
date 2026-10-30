"""Pure fixture rendering tests: no HTTP, browsers or project code execution."""
import base64
import hashlib
import json
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

import interactive_workroom as view

PROJECT = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
JOB = '33333333-3333-4333-8333-333333333333'


@contextmanager
def database(path):
    db = sqlite3.connect(path)
    try:
        with db:
            yield db
    finally:
        db.close()


class Elements(HTMLParser):
    def __init__(self, value):
        super().__init__(convert_charrefs=True)
        self.elements = []
        self.feed(value.decode() if isinstance(value, bytes) else value)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


class InteractiveTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='whale-interactive-', dir=Path(__file__).resolve().parent)
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'workroom.sqlite3'
        with database(self.path) as db:
            db.executescript('CREATE TABLE wr_projects(id TEXT PRIMARY KEY,deleted INTEGER,title TEXT,head INTEGER,origin TEXT,updated TEXT); CREATE TABLE wr_hidden(project TEXT PRIMARY KEY,at TEXT); CREATE TABLE wr_versions(project TEXT,version INTEGER,files TEXT,digest TEXT,PRIMARY KEY(project,version));')
            db.executemany('INSERT INTO wr_projects VALUES(?,0,?,1,?,?)', [(PROJECT, '<script>title attack</script> "汐"', 'chat', 'now'), (OTHER, 'Other', 'chat', 'now')])
        self.save(PROJECT, 1, {'index.html': '<button id="play" class="toy" data-action="go">开始</button><span id="score">0</span><script>document.getElementById("play").addEventListener("click",()=>document.getElementById("score").textContent="一分");</script><script src="./scripts/game.js"></script>', 'scripts/game.js': 'document.getElementById("play").dataset.ready="是";', 'style.css': '.toy{color:teal}'})
        self.save(OTHER, 1, {'index.html': '<p>OTHER_PROJECT_CANARY</p>'})

    def save(self, project, version, files):
        serialized = json.dumps(files, ensure_ascii=False)
        with database(self.path) as db:
            db.execute('INSERT OR REPLACE INTO wr_versions VALUES(?,?,?,?)', (project, version, serialized, hashlib.sha256(serialized.encode()).hexdigest()))

    def child_args(self, shell):
        iframe = next(attrs for tag, attrs in Elements(shell).elements if tag == 'iframe')
        query = parse_qs(urlsplit(iframe['src']).query)
        return iframe, {'version': int(query['version'][0]) if 'version' in query else None, 'draft': query.get('draft', [None])[0], 'snapshot': query['snapshot'][0]}

    def child(self, **selection):
        shell = view.public_interactive_preview(self.path, PROJECT, **selection)
        iframe, args = self.child_args(shell)
        return shell, iframe, view.public_interactive_child(self.path, PROJECT, **args)

    def test_self_contained_dom_and_utf8_scripts_keep_order_in_a_separate_child(self):
        shell, iframe, child = self.child()
        self.assertEqual(iframe['sandbox'], 'allow-scripts')
        self.assertNotIn('srcdoc', iframe)
        self.assertNotIn('<script', shell.decode())
        self.assertIn('查看静态版本', shell.decode())
        self.assertIn('/workroom-static/', shell.decode())
        self.assertIn('&lt;script&gt;title attack&lt;/script&gt;', shell.decode())
        elements = Elements(child).elements
        button = next(attrs for tag, attrs in elements if tag == 'button')
        self.assertEqual((button['id'], button['class'], button['data-action']), ('play', 'toy', 'go'))
        self.assertNotIn('disabled', button)
        scripts = [attrs for tag, attrs in elements if tag == 'script']
        sources = [base64.b64decode(attrs['src'].split(',', 1)[1]).decode('utf-8') for attrs in scripts]
        self.assertEqual(len(sources), 2)
        self.assertIn('addEventListener("click"', sources[0])
        self.assertIn('一分', sources[0])
        self.assertEqual(sources[1], 'document.getElementById("play").dataset.ready="是";')
        self.assertEqual(Elements(child).elements[-1][0], 'script')

    def test_hostile_markup_and_script_paths_cannot_become_resource_or_event_attributes(self):
        markup = '''<meta http-equiv="refresh" content="0;url=https://example.invalid"><base href="https://example.invalid"><form action="http://127.0.0.1:17789"><button>FORM_CANARY</button></form><iframe srcdoc="attack">IFRAME_CANARY</iframe><object data="file:///C:/private">OBJECT_CANARY</object><img src="https://example.invalid"><input type="file"><button disabled id="safe" onclick="fetch('http://127.0.0.1:17789')" formaction="https://example.invalid" data-count="1">可玩</button><a href="https://example.invalid" ping="https://example.invalid">link</a><svg onload="bad()"><use href="https://example.invalid/a.svg#x"/><foreignObject><iframe src="file:///C:/private"></iframe></foreignObject><rect width="5" height="5"/></svg><style>body{background:url(https://example.invalid)}</style>'''
        for source in ['https://example.invalid/a.js', '//example.invalid/a.js', '../escape.js', '/absolute.js', 'scripts/../../escape.js', 'scripts/%2e%2e/escape.js', r'scripts\escape.js', 'scripts/game.js?token=x', 'data:text/javascript,bad()', 'file:///C:/escape.js']:
            markup += '<script src="' + source + '">EXTERNAL_FALLBACK_MUST_NOT_RUN</script>'
        markup += '<script src="scripts/game.js"></script><script>document.getElementById("safe").textContent="能点";</script>'
        self.save(PROJECT, 1, {'index.html': markup, 'scripts/game.js': '/*ONLY_LOCAL_SCRIPT*/', '../escape.js': 'PATH_ESCAPE_CANARY'})
        _, _, child = self.child()
        elements = Elements(child).elements
        blocked = {'form', 'iframe', 'object', 'img', 'input', 'base', 'a', 'use', 'foreignobject'}
        self.assertFalse(blocked.intersection(tag for tag, _ in elements))
        self.assertNotIn('CANARY', child.decode())
        for tag, attrs in elements:
            self.assertFalse(any(key.startswith('on') or key in {'href', 'srcdoc', 'action', 'formaction', 'ping'} for key in attrs))
            if 'src' in attrs:
                self.assertEqual(tag, 'script')
                self.assertTrue(attrs['src'].startswith('data:text/javascript;charset=utf-8;base64,'))
        scripts = [base64.b64decode(attrs['src'].split(',', 1)[1]).decode() for tag, attrs in elements if tag == 'script']
        self.assertEqual(scripts, ['/*ONLY_LOCAL_SCRIPT*/', 'document.getElementById("safe").textContent="能点";'])
        self.assertNotIn('example.invalid', child.decode())
        # Validate what the generated browser DOM will see, rather than trusting
        # the final source attribute while emitting an earlier unsafe duplicate.
        self.save(PROJECT, 1, {'index.html': '<input id="plain" type="file" type="text"><input type="password">'})
        inputs = [attrs for tag, attrs in Elements(self.child()[2]).elements if tag == 'input']
        self.assertEqual(inputs, [{'id': 'plain', 'type': 'text'}])

    def test_shell_binds_version_and_digest_and_existing_visibility_rules_still_apply(self):
        shell = view.public_interactive_preview(self.path, PROJECT)
        _, frozen = self.child_args(shell)
        self.save(PROJECT, 2, {'index.html': '<p>NEW_HEAD_CANARY</p>'})
        with database(self.path) as db:
            db.execute('UPDATE wr_projects SET head=2 WHERE id=?', (PROJECT,))
        old = view.public_interactive_child(self.path, PROJECT, **frozen)
        self.assertNotIn(b'NEW_HEAD_CANARY', old)
        self.assertIn(b'NEW_HEAD_CANARY', self.child()[2])
        with self.assertRaises(LookupError):
            view.public_interactive_preview(self.path, PROJECT, version=9)
        with self.assertRaises(LookupError):
            view.public_interactive_child(self.path, OTHER, **frozen)
        with self.assertRaises(LookupError):
            view.public_interactive_child(self.path, PROJECT, snapshot=frozen['snapshot'])
        self.save(PROJECT, 1, {'index.html': '<p>REPLACED_SNAPSHOT_CANARY</p>'})
        with self.assertRaises(LookupError):
            view.public_interactive_child(self.path, PROJECT, **frozen)
        with database(self.path) as db:
            db.execute('INSERT INTO wr_hidden VALUES(?,?)', (PROJECT, 'now'))
        for render in [lambda: view.public_interactive_preview(self.path, PROJECT), lambda: view.public_interactive_child(self.path, PROJECT, **frozen)]:
            with self.assertRaises(LookupError):
                render()
        with database(self.path) as db:
            db.execute('DELETE FROM wr_hidden')
            db.execute('UPDATE wr_projects SET deleted=1 WHERE id=?', (PROJECT,))
        with self.assertRaises(LookupError):
            view.public_interactive_preview(self.path, PROJECT, version=1)

    def test_draft_binding_cannot_read_another_project_or_silently_follow_a_changed_draft(self):
        workshop = self.path.with_name('workshop.sqlite3')
        with database(workshop) as db:
            db.execute('CREATE TABLE workshop_jobs(id TEXT,project TEXT,base_version INTEGER,result TEXT)')
            db.execute('INSERT INTO workshop_jobs VALUES(?,?,1,?)', (JOB, PROJECT, json.dumps({'draft_artifacts': {'index.html': '<p>OWN_DRAFT_CANARY</p>'}})))
        shell = view.public_interactive_preview(self.path, PROJECT, draft=JOB)
        _, args = self.child_args(shell)
        self.assertIn(b'OWN_DRAFT_CANARY', view.public_interactive_child(self.path, PROJECT, **args))
        with self.assertRaises(LookupError):
            view.public_interactive_preview(self.path, OTHER, draft=JOB)
        with self.assertRaises(LookupError):
            view.public_interactive_preview(self.path, PROJECT, version=1, draft=JOB)
        with database(workshop) as db:
            db.execute('UPDATE workshop_jobs SET result=?', (json.dumps({'draft_artifacts': {'index.html': '<p>CHANGED_DRAFT</p>'}}),))
        with self.assertRaises(LookupError):
            view.public_interactive_child(self.path, PROJECT, **args)

    def test_http_policy_separates_parent_from_child_and_never_claims_navigation_is_blocked(self):
        parent, child = view.response_headers(), view.response_headers(child=True)
        self.assertIn("script-src 'none'", parent['Content-Security-Policy'])
        self.assertEqual(parent['X-Frame-Options'], 'DENY')
        self.assertNotIn('X-Frame-Options', child)
        directives = dict((part.strip().split(' ', 1) + [''])[:2] for part in child['Content-Security-Policy'].split(';'))
        self.assertEqual(directives['script-src'], 'data:')
        self.assertEqual(directives['sandbox'], 'allow-scripts')
        for kind in ['connect-src', 'img-src', 'media-src', 'font-src', 'worker-src', 'object-src', 'frame-src', 'base-uri', 'form-action']:
            self.assertEqual(directives[kind], "'none'")
        self.assertNotIn('navigate-to', directives)
        self.assertNotIn('unsafe-eval', child['Content-Security-Policy'])

    def test_actual_esbuild_bundles_inline_and_local_relative_modules_once_without_executing_them(self):
        self.save(PROJECT, 1, {
            'index.html': '<button id="play">玩</button><script type="module">import {start} from "./tide.js"; document.getElementById("play").addEventListener("click",start);</script><script type="module" src="./parts/entry.js"></script>',
            'tide.js': 'export function start(){document.getElementById("play").textContent="TIDE_MODULE_CANARY";}',
            'parts/entry.js': 'import label from "./label.mjs"; console.log(label); throw new Error("MUST_NOT_EXECUTE_DURING_RENDER");',
            'parts/label.mjs': 'export default "NESTED_MODULE_CANARY";',
        })
        view._BUNDLE_CACHE.clear()
        actual_run = view.subprocess.run
        with patch.object(view.subprocess, 'run', wraps=actual_run) as compiler:
            _, _, child = self.child()
            self.assertNotIn('role="alert"', child.decode())
            scripts = [base64.b64decode(attrs['src'].split(',', 1)[1]).decode() for tag, attrs in Elements(child).elements if tag == 'script']
            self.assertEqual(len(scripts), 2)
            self.assertIn('TIDE_MODULE_CANARY', scripts[0])
            self.assertIn('addEventListener', scripts[0])
            self.assertIn('NESTED_MODULE_CANARY', scripts[1])
            self.assertIn('MUST_NOT_EXECUTE_DURING_RENDER', scripts[1])
            for script in scripts:
                self.assertNotRegex(script, r'(?m)^\s*(?:import|export)\s')
            self.child()
            self.assertEqual(compiler.call_count, 1, 'All entries use one helper request and identical frozen renders reuse its cached result')

    def test_actual_compiler_rejects_external_traversal_missing_and_dynamic_imports_with_visible_failure(self):
        imports = ['../escape.js', '/absolute.js', 'https://example.invalid/game.js', 'data:text/javascript,0', 'node:fs', 'some-package', './missing.js', './%2e%2e/escape.js', './parts/../../escape.js']
        entries = [{'contents': 'import value from ' + json.dumps(source) + '; console.log(value);'} for source in imports]
        entries.extend([{'contents': 'const source="./tide.js"; import(source);'}, {'contents': 'import /* indirect */ ("./tide.js");'}, {'contents': 'console.log(import.meta.url);'}])
        files = {'index.html': '<p>fixture</p>', 'tide.js': 'export default "LOCAL_ONLY";'}
        result = view._bundle_modules(files, entries)
        self.assertEqual(len(result['outputs']), len(entries))
        self.assertTrue(all(not output['ok'] and output['error'] for output in result['outputs']))
        self.assertEqual(result.get('compiler'), '0.28.2')
        self.save(PROJECT, 1, {'index.html': '<button id="play">暂不可玩</button><script type="module">import "./missing.js";</script>'})
        _, _, child = self.child()
        self.assertIn('role="alert"', child.decode())
        self.assertIn('模块暂时没能运行', child.decode())
        self.assertFalse(any(tag == 'script' for tag, _ in Elements(child).elements))


if __name__ == '__main__':
    unittest.main()

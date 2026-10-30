import hashlib
import io
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing, contextmanager
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent / 'home'))
from life_view import life_view
import server


class LifeHomeTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='whale-life-home-')
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / 'life.sqlite3'

    @contextmanager
    def schema(self):
        with closing(sqlite3.connect(self.path)) as db:
            with db:
                db.execute('CREATE TABLE life_heartbeats(id TEXT PRIMARY KEY,at INTEGER,state TEXT,choice TEXT,reason TEXT,next_at INTEGER,result TEXT)')
                db.execute('CREATE TABLE life_corner_posts(id TEXT PRIMARY KEY,journal TEXT,journal_revision INTEGER,text TEXT,created INTEGER,channel TEXT,state TEXT,receipt TEXT)')
                yield db

    def test_missing_and_partial_schema_are_not_connected_and_never_created(self):
        self.assertEqual(life_view(self.path)['status'], 'not-connected')
        self.assertFalse(self.path.exists())
        with closing(sqlite3.connect(self.path)) as db:
            with db:
                db.execute('CREATE TABLE life_heartbeats(id TEXT,private_text TEXT)')
                db.execute("INSERT INTO life_heartbeats VALUES('hidden','PRIVATE_CANARY')")
        result = life_view(self.path)
        self.assertFalse(result['available'])
        self.assertEqual(result['status'], 'not-connected')
        self.assertNotIn('PRIVATE_CANARY', json.dumps(result))

    def test_real_public_rows_are_bounded_filtered_and_read_only(self):
        with self.schema() as db:
            for i in range(9):
                db.execute('INSERT INTO life_heartbeats VALUES(?,?,?,?,?,?,?)', (str(i), 1700000000000+i, 'completed', 'explore', '想看一个公开的小问题。', 1700001800000+i, '{"sender_id":"900000001","reasoning":"PRIVATE_CANARY"}'))
            for i in range(15):
                db.execute('INSERT INTO life_corner_posts VALUES(?,?,?,?,?,?,?,?)', ('home-'+str(i), 'PRIVATE_JOURNAL', 1, '<img src=x onerror=alert(1)>'+'文'*1500, 1700000000000+i, 'home', 'published', 'PRIVATE_RECEIPT'))
            for channel, state in [('qq','published'),('home','draft'),('home','uncertain')]:
                db.execute('INSERT INTO life_corner_posts VALUES(?,?,?,?,?,?,?,?)', (channel+state, 'private', 1, 'PRIVATE_UNPUBLISHED', 1800000000000, channel, state, 'PRIVATE_RECEIPT'))
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        result = life_view(self.path)
        self.assertTrue(result['available'])
        self.assertEqual(len(result['heartbeats']), 6)
        self.assertEqual(len(result['posts']), 12)
        self.assertEqual(result['posts'][0]['id'], 'home-14')
        self.assertEqual(result['heartbeats'][0]['at'], 1700000000008)
        self.assertEqual(result['next_at'], 1700001800008)
        self.assertEqual(len(result['posts'][0]['text']), 1200)
        self.assertTrue(result['posts'][0]['text'].startswith('<img'))
        public = json.dumps(result, ensure_ascii=False)
        for hidden in ['PRIVATE_CANARY','900000001','PRIVATE_JOURNAL','PRIVATE_RECEIPT','PRIVATE_UNPUBLISHED','reasoning','sender_id']:
            self.assertNotIn(hidden, public)
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)

    def test_reason_is_a_short_public_choice_not_a_trace_or_account_dump(self):
        with self.schema() as db:
            db.execute('INSERT INTO life_heartbeats VALUES(?,?,?,?,?,?,?)', ('one', 1700000000001, 'completed', 'journal', '想给900000001留一句；https://example.org/?token=PRIVATE_CANARY '+'字'*300, 1700001800001, 'PRIVATE_RESULT'))
            db.execute('INSERT INTO life_heartbeats VALUES(?,?,?,?,?,?,?)', ('two', 1700000000002, 'completed', 'reflect', '<think>PRIVATE_THINK</think>', 1700001800002, 'PRIVATE_RESULT'))
        result = life_view(self.path)
        self.assertIsNone(result['heartbeats'][0]['reason'])
        self.assertLessEqual(len(result['heartbeats'][1]['reason']), 180)
        self.assertNotIn('900000001', json.dumps(result))
        self.assertNotIn('PRIVATE_', json.dumps(result))

    def test_corrupt_db_is_unavailable_and_api_uses_the_public_view(self):
        self.path.write_bytes(b'not a database')
        self.assertEqual(life_view(self.path)['status'], 'temporarily-unavailable')
        self.path.unlink()
        with self.schema() as db:
            db.execute('INSERT INTO life_corner_posts VALUES(?,?,?,?,?,?,?,?)', ('public-one', 'HIDDEN_JOURNAL', 1, '她选择留下的一小段话。', 1700000000000, 'home', 'published', 'HIDDEN_RECEIPT'))
        handler = object.__new__(server.Handler)
        handler.path = '/api/life'
        handler.headers = {'Host': '127.0.0.1:17790'}
        handler.wfile = io.BytesIO()
        headers = {}
        handler.send_response = lambda status: headers.update(status=status)
        handler.send_header = lambda key, value: headers.update({key: value})
        handler.end_headers = lambda: None
        handler.send_error = lambda status, *args: self.fail('Unexpected HTTP error '+str(status))
        with patch.object(server, 'LIFE', self.path):
            handler.do_GET()
        self.assertEqual(headers['status'], 200)
        self.assertEqual(headers['Content-Type'], 'application/json; charset=utf-8')
        self.assertEqual(json.loads(handler.wfile.getvalue())['posts'][0]['text'], '她选择留下的一小段话。')
        self.assertNotIn('HIDDEN_', handler.wfile.getvalue().decode())
        app = (Path(__file__).parent/'home/app.js').read_text(encoding='utf-8')
        life_code = app[app.index('function renderLife('):]
        self.assertIn('textContent', life_code)
        self.assertNotIn('innerHTML', life_code)
        self.assertNotIn('insertAdjacentHTML', life_code)
        self.assertLess(app.index('lifeLoading=false'), app.index('refresh();setInterval'))


if __name__ == '__main__':
    unittest.main()

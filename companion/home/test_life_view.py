"""Synthetic SQLite boundary tests; no server, browser, provider or network."""
import hashlib
import json
import re
import sqlite3
import tempfile
import unittest
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch

import life_view as view

NOW = int(datetime.fromisoformat('2036-10-17T07:00:00+08:00').timestamp() * 1000)
PRIVATE = 'PRIVATE_ORIGINAL_NOT_FOR_DISPLAY'


class LifeViewTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='whale-home-life-')
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'life.sqlite3'
        self.db = sqlite3.connect(self.path)
        self.addCleanup(self.db.close)
        self.db.executescript('''
            CREATE TABLE life_heartbeats(id TEXT PRIMARY KEY,at INTEGER,state TEXT,choice TEXT,reason TEXT,next_at INTEGER,result TEXT);
            CREATE TABLE life_corner_posts(id TEXT PRIMARY KEY,journal TEXT,journal_revision INTEGER,text TEXT,created INTEGER,channel TEXT,state TEXT,receipt TEXT);
            CREATE TABLE life_settings(key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE activities(id TEXT PRIMARY KEY,topic TEXT,motivation TEXT,state TEXT,summary TEXT,created INTEGER,updated INTEGER);
            CREATE TABLE discoveries(id TEXT PRIMARY KEY,activity TEXT,url TEXT,title TEXT,excerpt TEXT,at INTEGER);
            CREATE TABLE life_reading_evidence(discovery TEXT PRIMARY KEY,activity TEXT,tool TEXT,level TEXT,details TEXT);
            CREATE TABLE life_progress_attempts(id TEXT PRIMARY KEY,activity TEXT,tool TEXT,request_fingerprint TEXT,status TEXT,reason_category TEXT,continuation TEXT,at INTEGER);
            CREATE TABLE self_state(private_content TEXT);
            CREATE TABLE experiences(private_content TEXT);
        ''')
        self.db.execute('INSERT INTO self_state VALUES(?)', (PRIVATE,))
        self.db.execute('INSERT INTO experiences VALUES(?)', (PRIVATE,))
        self.db.commit()

    def activity(self, name='one', state='unfinished', choice='explore', at=NOW - 1000, outcome='kept-private-or-quiet', heartbeat_state='finished'):
        self.db.execute('INSERT INTO activities VALUES(?,?,?,?,?,?,?)', (name, PRIVATE, PRIVATE, state, PRIVATE, at, at))
        self.db.execute('INSERT INTO life_heartbeats VALUES(?,?,?,?,?,?,?)', (name, at, heartbeat_state, choice, PRIVATE, NOW + 9999999,
                        json.dumps({'status': outcome, 'private_nested_result': PRIVATE, 'reasoning_content': PRIVATE})))

    def source(self, name, activity='one', level='page-text', at=NOW - 500, reading_activity=None):
        self.db.execute('INSERT INTO discoveries VALUES(?,?,?,?,?,?)', (name, activity, 'https://example.org/' + PRIVATE, PRIVATE, PRIVATE, at))
        self.db.execute('INSERT INTO life_reading_evidence VALUES(?,?,?,?,?)', (name, reading_activity or activity, 'public_fetch', level, json.dumps({'private': PRIVATE})))

    def attempt(self, name, activity='one', status='failed', at=NOW - 400, tool='public_fetch', reason='access-unavailable'):
        self.db.execute('INSERT INTO life_progress_attempts VALUES(?,?,?,?,?,?,?,?)', (name, activity, tool, PRIVATE, status, reason, PRIVATE, at))

    def post(self, name, text='An explicitly published own note.', state='published', channel='home', at=NOW - 300):
        self.db.execute('INSERT INTO life_corner_posts VALUES(?,?,?,?,?,?,?,?)', (name, PRIVATE, 1, text, at, channel, state, PRIVATE))

    def read(self):
        self.db.commit()
        return view.life_view(self.path, NOW)

    def test_missing_corrupt_or_partial_schema_does_not_create_or_invent_records(self):
        missing = Path(self.directory.name) / 'missing.sqlite3'
        self.assertFalse(view.life_view(missing, NOW)['available'])
        self.assertFalse(missing.exists())
        self.assertFalse(view.life_view(self.path, float('nan'))['available'])
        self.assertEqual(self.read()['last_recorded_day'], None)
        self.db.execute('DROP TABLE activities')
        self.db.execute('DROP TABLE life_progress_attempts')
        self.db.execute('DROP TABLE life_reading_evidence')
        result = self.read()
        self.assertTrue(result['available'])
        self.assertFalse(result['coverage']['activity_metadata_available'])
        self.assertFalse(result['coverage']['attempt_metadata_available'])
        self.assertFalse(result['coverage']['reading_levels_available'])
        self.assertIsNone(result['next_at'])
        broken = Path(self.directory.name) / 'broken.sqlite3'
        broken.write_bytes(b'not a database')
        self.assertEqual(view.life_view(broken, NOW)['status'], 'temporarily-unavailable')
        self.assertEqual(broken.read_bytes(), b'not a database')

    def test_current_schedule_uses_settings_never_old_heartbeat_snapshot(self):
        self.activity()
        self.db.execute("INSERT INTO life_settings VALUES('next',?)", (str(NOW + 1800000),))
        result = self.read()
        self.assertEqual(result['next_at'], NOW + 1800000)
        self.assertEqual(result['schedule_source'], 'life_settings')
        self.assertEqual(result['schedule_state'], 'scheduled')
        self.assertNotIn('next_at', result['heartbeats'][0])
        for value, state in [(str(NOW - 1), 'due'), ('not-a-time', 'unknown'), ('-1', 'unknown'), ('99999999999999999', 'unknown')]:
            with self.subTest(value=value):
                self.db.execute("UPDATE life_settings SET value=? WHERE key='next'", (value,))
                self.assertEqual(self.read()['schedule_state'], state)
        self.db.execute('DELETE FROM life_settings')
        self.assertIsNone(self.read()['next_at'])
        self.db.execute('DROP TABLE life_settings')
        self.assertIsNone(self.read()['next_at'])

    def test_actual_reading_levels_counts_and_attempt_status_remain_distinct(self):
        self.activity(state='completed')
        for index, level in enumerate(['search-lead', 'metadata-only', 'subtitles', 'speech-transcript', 'sampled-frames', 'thread-posts', 'page-text']):
            self.source('source-' + str(index), level=level)
        self.source('wrong-activity-reading', reading_activity='unrelated')
        self.attempt('failed', status='unavailable')
        self.attempt('ok', status='ok', reason=None)
        result = self.read()
        activity = result['activities'][0]
        self.assertEqual(activity['saved_source_count'], 8)
        self.assertEqual(activity['reading_levels']['search-lead'], 1)
        self.assertEqual(activity['reading_levels']['unknown'], 1)
        self.assertEqual(activity['attempt_counts'], {'ok': 1, 'unavailable': 1})
        self.assertEqual(result['heartbeats'][0]['activity_state'], 'completed')
        self.assertFalse(result['coverage']['creative_execution_available'])
        self.assertNotIn('new-material', json.dumps(result))

    def test_creative_completed_activity_is_saved_step_not_completed_execution(self):
        self.activity('saved', state='completed', choice='create', outcome='creative-workspace-updated')
        self.activity('partial', state='unfinished', choice='create', at=NOW - 500, outcome='creative-continuation-saved')
        self.activity('failed', state='failed', at=NOW - 100, outcome='failed', heartbeat_state='failed')
        result = self.read()
        creative = [item for item in result['activities'] if item['kind'] == 'create']
        self.assertEqual([item['creative_step'] for item in creative], ['partial-step-saved', 'saved-step'])
        self.assertTrue(all(item['execution_verified'] is None for item in creative))
        self.assertEqual(result['heartbeats'][0]['state'], 'failed')
        self.assertEqual(result['heartbeats'][0]['outcome'], 'failed')
        self.assertEqual(result['heartbeats'][1]['outcome'], 'creative-continuation-saved')

    def test_no_private_columns_or_unexpected_enums_escape_and_reads_are_ro(self):
        self.activity()
        self.source('sensitive-source', level=PRIVATE)
        self.attempt('sensitive-attempt', tool=PRIVATE, status=PRIVATE, reason=PRIVATE)
        self.db.commit()
        original_connect = sqlite3.connect
        calls, denied = [], []
        forbidden_columns = {'reason', 'topic', 'motivation', 'summary', 'excerpt', 'details', 'receipt', 'request_fingerprint', 'continuation', 'url', 'title'}
        writes = {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE, sqlite3.SQLITE_CREATE_TABLE, sqlite3.SQLITE_DROP_TABLE}

        def connect(database_uri, **kwargs):
            calls.append((database_uri, kwargs))
            connection = original_connect(database_uri, **kwargs)

            def authorize(action, table, column, *_):
                if action in writes or action == sqlite3.SQLITE_READ and (table in {'self_state', 'experiences'} or column in forbidden_columns):
                    denied.append((action, table, column))
                    return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK

            connection.set_authorizer(authorize)
            return connection

        before = (hashlib.sha256(self.path.read_bytes()).hexdigest(), self.path.stat().st_mtime_ns)
        with patch.object(view.sqlite3, 'connect', side_effect=connect):
            first = view.life_view(self.path, NOW)
            self.assertEqual(view.life_view(self.path, NOW), first)
        self.assertTrue(first['available'], denied)
        self.assertEqual(denied, [])
        self.assertTrue(all('?mode=ro' in uri and kwargs['uri'] for uri, kwargs in calls))
        self.assertEqual((hashlib.sha256(self.path.read_bytes()).hexdigest(), self.path.stat().st_mtime_ns), before)
        self.assertNotIn(PRIVATE, json.dumps(first))
        self.assertEqual(first['attempts'][0]['tool'], 'unknown')
        self.assertEqual(first['attempts'][0]['reason_category'], 'unknown')
        self.assertNotIn('reason', first['heartbeats'][0])

    def test_only_safe_deliberately_published_home_text_is_shown(self):
        self.post('published')
        self.post('draft', text=PRIVATE, state='preparing')
        self.post('uncertain', text=PRIVATE, state='uncertain')
        self.post('other-channel', text=PRIVATE, channel='qzone')
        self.post('future', text=PRIVATE, at=NOW + 1)
        self.post('hidden-thought', text='<think>' + PRIVATE + '</think>')
        self.post('late-credential', text='safe ' * 300 + 'Bearer ' + 'x' * 30)
        result = self.read()
        self.assertEqual(result['posts'], [{'text': 'An explicitly published own note.', 'created': NOW - 300}])
        self.assertNotIn(PRIVATE, json.dumps(result))
        self.assertNotIn('Bearer', json.dumps(result))

    def test_bounded_recent_metadata_excludes_future_unknown_times_and_uses_beijing_day(self):
        for number in range(9):
            self.activity(str(number), at=NOW - number * 1000)
            self.attempt(str(number), activity=str(number), at=NOW - number * 1000)
        self.activity('future', at=NOW + 1)
        self.activity('unknown', at='unknown')
        self.source('future-source', at=NOW + 2)
        result = self.read()
        self.assertEqual(len(result['heartbeats']), 6)
        self.assertEqual(len(result['activities']), 6)
        self.assertEqual(len(result['attempts']), 6)
        self.assertEqual(result['last_recorded_at'], NOW)
        self.assertEqual(result['last_recorded_day'], '2036-10-17')

    def test_life_rendering_targets_exist_and_public_strings_use_text_nodes(self):
        root = Path(__file__).resolve().parent
        script = (root / 'app.js').read_text(encoding='utf-8-sig')
        markup = (root / 'index.html').read_text(encoding='utf-8-sig')

        class IDs(HTMLParser):
            def __init__(self):
                super().__init__()
                self.ids = []

            def handle_starttag(self, tag, attrs):
                self.ids.extend(value for key, value in attrs if key == 'id')

        parsed = IDs()
        parsed.feed(markup)
        self.assertEqual(len(parsed.ids), len(set(parsed.ids)))
        required = set(re.findall(r"(?:text|list|\$)\('((?:life-)[^']+)'", script))
        self.assertTrue(required.issubset(set(parsed.ids)), required - set(parsed.ids))
        rendering = script[script.index('function lifeFacts'):script.index('async function refreshLife')]
        self.assertNotIn('innerHTML', rendering)
        self.assertNotIn('heartbeat.reason', rendering)
        self.assertIn('body.textContent', rendering)
        self.assertIn("data.schedule_state==='due'", rendering)


if __name__ == '__main__':
    unittest.main()

import hashlib
import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing, contextmanager
from pathlib import Path

from capability_view import capability_view

NOW = 2107857600000
CANARY = 'PRIVATE_BODY https://private.invalid/900000006 sk-test-fixture-not-a-real-key'


@contextmanager
def database(path):
    # sqlite's transaction context does not close the handle on Windows.
    with closing(sqlite3.connect(path)) as db:
        with db:
            yield db


class CapabilityViewTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def db(self, name, schema, rows=()):
        with database(self.root / name) as db:
            db.executescript(schema)
            for sql, values in rows:
                db.execute(sql, values)

    def read(self, runtime=None):
        value = capability_view(self.root, runtime, NOW)
        self.assertNotIn('PRIVATE_BODY', json.dumps(value))
        self.assertNotIn('900000006', json.dumps(value))
        self.assertNotIn('private.invalid', json.dumps(value))
        return {item['key']: item for item in value['items']}

    def test_missing_store_unknown_runtime_no_creation_and_13_fixed_keys(self):
        before = list(self.root.iterdir())
        items = self.read({'observed_at': NOW, 'items': {'public_web': {'configured': True, 'available': None, 'autonomous': True}, 'private': CANARY}})
        self.assertEqual(len(items), 13)
        self.assertEqual(items['public_web']['configuration'], {'configured': True, 'available': None, 'autonomous': True, 'observed_at': NOW})
        self.assertIsNone(items['ordinary_tieba']['configuration']['available'])
        self.assertTrue(all(item['last_success'] is None for item in items.values()))
        self.assertEqual(list(self.root.iterdir()), before)
        self.assertFalse(items['claw']['history_available'])

    def test_runtime_unknown_stale_future_and_untrusted_fields_are_not_echoed(self):
        for at in [NOW + 1, NOW - 60_001, None, str(NOW)]:
            item = self.read({'observed_at': at, 'items': {'own_profile': {'configured': True, 'available': True, 'autonomous': True, 'blocker': CANARY}}})['own_profile']
            self.assertIsNone(item['configuration']['configured'])
            self.assertIsNone(item['blocker'])
        item = self.read({'observed_at': NOW, 'items': {'own_profile': {'configured': 1, 'available': 'yes', 'autonomous': [], 'blocker': {'private': CANARY}}}})['own_profile']
        self.assertIsNone(item['configuration']['available'])
        self.assertIsNone(item['blocker'])

    def test_voice_metadata_excludes_speech_and_keeps_dated_success_and_failure(self):
        self.db('qq-voice.sqlite3', 'CREATE TABLE qq_voice_observations(status TEXT,reason TEXT,observed_at INTEGER,source TEXT);', [
            ('INSERT INTO qq_voice_observations VALUES(?,?,?,?)', ('transcribed', None, NOW-1000, CANARY)),
            ('INSERT INTO qq_voice_observations VALUES(?,?,?,?)', ('unavailable', CANARY, NOW-100, CANARY)),
        ])
        item = self.read()['qq_voice']
        self.assertEqual(item['last_success'], {'at': NOW-1000, 'kind': 'speech-transcript'})
        self.assertEqual(item['last_failure']['code'], 'speech-not-fully-transcribed')
        self.assertNotIn(CANARY, json.dumps(item))

    def test_qzone_old_success_survives_new_failure_and_paused_runtime(self):
        self.db('qzone.sqlite3', 'CREATE TABLE qzone_reads(id TEXT,kind TEXT,result TEXT,at INTEGER); CREATE TABLE qzone_operations(id TEXT,state TEXT,updated INTEGER); CREATE TABLE qzone_meta(key TEXT,value TEXT);', [
            ('INSERT INTO qzone_reads VALUES(?,?,?,?)', ('hidden', 'own-post-list', json.dumps({'ok': True, 'state': 'read', 'data': CANARY}), NOW - 5000)),
            ('INSERT INTO qzone_operations VALUES(?,?,?)', ('secret', 'verified', NOW - 4000)),
            ('INSERT INTO qzone_operations VALUES(?,?,?)', ('secret2', 'uncertain', NOW - 1000)),
            ('INSERT INTO qzone_meta VALUES(?,?)', ('read', json.dumps({'state': 'api-failed', 'code': 'api-error', 'observed_at': NOW - 100, 'content': CANARY}))),
        ])
        items = self.read({'observed_at': NOW, 'items': {'qzone_publish': {'configured': True, 'available': False, 'autonomous': True, 'blocker': 'service-paused'}}})
        self.assertEqual(items['qzone_publish']['last_success']['at'], NOW - 4000)
        self.assertEqual(items['qzone_publish']['last_failure']['at'], NOW - 1000)
        self.assertEqual(items['qzone_publish']['blocker']['basis'], 'runtime')
        self.assertEqual(items['qzone_read']['last_success']['at'], NOW - 5000)
        self.assertEqual(items['qzone_read']['blocker'], {'code': 'api-error', 'observed_at': NOW - 100, 'basis': 'latest-attempt'})

    def test_bilibili_real_levels_not_metadata_or_labels_and_finite_failures(self):
        self.db('bilibili.sqlite3', 'CREATE TABLE public_videos(key TEXT,result TEXT,at INTEGER); CREATE TABLE public_video_speech(key TEXT,result TEXT,at INTEGER);', [
            ('INSERT INTO public_videos VALUES(?,?,?)', ('sub', json.dumps({'status': 'ok', 'content': {'subtitle_read': True, 'subtitle': [CANARY]}, 'limitations': []}), NOW - 5000)),
            ('INSERT INTO public_videos VALUES(?,?,?)', ('frame', json.dumps({'status': 'ok', 'content': {'sampled_frames': [{'status': 'vision-ok', 'vision': CANARY}]}, 'limitations': []}), NOW - 4000)),
            ('INSERT INTO public_videos VALUES(?,?,?)', ('metadata', json.dumps({'status': 'ok', 'content': {'subtitle_read': False, 'sampled_frames': [{'status': 'labels-only'}]}, 'limitations': ['no-public-subtitle', CANARY]}), NOW - 1000)),
            ('INSERT INTO public_videos VALUES(?,?,?)', ('broken', '{bad', NOW - 10)),
            ('INSERT INTO public_video_speech VALUES(?,?,?)', ('spoken', json.dumps({'status': 'ok', 'evidence_level': 'speech-transcript', 'content': CANARY}), NOW - 3000)),
            ('INSERT INTO public_video_speech VALUES(?,?,?)', ('empty', json.dumps({'status': 'ok', 'evidence_level': 'metadata-only', 'content': CANARY}), NOW - 100)),
        ])
        items = self.read()
        self.assertEqual(items['bilibili_subtitles']['last_success'], {'at': NOW - 5000, 'kind': 'subtitles'})
        self.assertEqual(items['bilibili_subtitles']['last_failure']['code'], 'no-public-subtitle')
        self.assertEqual(items['bilibili_frames']['last_success']['at'], NOW - 4000)
        self.assertEqual(items['bilibili_speech']['last_success']['at'], NOW - 3000)

    def test_life_source_attribution_and_actual_sent_media_only(self):
        schema = '''CREATE TABLE discoveries(id TEXT,activity TEXT,url TEXT,excerpt TEXT,at INTEGER);
        CREATE TABLE life_reading_evidence(discovery TEXT,activity TEXT,tool TEXT,level TEXT,details TEXT);
        CREATE TABLE life_progress_attempts(tool TEXT,status TEXT,reason_category TEXT,at INTEGER);
        CREATE TABLE life_share_intents(state TEXT,updated INTEGER,media_plan TEXT,receipt TEXT);'''
        self.db('life.sqlite3', schema, [
            ('INSERT INTO discoveries VALUES(?,?,?,?,?)', ('source', 'a', CANARY, CANARY, NOW - 500)),
            ('INSERT INTO life_reading_evidence VALUES(?,?,?,?,?)', ('source', 'a', 'tieba_thread', 'thread-posts', CANARY)),
            ('INSERT INTO discoveries VALUES(?,?,?,?,?)', ('cross', 'a', CANARY, CANARY, NOW - 10)),
            ('INSERT INTO life_reading_evidence VALUES(?,?,?,?,?)', ('cross', 'different-activity', 'public_fetch', 'page-text', CANARY)),
            ('INSERT INTO life_progress_attempts VALUES(?,?,?,?)', ('tieba_thread', 'failed', 'timeout', NOW - 1000)),
            ('INSERT INTO life_progress_attempts VALUES(?,?,?,?)', ('public_fetch', 'failed', CANARY, NOW - 100)),
            ('INSERT INTO life_progress_attempts VALUES(?,?,?,?)', ('private_reader', 'failed', 'timeout', NOW - 10)),
        ])
        with database(self.root / 'life.sqlite3') as db:
            both = json.dumps({'native_face_ids': ['66'], 'public_image_id': 'hidden-image'})
            for state, at, receipt in [('sent', NOW - 800, {'transport_returned': True, 'message_id': 900000006}), ('uncertain', NOW - 200, None), ('queued', NOW - 10, None), ('sent', NOW - 5, {'transport_returned': True}), ('sent', NOW + 1, {'transport_returned': True, 'message_id': 1})]:
                db.execute('INSERT INTO life_share_intents VALUES(?,?,?,?)', (state, at, both, json.dumps(receipt)))
        items = self.read()
        self.assertEqual(items['claw']['last_success']['kind'], 'thread-posts')
        self.assertEqual(items['claw']['last_failure']['at'], NOW - 1000)
        self.assertIsNone(items['claw']['blocker'])
        self.assertIsNone(items['ordinary_tieba']['last_success'])
        self.assertIsNone(items['public_web']['last_success'])
        self.assertEqual(items['public_web']['last_failure']['code'], 'reader-attempt-failed')
        for key in ['proactive_faces', 'proactive_images']:
            self.assertEqual(items[key]['last_success']['at'], NOW - 800)
            self.assertEqual(items[key]['last_failure'], {'at': NOW - 200, 'code': 'delivery-uncertain'})

    def test_own_jobs_profile_receipts_and_no_writes_even_with_wal(self):
        self.db('workshop.sqlite3', 'CREATE TABLE workshop_jobs(scope TEXT,requester TEXT,source_event TEXT,state TEXT,updated INTEGER,instruction TEXT);', [
            ('INSERT INTO workshop_jobs VALUES(?,?,?,?,?,?)', ('private-12345', '12345', 'life:one', 'completed', NOW - 500, CANARY)),
            ('INSERT INTO workshop_jobs VALUES(?,?,?,?,?,?)', ('private-54321', '12345', 'life:wrong', 'completed', NOW - 20, CANARY)),
            ('INSERT INTO workshop_jobs VALUES(?,?,?,?,?,?)', ('private-12345', '12345', 'chat:event', 'completed', NOW - 10, CANARY)),
            ('INSERT INTO workshop_jobs VALUES(?,?,?,?,?,?)', ('private-12345', '12345', 'life:two', 'queued', NOW - 5, CANARY)),
        ])
        self.db('qq-self-profile.sqlite3', 'CREATE TABLE qq_self_operations(id TEXT,before_version TEXT,after_version TEXT,state TEXT,actions TEXT,at INTEGER); CREATE TABLE qq_self_versions(version TEXT,data TEXT,at INTEGER);', [
            ('INSERT INTO qq_self_operations VALUES(?,?,?,?,?,?)', ('hidden', 'same', 'same', 'verified', '[]', NOW - 300)),
            ('INSERT INTO qq_self_operations VALUES(?,?,?,?,?,?)', ('hidden2', 'same', None, 'failed-or-uncertain', CANARY, NOW - 100)),
            ('INSERT INTO qq_self_versions VALUES(?,?,?)', ('secret', CANARY, NOW)),
        ])
        # Live WAL writer stays open: the reader must see committed metadata and
        # must leave total_changes, data_version and database/WAL bytes untouched.
        # SQLite may update shared-memory reader marks even in mode=ro.
        with database(self.root / 'qq-self-profile.sqlite3') as writer:
            writer.execute('PRAGMA journal_mode=WAL')
            writer.execute('INSERT INTO qq_self_versions VALUES(?,?,?)', ('wal', CANARY, NOW))
            writer.commit()
            before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.iterdir() if p.is_file() and not p.name.endswith('-shm')}
            changes = writer.total_changes
            version = writer.execute('PRAGMA data_version').fetchone()
            items = self.read()
            self.read()
            after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.iterdir() if p.is_file() and not p.name.endswith('-shm')}
            self.assertEqual(before, after)
            self.assertEqual(changes, writer.total_changes)
            self.assertEqual(version, writer.execute('PRAGMA data_version').fetchone())
        self.assertEqual(items['own_workshop']['last_success']['at'], NOW - 500)
        self.assertEqual(items['own_profile']['last_success'], {'at': NOW - 300, 'kind': 'profile-readback'})
        self.assertIn('开始', items['own_profile']['scope'])

    def test_partial_corrupt_and_linked_databases_remain_unknown(self):
        self.db('life.sqlite3', 'CREATE TABLE life_progress_attempts(tool TEXT);')
        (self.root / 'qzone.sqlite3').write_bytes(b'not sqlite')
        external = self.root / 'outside.sqlite3'
        with database(external) as db:
            db.execute('CREATE TABLE qq_self_operations(state TEXT,at INTEGER)')
            db.execute('INSERT INTO qq_self_operations VALUES(?,?)', ('verified', NOW - 1))
        os.link(external, self.root / 'qq-self-profile.sqlite3')
        items = self.read()
        self.assertFalse(items['own_profile']['history_available'])
        self.assertIsNone(items['qzone_read']['last_success'])
        self.assertIsNone(items['public_web']['last_failure'])


if __name__ == '__main__':
    unittest.main()

import hashlib
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from contextlib import closing, contextmanager
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent / 'home'))
from inner_life_view import inner_life_view

NOW = 2107821600000
POLICY = {'father_id': '910010003', 'mother_id': '910010004'}


class InnerLifeViewTests(unittest.TestCase):
    def setUp(self):
        workspace = Path(__file__).parent.resolve()
        self.folder = tempfile.TemporaryDirectory(prefix='.inner-life-view-', dir=workspace)
        self.assertTrue(Path(self.folder.name).resolve().is_relative_to(workspace))
        self.addCleanup(self.folder.cleanup)
        self.experience = Path(self.folder.name) / 'experience.sqlite3'
        self.social = Path(self.folder.name) / 'social.sqlite3'
        self.life = Path(self.folder.name) / 'life.sqlite3'

    @contextmanager
    def database(self, path):
        with closing(sqlite3.connect(path)) as db:
            with db:
                yield db

    def schema(self):
        with self.database(self.experience) as db:
            db.execute('CREATE TABLE self_state(kind TEXT,key TEXT,revision INTEGER,value TEXT,evidence TEXT,at INTEGER,PRIMARY KEY(kind,key,revision))')
        with self.database(self.social) as db:
            db.execute('CREATE TABLE proactive_availability(scope TEXT PRIMARY KEY,active INTEGER,expires INTEGER,source_time INTEGER,source_event TEXT)')
        with self.database(self.life) as db:
            db.execute('CREATE TABLE life_share_intents(id TEXT,state TEXT,updated INTEGER,recipient TEXT,text TEXT,receipt TEXT,target_id TEXT,recipient_reason TEXT)')

    def state(self, kind, key, revision, value, at=NOW-1000, evidence=None):
        with self.database(self.experience) as db:
            db.execute('INSERT INTO self_state VALUES(?,?,?,?,?,?)', (kind, key, revision, json.dumps(value), json.dumps(evidence or []), at))

    def view(self, policy=POLICY, now=NOW):
        return inner_life_view(self.experience, self.social, self.life, policy, now)

    def test_missing_is_unknown_not_zero_and_does_not_create_databases(self):
        value = self.view()
        self.assertFalse(value['inner_state']['available'])
        self.assertFalse(value['interests']['available'])
        self.assertFalse(value['sharing']['available'])
        self.assertIsNone(value['sharing']['counts'])
        self.assertFalse(value['availability']['available'])
        self.assertIsNone(value['availability']['father']['active'])
        self.assertFalse(self.experience.exists())
        self.assertFalse(self.social.exists())
        self.assertFalse(self.life.exists())
        invalid = self.view(now='not-a-time')
        self.assertFalse(invalid['sharing']['available'])
        self.assertIsNone(invalid['sharing']['counts'])
        self.assertFalse(invalid['sharing']['recipients']['father']['available'])

    def test_read_only_bounded_summary_and_no_private_data(self):
        self.schema()
        self.state('mood', 'inner-life', 1, {'mood': '平静' * 200, 'energy': 'steady', 'curiosity': 'curious', 'cause': 'PRIVATE_CAUSE_DO_NOT_EXPOSE'},
                   evidence=[{'id': 'PRIVATE_EVIDENCE_REFERENCE'}])
        for i in range(7):
            self.state('interest', 'reflection:topic-' + str(i), 1, {'interpretation': '潮汐' * 150, 'active': True}, at=NOW-i)
        with self.database(self.life) as db:
            for row in [('a', 'queued', NOW-3000, 'father'), ('b', 'sent', NOW-1000, 'father'), ('c', 'uncertain', NOW-2000, 'family')]:
                db.execute('INSERT INTO life_share_intents VALUES(?,?,?,?,?,?,?,?)', (*row, 'PRIVATE_SHARE_BODY', 'PRIVATE_RECEIPT', POLICY['father_id'], 'PRIVATE_RECIPIENT_REASON'))
        with self.database(self.social) as db:
            db.execute('INSERT INTO proactive_availability VALUES(?,?,?,?,?)', ('private:'+POLICY['father_id'], 1, None, NOW-1000, 'PRIVATE_EVENT_ID'))
        paths = [self.experience, self.life, self.social]
        hashes = [hashlib.sha256(path.read_bytes()).hexdigest() for path in paths]
        value = self.view()
        self.assertTrue(value['inner_state']['available'])
        state = value['inner_state']['state']
        self.assertEqual(len(state['mood']), 240)
        self.assertEqual(state['evidence_count'], 1)
        self.assertEqual(state['energy'], 'steady')
        self.assertEqual(len(value['interests']['items']), 5)
        self.assertTrue(all(len(item['interpretation']) <= 160 for item in value['interests']['items']))
        self.assertIn('not a measurement', value['inner_state']['notice'])
        self.assertEqual(value['sharing']['counts'], {'queued': 1, 'sent': 1, 'uncertain': 1})
        self.assertEqual(value['sharing']['recipients']['father']['state'], 'sent')
        self.assertTrue(value['availability']['father']['active'])
        self.assertFalse(value['availability']['mother']['active'])
        encoded = json.dumps(value, ensure_ascii=False)
        for marker in ['PRIVATE_CAUSE', 'PRIVATE_EVIDENCE', 'PRIVATE_SHARE', 'PRIVATE_RECEIPT', 'PRIVATE_EVENT', 'PRIVATE_RECIPIENT', POLICY['father_id'], POLICY['mother_id'], 'private:']:
            self.assertNotIn(marker, encoded)
        self.assertEqual(value, self.view())
        self.assertEqual(hashes, [hashlib.sha256(path.read_bytes()).hexdigest() for path in paths])
        for path in paths:
            with self.database(path) as db:
                self.assertEqual(db.execute("SELECT count(*) FROM sqlite_master WHERE name LIKE 'inner_life%'").fetchone()[0], 0)

    def test_latest_retirement_or_invalid_revision_does_not_revive_old_values(self):
        self.schema()
        self.state('interest', 'retired', 1, {'interpretation': 'OLD_INTEREST_DO_NOT_REVIVE', 'active': True})
        self.state('interest', 'retired', 2, {'interpretation': 'Retired now', 'active': False})
        self.state('interest', 'broken', 1, 'OLD_BROKEN_DO_NOT_REVIVE')
        self.state('interest', 'broken', 2, {'active': True, 'interpretation': []})
        self.state('interest', 'legacy', 1, 'A current legacy interpretation')
        self.state('mood', 'inner-life', 1, {'mood': 'OLD_MOOD_DO_NOT_REVIVE', 'energy': 'high', 'curiosity': 'absorbed'})
        self.state('mood', 'inner-life', 2, {'mood': 'invalid latest', 'energy': 'PRIVATE_UNKNOWN_ENUM', 'curiosity': 'quiet'})
        value = self.view()
        self.assertFalse(value['inner_state']['available'])
        self.assertIsNone(value['inner_state']['state'])
        self.assertEqual([item['key'] for item in value['interests']['items']], ['legacy'])
        self.assertNotIn('DO_NOT_REVIVE', json.dumps(value))
        self.assertNotIn('PRIVATE_UNKNOWN_ENUM', json.dumps(value))

    def test_unreadable_partition_does_not_mask_other_available_partitions(self):
        self.schema()
        self.social.write_bytes(b'not a sqlite database')
        value = self.view()
        self.assertTrue(value['inner_state']['available'])
        self.assertTrue(value['interests']['available'])
        self.assertEqual(value['sharing']['counts'], {})
        self.assertFalse(value['availability']['available'])
        self.assertIsNone(value['availability']['father']['active'])
        self.life.unlink()
        self.assertIsNone(self.view()['sharing']['counts'])

    def test_pause_expiry_and_missing_parent_policy_are_distinct_from_false_data(self):
        self.schema()
        with self.database(self.social) as db:
            db.execute('INSERT INTO proactive_availability VALUES(?,?,?,?,?)', ('private:'+POLICY['father_id'], 1, NOW, NOW-1000, 'private-event'))
        value = self.view()
        self.assertFalse(value['availability']['father']['active'])
        self.assertEqual(value['availability']['father']['expires'], NOW)
        self.assertEqual(value['availability']['father']['at'], NOW-1000)
        unknown = self.view(policy={})['availability']['father']
        self.assertFalse(unknown['available'])
        self.assertIsNone(unknown['active'])

    def test_other_contact_history_and_pauses_are_visible_without_account_ids_or_message_bodies(self):
        self.schema()
        friend, group = 'private:910020001', 'group:910030002'
        with self.database(self.life) as db:
            for n, recipient in enumerate([friend, group, 'private:bad', 'untrusted arbitrary words']):
                db.execute('INSERT INTO life_share_intents VALUES(?,?,?,?,?,?,?,?)',
                           (str(n), 'sent', NOW-100, recipient, 'PRIVATE_BODY', 'PRIVATE_RECEIPT', 'PRIVATE_TARGET', 'PRIVATE_REASON'))
        with self.database(self.social) as db:
            db.execute('INSERT INTO proactive_availability VALUES(?,?,?,?,?)', (friend, 1, NOW+1000, NOW-200, 'PRIVATE_EVENT'))
        value = self.view()
        others = [v for k,v in value['sharing']['recipients'].items() if k.startswith('contact-')]
        self.assertEqual(len(others), 2)
        self.assertEqual({v['label'] for v in others}, {'好友 · 尾号0001', '群聊 · 尾号0002'})
        self.assertTrue(value['availability']['others'][0]['active'])
        serialized = json.dumps(value)
        for secret in [friend, group, '910020001', '910030002', 'PRIVATE_', 'untrusted arbitrary words']:
            self.assertNotIn(secret, serialized)
        self.assertFalse(self.view(now=NOW+2000)['availability']['others'][0]['active'])

    def test_other_contact_latest_invalid_time_is_unknown_not_old_success(self):
        self.schema()
        with self.database(self.life) as db:
            for n, at in enumerate([NOW-1000, NOW+1000]):
                db.execute('INSERT INTO life_share_intents VALUES(?,?,?,?,?,?,?,?)',
                           (str(n), 'sent', at, 'group:910030002', '', '', '', ''))
        others = [v for k,v in self.view()['sharing']['recipients'].items() if k.startswith('contact-')]
        self.assertEqual(len(others), 1)
        self.assertFalse(others[0]['available'])
        self.assertIsNone(others[0]['state'])

    def test_symlink_and_junction_paths_are_not_followed(self):
        self.schema()
        with patch.object(Path, 'is_symlink', return_value=True):
            value = self.view()
            self.assertFalse(value['inner_state']['available'])
            self.assertFalse(value['sharing']['available'])
            self.assertFalse(value['availability']['available'])
        if hasattr(Path, 'is_junction'):
            with patch.object(Path, 'is_junction', return_value=True):
                self.assertFalse(self.view()['inner_state']['available'])


if __name__ == '__main__':
    unittest.main()

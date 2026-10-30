import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from archive import create, restore

class ArchiveTests(unittest.TestCase):
    def test_roundtrip_includes_attachments_and_history(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t); src = p / 'source'; src.mkdir()
            for name, data in [('diary.md', '今天认识了老爹'.encode()), ('blobs/test.bin', b'\0\1'), ('.git/test', b'history')]:
                f = src / name; f.parent.mkdir(parents=True, exist_ok=True); f.write_bytes(data)
            self.assertEqual(create(src, p / 'a.zip')['files'], 3)
            self.assertTrue(restore(p / 'a.zip', p / 'restored')['verified'])
            self.assertEqual((p / 'restored/blobs/test.bin').read_bytes(), b'\0\1')
            with self.assertRaises(ValueError): restore(p / 'a.zip', src)
    def test_tamper_and_traversal_rejected(self):
        for name, sha in [('diary.md', 'wrong'), ('../escape', 'wrong'), ('CON', 'wrong')]:
            with tempfile.TemporaryDirectory() as t:
                p = Path(t)
                with zipfile.ZipFile(p / 'a.zip', 'w') as z:
                    z.writestr('manifest.json', json.dumps({'schema_version':1, 'entries':[{'path':name,'size':1,'sha256':sha}]}))
                    z.writestr('payload/' + name, b'x')
                with self.assertRaises(ValueError): restore(p / 'a.zip', p / 'out')
                self.assertFalse((p / 'out').exists())

if __name__ == '__main__': unittest.main()

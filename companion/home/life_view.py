"""Small read-only public view: no journal, chat, provider result or receipt bodies."""
import re
import sqlite3
from contextlib import closing
from pathlib import Path

_SCHEMA = {
    'life_heartbeats': {'id', 'at', 'state', 'choice', 'reason', 'next_at'},
    'life_corner_posts': {'id', 'text', 'created', 'channel', 'state'},
}
_PRIVATE_MARKERS = re.compile(r'<\s*/?\s*think\b|chain[_ -]?of[_ -]?thought|reasoning_content|sender_id|raw_message|private:|私聊原文|聊天原文', re.I)


def _stamp(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 253402300799000 else None


def _word(value):
    return value if isinstance(value, str) and re.fullmatch(r'[a-z][a-z_-]{0,39}', value) else None


def _reason(value):
    if not isinstance(value, str) or _PRIVATE_MARKERS.search(value):
        return None
    value = ' '.join(value.split())
    value = re.sub(r'https?://\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '…', value)
    value = re.sub(r'(?<!\d)\d{5,20}(?!\d)', '…', value)
    return value[:180] or None


def life_view(path):
    """Read only the two explicitly public tables. Missing schema stays unknown."""
    empty = {'available': False, 'status': 'not-connected', 'heartbeats': [], 'posts': [], 'next_at': None}
    path = Path(path).absolute()
    try:
        if not path.is_file():
            return empty
        if any(part.is_symlink() or (hasattr(part, 'is_junction') and part.is_junction()) for part in [path, *path.parents]):
            return {**empty, 'status': 'temporarily-unavailable'}
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=1)) as db:
            db.row_factory = sqlite3.Row
            for table, columns in _SCHEMA.items():
                actual = {row['name'] for row in db.execute('PRAGMA table_info(' + table + ')')}
                if not columns.issubset(actual):
                    return empty
            heartbeats = []
            for row in db.execute('SELECT at,state,choice,reason,next_at FROM life_heartbeats ORDER BY at DESC,id DESC LIMIT 6'):
                heartbeats.append({'at': _stamp(row['at']), 'state': _word(row['state']), 'choice': _word(row['choice']),
                                   'reason': _reason(row['reason']), 'next_at': _stamp(row['next_at'])})
            posts = []
            for row in db.execute("SELECT id,substr(text,1,1200) AS text,created FROM life_corner_posts WHERE channel='home' AND state='published' ORDER BY created DESC,id DESC LIMIT 12"):
                if not isinstance(row['text'], str) or not row['text'].strip():
                    continue
                posts.append({'id': str(row['id'])[:100], 'text': row['text'], 'created': _stamp(row['created'])})
            return {'available': True, 'status': 'connected', 'heartbeats': heartbeats, 'posts': posts,
                    'next_at': heartbeats[0]['next_at'] if heartbeats else None}
    except (OSError, sqlite3.Error, ValueError, TypeError):
        return {**empty, 'status': 'temporarily-unavailable'}

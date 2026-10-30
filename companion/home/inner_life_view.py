"""Read-only operational summary; never returns conversations or evidence bodies."""
import json
import re
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path

_NOTICE = 'Last source-linked self-description, not a measurement or a guarantee of the current state.'
_PRIVATE = re.compile(r'<\s*/?\s*think\b|chain[_ -]?of[_ -]?thought|reasoning_content|sender_id|raw_message|private:|私聊原文|聊天原文', re.I)
_STATES = {'queued', 'sending', 'sent', 'uncertain', 'discarded'}


class _Unavailable(Exception):
    def __init__(self, status):
        self.status = status


def _stamp(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 253402300799000 else None


def _short(value, size):
    if not isinstance(value, str) or _PRIVATE.search(value):
        return None
    value = ' '.join(value.split())
    value = re.sub(r'https?://\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '…', value)
    value = re.sub(r'(?<!\d)\d{5,20}(?!\d)', '…', value)
    return (value if len(value) <= size else value[:size - 1] + '…') or None


@contextmanager
def _database(path, table, columns):
    try:
        path = Path(path).absolute()
        if not path.is_file():
            raise _Unavailable('not-connected')
        if any(part.is_symlink() or (hasattr(part, 'is_junction') and part.is_junction()) for part in [path, *path.parents]):
            raise _Unavailable('temporarily-unavailable')
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=1)) as db:
            db.row_factory = sqlite3.Row
            actual = {row['name'] for row in db.execute('PRAGMA table_info(' + table + ')')}
            if not columns.issubset(actual):
                raise _Unavailable('not-connected')
            yield db
    except _Unavailable:
        raise
    except (OSError, sqlite3.Error, ValueError, TypeError):
        raise _Unavailable('temporarily-unavailable') from None


def _inner_state(db, now):
    empty = {'available': True, 'status': 'connected', 'state': None, 'notice': _NOTICE}
    row = db.execute("SELECT value,evidence,at,revision FROM self_state WHERE kind='mood' AND key='inner-life' ORDER BY revision DESC LIMIT 1").fetchone()
    if row is None:
        return empty
    try:
        value, refs = json.loads(row['value']), json.loads(row['evidence'])
        if not isinstance(value, dict):
            raise ValueError
        if 'active' in value and not isinstance(value['active'], bool):
            raise ValueError
        if value.get('active') is False:
            return empty
        mood, at = _short(value.get('mood'), 240), _stamp(row['at'])
        revision = row['revision']
        if not mood or value.get('energy') not in {'low', 'steady', 'high'} or value.get('curiosity') not in {'quiet', 'curious', 'absorbed'} or at is None or at > now or not isinstance(revision, int) or revision < 1 or not isinstance(refs, list):
            raise ValueError
        return {**empty, 'state': {'mood': mood, 'energy': value['energy'], 'curiosity': value['curiosity'],
                                  'at': at, 'revision': revision, 'evidence_count': len(refs)}}
    except (TypeError, ValueError, KeyError):
        # Do not turn an unreadable latest state into an apparently current older one.
        return {**empty, 'available': False, 'status': 'invalid-latest-state'}


def _interests(db, now):
    result = {'available': True, 'status': 'connected', 'items': [], 'notice': _NOTICE}
    rows = db.execute("""SELECT s.key,s.value,s.at FROM self_state s WHERE s.kind='interest'
        AND s.revision=(SELECT max(v.revision) FROM self_state v WHERE v.kind=s.kind AND v.key=s.key)
        ORDER BY s.at DESC,s.key""")
    for row in rows:
        try:
            value, at = json.loads(row['value']), _stamp(row['at'])
            if isinstance(value, dict):
                if value.get('active') is False or 'active' in value and not isinstance(value['active'], bool):
                    continue
                value = value.get('interpretation')
            text, key = _short(value, 160), _short(row['key'], 100)
            if not text or not key or at is None or at > now:
                continue
            result['items'].append({'key': key, 'interpretation': text, 'at': at})
            if len(result['items']) == 5:
                break
        except (TypeError, ValueError):
            continue
    return result


def _sharing(path, now):
    result = {'available': False, 'status': 'not-connected', 'counts': None,
              'recipients': {role: {'available': False, 'updated': None, 'state': None} for role in ('family', 'father', 'mother')}}
    try:
        with _database(path, 'life_share_intents', {'id', 'state', 'updated', 'recipient'}) as db:
            counts = {}
            for row in db.execute('SELECT state,count(*) AS n FROM life_share_intents GROUP BY state'):
                state = row['state'] if row['state'] in _STATES else 'unknown'
                counts[state] = counts.get(state, 0) + row['n']
            recipients = {}
            for role in result['recipients']:
                row = db.execute('SELECT state,updated FROM life_share_intents WHERE recipient=? ORDER BY updated DESC,id DESC LIMIT 1', (role,)).fetchone()
                valid = row is None or _stamp(row['updated']) is not None and row['updated'] <= now and row['state'] in _STATES
                recipients[role] = {'available': valid, 'updated': row['updated'] if valid and row else None, 'state': row['state'] if valid and row else None}
            return {'available': True, 'status': 'connected', 'counts': counts, 'recipients': recipients}
    except _Unavailable as error:
        return {**result, 'status': error.status}


def _availability(path, policy, now):
    empty = lambda: {'available': False, 'active': None, 'expires': None, 'at': None}
    result = {'available': False, 'status': 'not-connected', 'father': empty(), 'mother': empty()}
    try:
        with _database(path, 'proactive_availability', {'scope', 'active', 'expires', 'source_time'}) as db:
            result.update(available=True, status='connected')
            for role in ('father', 'mother'):
                person = policy.get(role + '_id') if isinstance(policy, dict) else None
                if not isinstance(person, (str, int)) or isinstance(person, bool) or not re.fullmatch(r'\d{5,15}', str(person)):
                    continue
                row = db.execute('SELECT active,expires,source_time FROM proactive_availability WHERE scope=?', ('private:' + str(person),)).fetchone()
                if row is None:
                    result[role] = {'available': True, 'active': False, 'expires': None, 'at': None}
                    continue
                expires, at = row['expires'], _stamp(row['source_time'])
                if row['active'] not in (0, 1) or expires is not None and _stamp(expires) is None or at is None or at > now:
                    continue
                result[role] = {'available': True, 'active': bool(row['active']) and (expires is None or now < expires), 'expires': expires, 'at': at}
            return result
    except _Unavailable as error:
        return {**result, 'available': False, 'status': error.status, 'father': empty(), 'mother': empty()}


def inner_life_view(experience_path, social_path, life_path, policy, now_ms):
    """No table creation, writes, API calls, credentials, raw evidence or QQ bodies."""
    unknown_state = {'available': False, 'status': 'not-connected', 'state': None, 'notice': _NOTICE}
    unknown_interests = {'available': False, 'status': 'not-connected', 'items': [], 'notice': _NOTICE}
    now = _stamp(now_ms)
    if now is None:
        return {'inner_state': {**unknown_state, 'status': 'invalid-time'}, 'interests': {**unknown_interests, 'status': 'invalid-time'},
                'sharing': {'available': False, 'status': 'invalid-time', 'counts': None,
                            'recipients': {role: {'available': False, 'updated': None, 'state': None} for role in ('family', 'father', 'mother')}},
                'availability': {'available': False, 'status': 'invalid-time', 'father': {'available': False, 'active': None, 'expires': None, 'at': None}, 'mother': {'available': False, 'active': None, 'expires': None, 'at': None}}}
    try:
        with _database(experience_path, 'self_state', {'kind', 'key', 'revision', 'value', 'evidence', 'at'}) as db:
            state, interests = _inner_state(db, now), _interests(db, now)
    except _Unavailable as error:
        state, interests = {**unknown_state, 'status': error.status}, {**unknown_interests, 'status': error.status}
    return {'inner_state': state, 'interests': interests, 'sharing': _sharing(life_path, now), 'availability': _availability(social_path, policy, now)}

"""Read-only public life metadata and explicitly published home posts."""
import re
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

_SCHEMA = {
    'life_heartbeats': {'id', 'at', 'state', 'choice'},
    'life_corner_posts': {'id', 'text', 'created', 'channel', 'state'},
    'life_settings': {'key', 'value'},
    'activities': {'id', 'state', 'created', 'updated'},
    'discoveries': {'id', 'activity', 'at'},
    'life_reading_evidence': {'discovery', 'activity', 'level'},
    'life_progress_attempts': {'activity', 'tool', 'status', 'reason_category', 'at'},
}
_PRIVATE_MARKERS = re.compile(r'<\s*/?\s*think\b|chain[_ -]?of[_ -]?thought|reasoning_content|sender_id|raw_message|private:|私聊原文|聊天原文', re.I)
_CREDENTIAL = re.compile(r'\bsk-[A-Za-z0-9_-]{12,}|\b(?:gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{20,})|-----BEGIN .*PRIVATE KEY|Bearer\s+[A-Za-z0-9._~+/-]{12,}|(?:api[_-]?key|access[_-]?token|password|secret|cookie)\s*[:=]\s*["\']?[A-Za-z0-9._~+/-]{8,}', re.I)
_STATES = {'finished', 'thinking', 'planning', 'reading', 'completed', 'quiet', 'failed', 'interrupted', 'unfinished', 'paused'}
_CHOICES = {'create', 'rest', 'quiet', 'explore', 'exploration', 'journal', 'reflect', 'review', 'share', 'corner', 'publish', 'later', 'discard', 'keep_quiet'}
_OUTCOMES = {'kept-private-or-quiet', 'creative-space-checked', 'creative-workspace-updated', 'creative-continuation-saved', 'life-reflection-saved', 'sent', 'saved-share-deferred', 'uncertain-no-retry', 'failed', 'interrupted', 'finished', 'published', 'kept-private-after-expression'}
_LEVELS = {'search-lead', 'page-text', 'thread-posts', 'subtitles', 'speech-transcript', 'sampled-frames', 'metadata-only'}
_ATTEMPTS = {'ok', 'empty', 'partial', 'failed', 'unavailable', 'unconfigured', 'interrupted'}
_REASONS = {'access-unavailable', 'rate-limited', 'timeout', 'interrupted', 'reader-unavailable', 'unsupported-source', 'no-usable-source'}
_TOOLS = {'public_fetch', 'public_search', 'bilibili_read', 'bilibili_listen', 'bilibili_search', 'bilibili_status', 'tieba_status', 'tieba_list', 'tieba_thread', 'tieba_floor'}
_TZ = timezone(timedelta(hours=8))


def _stamp(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 253402271999999 else None


def _enum(value, allowed):
    return value if isinstance(value, str) and value in allowed else 'unknown'


def _observed(column):
    return "typeof(" + column + ")='integer' AND " + column + '>=0 AND ' + column + '<=?'


def _public_text(value):
    # Only a deliberate published home post may carry body text. Internal
    # reasons and summaries stay out; the remaining output is enums/counts/time.
    if not isinstance(value, str) or not value.strip() or _PRIVATE_MARKERS.search(value) or _CREDENTIAL.search(value):
        return None
    return value[:1200]


def _counts(rows, allowed):
    result = {}
    for row in rows:
        key = _enum(row[0], allowed)
        result[key] = result.get(key, 0) + row[1]
    return result


def _facts(db, schema, activity, now):
    levels = None
    if schema['discoveries']:
        reading = schema['life_reading_evidence']
        field = "COALESCE(r.level,'unknown')" if reading else "'unknown'"
        join = ' LEFT JOIN life_reading_evidence r ON r.discovery=d.id AND r.activity=d.activity' if reading else ''
        rows = db.execute('SELECT ' + field + ',count(*) FROM discoveries d' + join + ' WHERE d.activity=? AND ' + _observed('d.at') + ' GROUP BY 1', (activity, now))
        levels = _counts(rows, _LEVELS)
    attempts = None
    if schema['life_progress_attempts']:
        attempts = _counts(db.execute('SELECT status,count(*) FROM life_progress_attempts WHERE activity=? AND ' + _observed('at') + ' GROUP BY status', (activity, now)), _ATTEMPTS)
    return {'saved_source_count': sum(levels.values()) if levels is not None else None, 'reading_levels': levels, 'attempt_counts': attempts}


def life_view(path, now_ms=None):
    """No writes, creation, source bodies, diary queries or similarity scoring."""
    now = _stamp(int(time.time() * 1000) if now_ms is None else now_ms)
    empty = {'available': False, 'status': 'not-connected', 'heartbeats': [], 'posts': [], 'activities': [], 'attempts': [],
             'next_at': None, 'schedule_state': 'unknown', 'schedule_source': None, 'last_recorded_at': None, 'last_recorded_day': None, 'observed_at': now}
    if now is None:
        return {**empty, 'status': 'invalid-time'}
    path = Path(path).absolute()
    try:
        if not path.is_file():
            return empty
        if any(part.is_symlink() or (hasattr(part, 'is_junction') and part.is_junction()) for part in [path, *path.parents]) or path.stat().st_nlink > 1:
            return {**empty, 'status': 'temporarily-unavailable'}
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=1)) as db:
            db.row_factory = sqlite3.Row
            columns = {name: {row['name'] for row in db.execute('PRAGMA table_info(' + name + ')')} for name in _SCHEMA}
            schema = {name: required.issubset(columns[name]) for name, required in _SCHEMA.items()}
            if not schema['life_heartbeats'] or not schema['life_corner_posts']:
                return empty
            # run/rest write this authoritative due time. heartbeat.next_at is
            # only an old turn's snapshot and must never be a fallback.
            due = None
            if schema['life_settings']:
                row = db.execute("SELECT value FROM life_settings WHERE key='next'").fetchone()
                raw = row['value'] if row else None
                if isinstance(raw, str) and re.fullmatch(r'\d{1,15}', raw):
                    due = _stamp(int(raw))
                elif isinstance(raw, int):
                    due = _stamp(raw)
            result_field = "CASE WHEN json_valid(result) THEN json_extract(result,'$.status') ELSE NULL END" if 'result' in columns['life_heartbeats'] else 'NULL'
            heartbeats = []
            for row in db.execute('SELECT id,at,state,choice,' + result_field + ' AS outcome FROM life_heartbeats WHERE ' + _observed('at') + ' ORDER BY at DESC,rowid DESC LIMIT 6', (now,)):
                facts = _facts(db, schema, row['id'], now)
                activity = db.execute('SELECT state FROM activities WHERE id=? AND ' + _observed('updated'), (row['id'], now)).fetchone() if schema['activities'] else None
                heartbeats.append({'at': row['at'], 'state': _enum(row['state'], _STATES), 'choice': _enum(row['choice'], _CHOICES),
                                   'outcome': _enum(row['outcome'], _OUTCOMES), 'activity_state': _enum(activity['state'], _STATES) if activity else None, **facts})
            posts = []
            for row in db.execute("SELECT text,created FROM life_corner_posts WHERE channel='home' AND state='published' AND " + _observed('created') + ' ORDER BY created DESC,rowid DESC LIMIT 12', (now,)):
                body = _public_text(row['text'])
                if body is not None:
                    posts.append({'text': body, 'created': row['created']})
            activities = []
            if schema['activities']:
                for row in db.execute('SELECT id,state,created,updated FROM activities WHERE ' + _observed('updated') + ' ORDER BY updated DESC,rowid DESC LIMIT 6', (now,)):
                    facts = _facts(db, schema, row['id'], now)
                    heartbeat = db.execute('SELECT choice,' + result_field + ' AS outcome FROM life_heartbeats WHERE id=? AND ' + _observed('at'), (row['id'], now)).fetchone()
                    choice = _enum(heartbeat['choice'], _CHOICES) if heartbeat else 'unknown'
                    outcome = _enum(heartbeat['outcome'], _OUTCOMES) if heartbeat else 'unknown'
                    creative = {'creative-space-checked': 'space-opened', 'creative-workspace-updated': 'saved-step', 'creative-continuation-saved': 'partial-step-saved'}.get(outcome)
                    kind = 'create' if creative or choice == 'create' else 'explore' if choice in {'explore', 'exploration'} or facts['saved_source_count'] or facts['attempt_counts'] else 'other'
                    activities.append({'kind': kind, 'state': _enum(row['state'], _STATES), 'created': row['created'] if _stamp(row['created']) is not None and row['created'] <= now else None,
                                       'updated': row['updated'], 'creative_step': creative, 'execution_verified': None, **facts})
            attempts = []
            if schema['life_progress_attempts']:
                for row in db.execute('SELECT tool,status,reason_category,at FROM life_progress_attempts WHERE ' + _observed('at') + ' ORDER BY at DESC,rowid DESC LIMIT 6', (now,)):
                    attempts.append({'tool': _enum(row['tool'], _TOOLS), 'status': _enum(row['status'], _ATTEMPTS), 'reason_category': _enum(row['reason_category'], _REASONS) if row['reason_category'] else None, 'at': row['at']})
            latest = []
            for name, field in [('life_heartbeats', 'at'), ('life_corner_posts', 'created'), ('activities', 'updated'), ('discoveries', 'at'), ('life_progress_attempts', 'at')]:
                if schema[name]:
                    stamp = db.execute('SELECT max(' + field + ') FROM ' + name + ' WHERE ' + _observed(field), (now,)).fetchone()[0]
                    if stamp is not None:
                        latest.append(stamp)
            last = max(latest) if latest else None
            return {**empty, 'available': True, 'status': 'connected', 'heartbeats': heartbeats, 'posts': posts, 'activities': activities, 'attempts': attempts,
                    'next_at': due, 'schedule_source': 'life_settings' if due is not None else None, 'schedule_state': 'unknown' if due is None else 'scheduled' if due > now else 'due',
                    'last_recorded_at': last, 'last_recorded_day': datetime.fromtimestamp(last / 1000, _TZ).date().isoformat() if last is not None else None,
                    'coverage': {'activity_metadata_available': schema['activities'], 'attempt_metadata_available': schema['life_progress_attempts'], 'reading_levels_available': schema['life_reading_evidence'],
                                 'recent_limit': 6, 'private_text_included': False, 'creative_execution_available': False,
                                 'notice': 'Recent saved status only. Source rows are not unique materials or proof of new understanding. Creative execution receipts remain in the workroom.'}}
    except (OSError, sqlite3.Error, ValueError, TypeError, OverflowError):
        return {**empty, 'status': 'temporarily-unavailable'}

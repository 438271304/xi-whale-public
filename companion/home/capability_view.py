"""Capability wiring and saved result metadata; never probes a tool or a network."""
import sqlite3
import time
from contextlib import closing
from pathlib import Path


_CATALOG = {
    'public_web': ('公开网页', '公开网页正文与搜索线索；链接可达性逐次确认。'),
    'ordinary_tieba': ('普通贴吧', '普通贴吧未获全站访问验证；Claw 的成功不代表普通贴吧。'),
    'claw': ('Claw 帖子', '固定官方 Claw 只读入口；专用凭据，不代表普通贴吧全站。'),
    'bilibili_subtitles': ('B站字幕', '仅平台实际提供的公开字幕；标题和简介不算已读字幕。'),
    'bilibili_frames': ('B站抽帧', '至多两张实际抽帧的识图；不代表看完整视频。'),
    'bilibili_speech': ('B站语音转写', '实际选定时间窗的机器语音文字；不理解音乐、鲸鸣或整段音效。'),
    'bilibili_comments': ('B站评论', '公开评论的有限页与楼中楼，保留作者、原时间和回复关系；不代表读完评论区或看过视频。'),
    'qzone_read': ('自己的空间', '固定自己账号的帖子和评论读取；未下载图片不算看过图片。'),
    'qzone_publish': ('空间发表', '自己的纯文字草稿及内容读回确认；可见范围未独立验证。'),
    'own_workshop': ('自己的作品', '可保存自己的作品草稿；运行另需执行器就绪，排队和检查不算完成。'),
    'proactive_faces': ('主动原生表情', '向已授权对象交流时与正文同次发送；每次仍检查时段、对象和好友状态。'),
    'proactive_images': ('主动公共图片', '仅已验证公共来源图片，与正文同次发送；不借用私聊图片。'),
    'own_profile': ('自己的QQ资料', '自己账号的昵称、签名和头像；时间是操作开始记录，不是完成时刻。'),
    'qq_voice': ('QQ语音文字', '当前收到或直接引用的语音，在本机转写至多五分钟；保留发送者和原时间，可能有误识，不代表听懂音乐或声音情绪。'),
}
_RUNTIME_CODES = {'service-closed', 'service-paused', 'route-not-ready', 'adapter-not-connected',
                  'credential-reader-not-configured', 'reader-not-connected', 'frame-dependencies-unavailable',
                  'speech-dependencies-unavailable', 'workshop-paused', 'workshop-runtime-unavailable'}
_REASONS = {'access-unavailable', 'rate-limited', 'timeout', 'interrupted', 'reader-unavailable',
            'unsupported-source', 'no-usable-source'}
_QZONE_CODES = {'identity-mismatch', 'login-error', 'api-error', 'invalid-response', 'readback-unconfirmed',
                'paused', 'closed', 'not-authorized', 'context-denied', 'service-restart-after-send-reservation'}
_TOOLS = {'public_fetch': ('public_web',), 'public_search': ('public_web',),
          'tieba_list': ('claw',), 'tieba_thread': ('claw',), 'tieba_floor': ('claw',),
          'bilibili_read': ('bilibili_subtitles', 'bilibili_frames'), 'bilibili_listen': ('bilibili_speech',),
          'bilibili_comments': ('bilibili_comments',)}


def _time(value):
    return value if type(value) is int and 0 <= value <= 253402271999999 else None


def _observed(column):
    return "typeof(" + column + ")='integer' AND " + column + '>=0 AND ' + column + '<=?'


def _json(column, path):
    # Only a fixed scalar path crosses the SQLite boundary, never raw payloads.
    return "CASE WHEN json_valid(" + column + ") THEN json_extract(" + column + ",'" + path + "') END"


def _has(db, name, columns):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone():
        return False
    return set(columns).issubset({row[1] for row in db.execute('PRAGMA table_info(' + name + ')')})


def _latest(db, table, column, condition, args, now):
    return db.execute('SELECT ' + column + ' FROM ' + table + ' WHERE ' + _observed(column) +
                      ' AND (' + condition + ') ORDER BY ' + column + ' DESC LIMIT 1', (now, *args)).fetchone()


def capability_view(root, runtime=None, now_ms=None):
    """root is the existing scoped-chat directory; runtime is qq_route.capabilities.

    available is current wiring/local readiness, not a fresh platform guarantee.
    A latest-attempt blocker remains dated historical evidence. Missing records
    stay unknown; reading this function creates no store and records no activity.
    """
    now = _time(int(time.time() * 1000) if now_ms is None else now_ms)
    runtime = runtime if isinstance(runtime, dict) else {}
    at = _time(runtime.get('observed_at'))
    current = now is not None and at is not None and 0 <= now - at <= 60_000
    live = runtime.get('items') if current and isinstance(runtime.get('items'), dict) else {}
    items = {}
    for key, (label, scope) in _CATALOG.items():
        raw = live.get(key) if isinstance(live.get(key), dict) else {}
        config = {field: raw.get(field) if type(raw.get(field)) is bool else None
                  for field in ('configured', 'available', 'autonomous')}
        code = raw.get('blocker')
        items[key] = {'key': key, 'label': label, 'configuration': {**config, 'observed_at': at if raw else None},
                      'last_success': None, 'last_failure': None,
                      'blocker': {'code': code, 'observed_at': at, 'basis': 'runtime'} if isinstance(code, str) and code in _RUNTIME_CODES else None,
                      'scope': scope, 'history_available': False}
    if now is None:
        return {'observed_at': None, 'status': 'unavailable', 'items': list(items.values())}

    def history(keys):
        for key in keys:
            items[key]['history_available'] = True

    def record(key, stamp, value, failed=False):
        if _time(stamp) is None or stamp > now:
            return
        field = 'last_failure' if failed else 'last_success'
        old = items[key][field]
        if old is None or stamp > old['at']:
            items[key][field] = {'at': stamp, 'code' if failed else 'kind': value}

    def life(db):
        if _has(db, 'life_progress_attempts', ['tool', 'status', 'reason_category', 'at']):
            history({key for keys in _TOOLS.values() for key in keys})
            # Bounded metadata per reader, with success/failure queried separately.
            for tool, keys in _TOOLS.items():
                row = db.execute("SELECT at,reason_category FROM life_progress_attempts WHERE tool=? AND status IN ('failed','unavailable','unconfigured','interrupted','empty','partial') AND " + _observed('at') + ' ORDER BY at DESC LIMIT 1', (tool, now)).fetchone()
                if row:
                    for key in keys:
                        record(key, row[0], row[1] if row[1] in _REASONS else 'reader-attempt-failed', True)
        if _has(db, 'discoveries', ['id', 'activity', 'at']) and _has(db, 'life_reading_evidence', ['discovery', 'activity', 'tool', 'level']):
            for key, tool, level in [('public_web', 'public_fetch', 'page-text'), ('public_web', 'public_search', 'search-lead'),
                                     ('claw', 'tieba_thread', 'thread-posts'), ('claw', 'tieba_floor', 'thread-posts'),
                                     ('claw', 'tieba_list', 'search-lead'), ('bilibili_subtitles', 'bilibili_read', 'subtitles'),
                                     ('bilibili_frames', 'bilibili_read', 'sampled-frames'), ('bilibili_speech', 'bilibili_listen', 'speech-transcript'),
                                     ('bilibili_comments', 'bilibili_comments', 'public-comments')]:
                history([key])
                row = db.execute('SELECT d.at FROM discoveries d JOIN life_reading_evidence r ON r.discovery=d.id AND r.activity=d.activity WHERE r.tool=? AND r.level=? AND ' + _observed('d.at') + ' ORDER BY d.at DESC LIMIT 1', (tool, level, now)).fetchone()
                if row:
                    record(key, row[0], level)
        if _has(db, 'life_share_intents', ['state', 'updated', 'media_plan', 'receipt']):
            for key, selector in [('proactive_faces', "json_type(media_plan,'$.native_face_ids')='array' AND json_array_length(media_plan,'$.native_face_ids')>0"),
                                   ('proactive_images', "json_type(media_plan,'$.public_image_id')='text'")]:
                history([key])
                media = "CASE WHEN json_valid(media_plan) THEN (" + selector + ') ELSE 0 END'
                # Actual sent state and returned numeric message receipt; no target/ID is emitted.
                success = "state='sent' AND " + media + ' AND ' + _json('receipt', '$.transport_returned') + '=1 AND typeof(' + _json('receipt', '$.message_id') + ")='integer'"
                row = _latest(db, 'life_share_intents', 'updated', success, (), now)
                if row:
                    record(key, row[0], 'media-delivery')
                row = _latest(db, 'life_share_intents', 'updated', "state='uncertain' AND " + media, (), now)
                if row:
                    record(key, row[0], 'delivery-uncertain', True)

    def bilibili(db):
        if _has(db, 'public_comment_pages', ['result', 'at']):
            history(['bilibili_comments'])
            # Only fixed metadata leaves the store. Empty pages do not establish
            # comment reading, and a cached result is not a current access probe.
            count = _json('result', '$.read_scope.retained_comment_count')
            row = _latest(db, 'public_comment_pages', 'at',
                          _json('result', '$.status') + "='ok' AND " +
                          _json('result', '$.evidence_level') + "='public-comments' AND typeof(" + count + ")='integer' AND " + count + '>0', (), now)
            if row:
                record('bilibili_comments', row[0], 'public-comments')
        if _has(db, 'public_videos', ['result', 'at']):
            history(['bilibili_subtitles', 'bilibili_frames'])
            safe = "CASE WHEN json_valid(result) THEN result ELSE '{}' END"
            for key, condition, kind in [
                ('bilibili_subtitles', _json('result', '$.content.subtitle_read') + '=1', 'subtitles'),
                ('bilibili_frames', "json_type(" + safe + ", '$.content.sampled_frames')='array' AND EXISTS(SELECT 1 FROM json_each(" + safe + ", '$.content.sampled_frames') f WHERE " + _json('f.value', '$.status') + "='vision-ok')", 'sampled-frames')]:
                row = _latest(db, 'public_videos', 'at', _json('result', '$.status') + "='ok' AND (" + condition + ')', (), now)
                if row:
                    record(key, row[0], kind)
            for key, codes in [('bilibili_subtitles', ['subtitle-login-required', 'no-public-subtitle']),
                               ('bilibili_frames', ['video-decoder-unavailable', 'frame-vision-unavailable', 'public-single-file-stream-unavailable', 'public-media-exceeds-64MB'])]:
                for code in codes:
                    row = _latest(db, 'public_videos', 'at', "EXISTS(SELECT 1 FROM json_each(" + safe + ", '$.limitations') WHERE type='text' AND value=?)", (code,), now)
                    if row:
                        record(key, row[0], code, True)
        if _has(db, 'public_video_speech', ['result', 'at']):
            history(['bilibili_speech'])
            row = _latest(db, 'public_video_speech', 'at', _json('result', '$.status') + "='ok' AND " + _json('result', '$.evidence_level') + "='speech-transcript'", (), now)
            if row:
                record('bilibili_speech', row[0], 'speech-transcript')

    def qzone(db):
        if _has(db, 'qzone_reads', ['result', 'at']):
            history(['qzone_read'])
            row = _latest(db, 'qzone_reads', 'at', _json('result', '$.ok') + '=1 AND ' + _json('result', '$.state') + "='read'", (), now)
            if row:
                record('qzone_read', row[0], 'own-space-read')
        if _has(db, 'qzone_operations', ['state', 'updated']):
            history(['qzone_publish'])
            row = _latest(db, 'qzone_operations', 'updated', "state='verified'", (), now)
            if row:
                record('qzone_publish', row[0], 'publication-verified')
            for state in ['uncertain', 'failed-before-send']:
                row = _latest(db, 'qzone_operations', 'updated', 'state=?', (state,), now)
                if row:
                    record('qzone_publish', row[0], state, True)
        # The existing read status only keeps the latest failure, not a full log.
        if _has(db, 'qzone_meta', ['key', 'value']):
            for name, key in [('read', 'qzone_read'), ('publication', 'qzone_publish')]:
                history([key])
                row = db.execute('SELECT ' + ','.join(_json('value', path) for path in ['$.observed_at', '$.state', '$.code']) + ' FROM qzone_meta WHERE key=?', (name,)).fetchone()
                if row and row[1] not in ('read', 'verified', 'sending'):
                    record(key, row[0], row[2] if row[2] in _QZONE_CODES else 'platform-read-failed', True)

    def workshop(db):
        if not _has(db, 'workshop_jobs', ['scope', 'requester', 'source_event', 'state', 'updated']):
            return
        history(['own_workshop'])
        # Same attribution as LifeWorkshop. No other chat/project rows are output.
        own = "scope='private-'||requester AND source_event LIKE 'life:%'"
        row = _latest(db, 'workshop_jobs', 'updated', own + " AND state='completed'", (), now)
        if row:
            record('own_workshop', row[0], 'workshop-completed')
        for state in ['failed', 'blocked', 'conflict', 'interrupted']:
            row = _latest(db, 'workshop_jobs', 'updated', own + ' AND state=?', (state,), now)
            if row:
                record('own_workshop', row[0], state, True)

    def profile(db):
        if not _has(db, 'qq_self_operations', ['state', 'at']):
            return
        history(['own_profile'])
        row = _latest(db, 'qq_self_operations', 'at', "state='verified'", (), now)
        if row:
            record('own_profile', row[0], 'profile-readback')
        for state in ['failed-or-uncertain', 'readback-uncertain', 'failed-before-send']:
            row = _latest(db, 'qq_self_operations', 'at', 'state=?', (state,), now)
            if row:
                record('own_profile', row[0], state, True)

    def voice(db):
        if not _has(db, 'qq_voice_observations', ['status', 'reason', 'observed_at']):
            return
        history(['qq_voice'])
        row = _latest(db, 'qq_voice_observations', 'observed_at', "status='transcribed'", (), now)
        if row:
            record('qq_voice', row[0], 'speech-transcript')
        row = db.execute("SELECT observed_at,status,reason FROM qq_voice_observations WHERE status!='transcribed' AND " + _observed('observed_at') + ' ORDER BY observed_at DESC LIMIT 1', (now,)).fetchone()
        if row:
            codes = {'duration-over-limit', 'decoder-unavailable', 'voice-read-or-transcription-failed', 'wav-base64-unavailable', 'invalid-wav', 'invalid-transcript'}
            record('qq_voice', row[0], row[2] if row[2] in codes else 'speech-not-fully-transcribed', True)

    unreadable = False
    for name, reader in [('life.sqlite3', life), ('bilibili.sqlite3', bilibili), ('qzone.sqlite3', qzone),
                         ('workshop.sqlite3', workshop), ('qq-self-profile.sqlite3', profile), ('qq-voice.sqlite3', voice)]:
        path = (Path(root) / name).absolute()
        try:
            if not path.is_file():
                continue
            if path.stat().st_nlink > 1 or any(p.is_symlink() or (hasattr(p, 'is_junction') and p.is_junction()) for p in [path, *path.parents]):
                unreadable = True
                continue
            with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=1)) as db:
                reader(db)
        except (OSError, sqlite3.Error):
            unreadable = True
    for item in items.values():
        failure, success = item['last_failure'], item['last_success']
        if item['blocker'] is None and failure and (success is None or failure['at'] > success['at']):
            item['blocker'] = {'code': failure['code'], 'observed_at': failure['at'], 'basis': 'latest-attempt'}
    any_history = any(item['history_available'] for item in items.values())
    return {'observed_at': now, 'status': 'ok' if current and not unreadable else 'partial' if current or any_history else 'unavailable',
            'items': list(items.values())}

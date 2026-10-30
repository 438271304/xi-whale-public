"""Export an explicitly pinned, sanitized engineering archive. Never touches runtime.

Initialize the reviewed allowlist once with --initialize-manifest. Subsequent runs
require unchanged source hashes and unchanged previously generated outputs. New
source files are not discovered or admitted by ordinary exports. No networking,
service startup, credential reading, Git operations, or deletion is performed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'config/whale-engineering-export.json'
DEST = ROOT / 'delivery/xi-engineering'
REPORT = ROOT / 'hub/reports/HUB-WHALE-GITHUB-20261030.inventory.json'
ROOTS = {
    'project': ROOT,
    'dsh': Path('D:/Deepseek'),
    'vendor_app': Path.home() / 'PersonalAgentBackups/companion-runtime/clean-lab-0.2.8/resources/app',
}
INITIAL_ROOT = '''archive.py audio-worker.cjs avatar-fingerprint.py bilibili-links.mjs
bilibili-public.mjs bilibili-speech.mjs budget.py cognition-tools.mjs
conversation-capabilities.mjs conversation-errors.mjs conversation-extras.mjs
conversation-floor.mjs conversation-focus.mjs conversation-intent.mjs
conversation-listening.mjs conversation-presentation.mjs conversation-scope.mjs
conversation-service.mjs conversation-time.mjs core-output-recovery.ts curiosity-life.mjs
deepseek-public-search.mjs dsh-context.mjs ensure-dsh-gateway.ps1 event-ledger.mjs
experience-attribution.mjs experience-memory.mjs experience-reflection.mjs
exploration-followups.mjs fisharchive-stickers.mjs forward-intake.mjs generation-options.mjs
group-batch.mjs group-message.mjs guard.py guarded-client.mjs guardian-persona.mjs
history-coverage.mjs home-tools.mjs image-analysis.mjs install-video-decoder.mjs
isolated-qq-route.mjs journal-context.mjs life-contact.mjs life-continuity.mjs
life-heartbeat.mjs life-journal.mjs life-recollection.mjs life-self-reflection.mjs
life-workshop.mjs local-image-ocr.ps1 migrate-scoped-history.mjs portable-snapshot.py
private-conversation.mjs proactive-availability.mjs provider-diagnostics.mjs
public-exploration.mjs public-reading.mjs qq-bubbles.mjs qq-connection-health.ps1
qq-context.mjs qq-event-policy.mjs qq-face-output.mjs qq-forward.mjs qq-history-fetch.mjs
qq-image-download.mjs qq-readonly-client.mjs qq-recall.mjs qq-scoped-attachments.mjs
qq-segment-details.mjs qq-self-avatar.mjs qq-self-profile.mjs qq-self-qzone.mjs
qzone-experiences.mjs qzone-readback.mjs route-lifecycle.mjs run-whale.mjs
scoped-assembly.mjs scoped-history.mjs scoped-media.mjs scoped-route-manager.mjs
scoped-send.mjs scoped-tools.mjs social-rhythm.mjs start-independent.ps1 start-whale.ps1
stop-whale.ps1 tieba-claw.mjs video-audio.mjs video-frames.mjs workroom-admin.mjs
workroom.mjs workshop-dsh.mjs workshop-native.mjs workshop.mjs'''.split()
TEST_EXCLUDES = {
    'test-installed-native.mjs', 'test-installed-persona.mjs', 'test-installed-provider.mjs',
    'test-installed-qq.mjs', 'test-candidate-qq-boot.mjs', 'test-isolated-boot.mjs',
    'test-prepare-image.py',
}
HOME_FILES = '''app.js bundle_workroom.cjs conversation_status.py index.html
inner_life_view.py interactive_workroom.py life_view.py qq_health.py server.py start.ps1
style.css test_interactive_workroom.py workroom_view.py'''.split()
IDENTITY_FILES = '''CONSTITUTION.md EXPRESSION.md SCOPED_OPERATIONS.md
SCOPED_PROFILE.md SELF_CORE.md STICKERS.md TOOL_CONTRACT.md'''.split()
CONFIG_FILES = '''policy.json audio-decoder.json video-decoder.json
image-capabilities.json social-config.json'''.split()
DSH_FILES = ['AppContainerRunner.cs', 'budget-proxy.mjs', 'Start-DSH.ps1', 'Stop-DSH.ps1', 'Open-DSH.ps1']
ID_INPUTS = [
    ('project', 'companion/policy.json', 'channels'),
    ('project', 'companion/identity/PARTNER.md', 'numeric-identifiers'),
    ('project', 'companion/identity/RELATIONSHIPS.md', 'numeric-identifiers'),
    ('project', 'companion/prepare-profile.py', 'numeric-identifiers'),
    ('vendor_app', 'guardian/channels.json', 'channels-root'),
]
HISTORICAL_ID_INPUTS = [
    ('test-conversation-floor.mjs', [4, 5]),
    ('test-conversation-time.mjs', [4]),
    ('test-forward-intake.mjs', [6, 8]),
    ('test-journal-context.mjs', [9]),
    ('test-proactive-availability.mjs', [9, 115, 126]),
]
SYNTHETIC_CREDENTIAL = 'sk-test-fixture-not-a-real-key'
RULES = {
    'known-qq-identifiers': 'Known authorized identifiers become consistent synthetic decimal IDs; original values/mapping are never exported.',
    'windows-user-directory': 'Any literal Windows user-directory component becomes USER.',
    'synthetic-test-credential': 'Two reviewed negative-test fixtures retain an unmistakably synthetic test key.',
    'template-label': 'Personal configuration and identity files are emitted as .example templates.',
    'utf8-lf': 'Text is encoded as UTF-8 with LF line endings.',
}
SECRET_PATTERNS = {
    'provider-api-key': re.compile(r'sk-[A-Za-z0-9_-]{12,}'),
    'github-token': re.compile(r'(?:gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{20,})'),
    'private-key-block': re.compile(r'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----'),
    'literal-bearer-token': re.compile(r'Bearer\s+[A-Za-z0-9_+/=-]{24,}', re.I),
    'literal-credential-assignment': re.compile(r'''(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["']?\s*[:=]\s*["']([A-Za-z0-9_+/=-]{24,})["']''', re.I),
}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def safe_relative(value):
    p = PurePosixPath(value)
    if not value or p.is_absolute() or any(part in {'', '.', '..'} for part in value.split('/')) or '\\' in value or ':' in value:
        raise ValueError('Unsafe manifest relative path')
    return p


def checked_path(root, relative):
    safe_relative(relative)
    base = root.resolve(strict=True)
    target = root.joinpath(*PurePosixPath(relative).parts)
    for path in [target, *target.parents]:
        if path == base:
            break
        if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()):
            raise ValueError('Linked source or destination refused: ' + relative)
    if not target.resolve().is_relative_to(base):
        raise ValueError('Path escapes source or destination root')
    return target


def source(entry):
    return checked_path(ROOTS[entry['root']], entry['source'])


def freeze(root, relative, output, kind):
    entry = {'root': root, 'source': relative, 'output': output, 'kind': kind}
    path = source(entry)
    if not path.is_file():
        raise ValueError('Allowlisted source missing: ' + relative)
    entry['source_sha256'] = digest(path.read_bytes())
    entry['transform_rules'] = list(RULES)
    return entry


def initialize():
    if CONFIG.exists():
        raise ValueError('Manifest already exists; initialization never replaces an approved allowlist')
    files = [freeze('project', 'companion/' + name, 'companion/' + name, 'source') for name in INITIAL_ROOT]
    # One-time candidate enumeration only. The resulting exact filenames and hashes
    # are persisted; an ordinary export never executes this discovery step.
    for path in sorted((ROOT / 'companion').iterdir()):
        if path.is_file() and path.name.startswith(('test-', 'test_')) and path.suffix in {'.py', '.mjs', '.ps1', '.cjs'} and path.name not in TEST_EXCLUDES:
            files.append(freeze('project', 'companion/' + path.name, 'companion/' + path.name, 'synthetic-test-source'))
    for name in HOME_FILES:
        files.append(freeze('project', 'companion/home/' + name, 'companion/home/' + name, 'home-source'))
    for name in IDENTITY_FILES:
        files.append(freeze('project', 'companion/identity/' + name, 'companion/identity/' + name + '.example', 'identity-template'))
    for name in CONFIG_FILES:
        files.append(freeze('project', 'companion/' + name, 'companion/' + name + '.example', 'configuration-template'))
    for name in ['qq-face-map.json', 'qq-face-sources.md']:
        files.append(freeze('project', 'companion/' + name, 'companion/' + name, 'public-reference'))
    for name in DSH_FILES:
        files.append(freeze('project', 'companion/dsh/' + name, 'companion/dsh/' + name, 'dsh-source'))
    # These two local integration modules are required by budget-proxy.mjs and
    # exist outside the project mirror. No DSH package or private data is copied.
    for name in ['spending-book.mjs', 'provider-diagnostics.mjs']:
        files.append(freeze('dsh', name, 'companion/dsh/' + name, 'external-integration-source'))
    for name in ['portable_backup.py', 'export_whale_engineering.py']:
        files.append(freeze('project', 'scripts/' + name, 'scripts/' + name, 'recovery-or-export-tool'))
    inputs = []
    for root, relative, selector in ID_INPUTS:
        entry = {'root': root, 'source': relative, 'selector': selector}
        entry['source_sha256'] = digest(source(entry).read_bytes())
        inputs.append(entry)
    for name, lines in HISTORICAL_ID_INPUTS:
        entry = {'root': 'project', 'source': 'companion/' + name,
                 'selector': 'historical-identity-lines', 'lines': lines}
        entry['source_sha256'] = digest(source(entry).read_bytes())
        inputs.append(entry)
    policy = {
        'schema_version': 1,
        'scope': 'Explicit reviewed engineering archive; not an installer or full operational backup.',
        'source_roots': {'project': 'Current project directory', 'dsh': 'D:/Deepseek', 'vendor_app': '%USERPROFILE%/PersonalAgentBackups/companion-runtime/clean-lab-0.2.8/resources/app'},
        'identifier_inputs': inputs,
        'transform_rules': RULES,
        'excluded': ['sources/**', 'live/check/probe/deploy/prepare/report/record/finalize/audit/backfill/history scripts', 'identity/PARTNER.md', 'identity/RELATIONSHIPS.md', 'identity/DECISIONS.md', 'core-social-candidate.ts', 'core-uncap-candidate.ts', 'runtime memories and databases', 'credentials/login/session state', 'assets/artifacts/logs', 'release/verified receipts', 'vendor runtime and binary/model files'],
        'files': sorted(files, key=lambda item: item['output']),
    }
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    with CONFIG.open('xb') as handle:
        handle.write(encoded(policy))
    print(json.dumps({'status': 'allowlist_initialized', 'files': len(files), 'new_files_auto_admitted': False}))


def identifiers(policy):
    values = set()
    historical_values = set()
    def collect(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if re.search(r'(?:_id|_ids|qq|groups|groupIds|botId|userId)$', key, re.I):
                    collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)
        elif re.fullmatch(r'\d{5,12}', str(value)):
            values.add(str(value))
    for entry in policy['identifier_inputs']:
        raw = source(entry).read_bytes()
        if digest(raw) != entry['source_sha256']:
            raise ValueError('Identifier source drift; review manifest: ' + entry['source'])
        text = raw.decode('utf-8-sig')
        if entry['selector'] == 'historical-identity-lines':
            lines = text.splitlines()
            selected = '\n'.join(lines[number - 1] for number in entry['lines'])
            historical_values.update(re.findall(r'(?<![\w])\d{8,11}(?![\w])', selected))
        elif entry['selector'] == 'channels':
            collect(json.loads(text)['channels'])
        elif entry['selector'] == 'channels-root':
            collect(json.loads(text))
        else:
            values.update(value for value in re.findall(r'(?<![\w])\d{8,11}(?![\w])', text) if not re.fullmatch(r'20\d{6}', value))
    # Stable ordering and the pinned identifier-input hashes make repeated exports
    # reproducible. This mapping stays in memory and is never serialized.
    # Append later reviewed historical identifiers so the original five synthetic
    # replacements remain stable. The original values are never serialized.
    ordered = sorted(values, key=lambda value: (len(value), value))
    ordered += sorted(historical_values - values, key=lambda value: (len(value), value))
    return {value: str(900000001 + i) for i, value in enumerate(ordered)}


def transform(entry, raw, mapping):
    text = raw.decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
    applied = {'utf8-lf': 1}
    for old, new in mapping.items():
        text, count = re.subn(r'(?<!\d)' + re.escape(old) + r'(?!\d)', new, text)
        if count:
            applied['known-qq-identifiers'] = applied.get('known-qq-identifiers', 0) + count
    text, count = re.subn(r'(?i)([A-Z]:[/\\]+Users[/\\]+)[^/\\\s"\'<>]+', lambda match: match[1] + 'USER', text)
    if count:
        applied['windows-user-directory'] = count
    if entry['source'] in {'companion/test-life-journal.mjs', 'companion/test-public-exploration.mjs'}:
        def fixture(match):
            # Both pinned files were inspected as rejected-input fixtures. The
            # public-search fixture uses an explicit "secret" dummy label.
            if not re.search(r'fake|example|test|secret|123456|abcdefghijkl', match[0], re.I):
                raise ValueError('Uncertain credential in reviewed test: ' + entry['source'])
            applied['synthetic-test-credential'] = applied.get('synthetic-test-credential', 0) + 1
            return SYNTHETIC_CREDENTIAL
        text = SECRET_PATTERNS['provider-api-key'].sub(fixture, text)
    if entry['kind'] == 'identity-template':
        text = '> 工程存档模板：账号标识已替换为合成值；不是恢复出的真实记忆或关系。\n\n' + text
        applied['template-label'] = 1
    elif entry['kind'] == 'configuration-template':
        applied['template-label'] = 1
    return text.encode('utf-8'), applied


def scan(output, raw):
    text = raw.decode('utf-8')
    findings = []
    for rule, pattern in SECRET_PATTERNS.items():
        for match in pattern.finditer(text):
            if match[0] == SYNTHETIC_CREDENTIAL:
                continue
            findings.append({'file': output, 'rule': rule, 'line': text.count('\n', 0, match.start()) + 1})
    return findings


README = '''# 汐 · 工程存档

这是可追溯、经过脱敏的工程源码存档，尚非一键安装包，也不是运行中的汐。
原工程不受导出操作影响；此目录可作为 GitHub 私有仓库的源码起点。

- 业务模块、核心集成源码、小窝页面、自有 DSH 集成源码与测试源码按显式允许清单保存。
- 账号与群标识被一致替换成合成数字；Windows 用户目录改为 USER。
- 配置和人格材料均以 `.example` 保存。真实关系、决策历史、私人记忆与聊天未打包。
- 不包含 API 密钥、QQ 登录态、恢复密钥、运行数据库、日志、第三方程序、二进制模型或图片素材。
- `EXPORT_POLICY.json` 固定允许清单和源哈希；`EXPORT_MANIFEST.json` 记录每份源码的源/目标哈希与实际变换。原标识映射不会写入仓库。

## 使用边界

此目录不能直接启动：原模块仍引用安装目录布局及本机路径；`.example` 配置不会自动生效。
核心集成依赖 Coopanion 0.2.8 与 Cortico 原程序。源码来源：
https://github.com/Pal-AI-Lab/Coopanion （原 package manifest 声明 AGPL-3.0-or-later）。
另需兼容 Node.js、Python、QQ 扩展、SnowLuma、DeepSeek DSH、相关媒体/语音模型及 Windows AppContainer。
具体来源与未打包依赖见 THIRD_PARTY.md；恢复边界见 RESTORE_BOUNDARIES.md。
未执行这些业务测试，亦未验证全新电脑安装。部分测试依赖未打包的原程序、配置或素材；不能将保留测试源码等同于全部测试通过。
启动/迁移脚本仅作工程记录；完成依赖安装、路径及权限审查、独立账号配置后才能使用。

## 重复导出

在原本地工程运行 `python scripts/export_whale_engineering.py`。
导出器只读取 `config/whale-engineering-export.json` 中的固定文件；新文件不会自动纳入。
源文件、脱敏名单来源、已导出文件发生漂移或缺失会报错。先人工复核清单再更新版本，不能静默覆盖用户修改。
导出器不删除额外文件、不启动服务、不执行业务测试、不进行 Git 操作或上传。
此存档内的导出器是来源记录；在新电脑上缺少原源目录与标识输入时不能复现导出。

GitHub 保存这份工程源码；真实数据只能作为另行授权、独立加密并验证的备份处理。
仅创建本目录不代表 GitHub 上传成功，也不代表 OpenAI 云端同步完成。
'''
THIRD_PARTY = '''# 第三方来源与外部依赖

本存档不是重新许可全部文件的声明。保留原文件版权与许可标记；相关第三方权利仍适用。

| 依赖 | 已观察来源/版本 | 本次范围 |
| --- | --- | --- |
| Coopanion / Cortico | https://github.com/Pal-AI-Lab/Coopanion ，已安装 manifest 为 0.2.8、AGPL-3.0-or-later | 仅当前集成核心 core-output-recovery.ts 与本地扩展源码；完整 vendor runtime 未打包。集成核心包含上游代码，不应将它全部声明为原创。 |
| QQ 扩展 | 原固定独立安装目录，历史运维资料记录 0.2.5 | 未打包；需核对安装来源及兼容性。 |
| SnowLuma | 原本地 SnowLuma v2.1.1 安装目录 | 未打包；需安装并重新登录账号。 |
| DeepSeek Harness | @deepseek-ai/dsh 0.2.1-rc.2，原 D:/Deepseek/app | npm 包与锁文件未打包；只保留本地编写的代理/启动/执行器源码。 |
| DSH 费用记录与诊断模块 | D:/Deepseek/spending-book.mjs、provider-diagnostics.mjs | 两份项目外自有集成源码经脱敏复制到 companion/dsh；源哈希单独记录。 |
| Node.js / Python / cryptography | 由现有本机运行时提供 | 未打包；Node 必须支持原代码使用的 node:sqlite 等能力，Python 恢复工具需要 cryptography。未验证最低版本组合。 |
| 媒体与工作间依赖 | ffmpeg/imageio-ffmpeg、sherpa-onnx、SenseVoice、esbuild、Windows AppContainer | 二进制、模型和安装状态未打包；配置仅保留脱敏示例，不证明已安装。 |
| QQ 表情映射 | companion/qq-face-sources.md 所列公共来源 | 保留公共映射及来源说明；图片素材未打包，不作通用素材许可承诺。 |

现有程序采用 Windows 专用启动与权限机制，仍有绝对路径、固定端口和外部模块导入。
本次未从网络拉取或重新验证第三方源码，以上版本来自本地代码与已安装 manifest。
'''
RESTORE = '''# 恢复与同步边界

工程存档只保存允许清单中的源码与模板，不包含汐的真实记忆、当前状态或账号凭据。
仅凭此存档不能恢复原汐的完整生活经历，也不能直接运行当前实例。

`companion/portable-snapshot.py` 是停机快照流程的源码记录；它依赖原目录布局、
独立保管的恢复密钥和停机状态。`companion/archive.py` 只恢复到新目录；
`scripts/portable_backup.py` 提供带认证的恢复密钥文件加密。这里没有创建新快照。
旧快照字节恢复成功不等于新电脑已安装或账号已登录，也不等于最新云端副本存在。

实际恢复需要另行取回、认证并解密数据快照；安装并核对固定版本主程序/扩展/依赖；
改好本机路径；配置模型凭据；登录 QQ；审查待发送队列及旧设备运行状态，避免双实例。
先恢复到隔离目录并验证，再决定启用。不要直接将模板合成账号用于真实发送。

GitHub 版本历史、OpenAI Sites 密文备份与本地运行分别承担不同用途。
本存档不包含自动上传器、三方版本协调、冲突处理或云端常驻运行能力。
'''
IGNORE = '''# Personal data and runtime material must never enter this source archive.
.env
.env.*
!.env.example
*.key
*.pem
*.p12
*.pfx
*.sqlite
*.sqlite3
*.db
*-wal
*-shm
*.jsonl
*.log
*.pavlt
*.zip
__pycache__/
*.py[cod]
node_modules/
.venv/
venv/
data/
workspace/
scoped-chat/
runtime/
artifacts/
assets/
logs/
local-credentials/
credentials/
secrets/
processes.json
runtime.json
*.lock
!package-lock.json
!pnpm-lock.yaml
# Templates are intentionally the only local configuration files shipped.
companion/policy.json
companion/audio-decoder.json
companion/video-decoder.json
companion/image-capabilities.json
companion/social-config.json
companion/identity/PARTNER.md
companion/identity/RELATIONSHIPS.md
companion/identity/DECISIONS.md
'''


def export():
    policy_raw = CONFIG.read_bytes()
    policy = json.loads(policy_raw)
    if policy.get('schema_version') != 1:
        raise ValueError('Unsupported export policy schema')
    mapping = identifiers(policy)
    outputs, entries, findings = {}, [], []
    for entry in policy['files']:
        name = entry['output']
        safe_relative(name)
        if name.casefold() in {key.casefold() for key in outputs}:
            raise ValueError('Duplicate output path: ' + name)
        raw = source(entry).read_bytes()
        if digest(raw) != entry['source_sha256']:
            raise ValueError('Source drift; review manifest: ' + entry['source'])
        result, applied = transform(entry, raw, mapping)
        findings.extend(scan(name, result))
        outputs[name] = result
        entries.append({'source_root': entry['root'], 'source': entry['source'], 'path': name,
                        'source_sha256': digest(raw), 'target_sha256': digest(result),
                        'bytes': len(result), 'kind': entry['kind'], 'applied_transformations': applied})
    generated = {'README.md': README, 'THIRD_PARTY.md': THIRD_PARTY,
                 'RESTORE_BOUNDARIES.md': RESTORE, '.gitignore': IGNORE,
                 '.gitattributes': '* text=auto eol=lf\n'}
    for name, text in generated.items():
        outputs[name] = text.encode('utf-8')
    outputs['EXPORT_POLICY.json'] = encoded(policy)
    for name in [*generated, 'EXPORT_POLICY.json']:
        findings.extend(scan(name, outputs[name]))
        entries.append({'path': name, 'bytes': len(outputs[name]), 'target_sha256': digest(outputs[name]),
                        'kind': 'generated-document', 'source_sha256': digest(policy_raw) if name == 'EXPORT_POLICY.json' else None})
    if findings:
        print(json.dumps({'status': 'blocked_uncertain_credential', 'findings': findings}, ensure_ascii=False))
        raise ValueError('Credential scan requires review; values deliberately omitted; no export files written')
    manifest = {'schema_version': 1, 'purpose': 'Sanitized engineering archive; not a runnable full backup',
                'export_policy_sha256': digest(policy_raw), 'source_files': len(policy['files']),
                'identifier_value_count': len(mapping), 'identifier_mapping_exported': False,
                'credential_scan': {'status': 'passed', 'rules': list(SECRET_PATTERNS), 'not_a_comprehensive_secret_audit': True},
                'files': sorted(entries, key=lambda item: item['path'])}
    outputs['EXPORT_MANIFEST.json'] = encoded(manifest)
    DEST.mkdir(parents=True, exist_ok=True)
    prior_path = checked_path(DEST, 'EXPORT_MANIFEST.json')
    if not prior_path.exists() and any(path.name != '.git' for path in DEST.iterdir()):
        raise ValueError('Export manifest missing in nonempty destination; will not reconstruct provenance silently')
    prior = json.loads(prior_path.read_bytes()) if prior_path.exists() else None
    if prior:
        expected = {entry['path']: entry['target_sha256'] for entry in prior['files']}
        for name, old_sha in expected.items():
            path = checked_path(DEST, name)
            if not path.is_file() or digest(path.read_bytes()) != old_sha:
                raise ValueError('Exported file missing or changed; will not overwrite: ' + name)
        # The manifest is deterministic too. Hand-edited provenance must not be
        # silently overwritten even if its listed file hashes still match.
        if prior_path.read_bytes() != outputs['EXPORT_MANIFEST.json']:
            raise ValueError('Export manifest drift; review before updating archive')
    for name, raw in outputs.items():
        path = checked_path(DEST, name)
        if path.exists() and path.read_bytes() != raw:
            raise ValueError('Destination collision; will not overwrite: ' + name)
    for name, raw in outputs.items():
        path = checked_path(DEST, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            with path.open('xb') as handle:
                handle.write(raw)
        if digest(path.read_bytes()) != digest(raw):
            raise ValueError('Destination verification failed: ' + name)
    actual_files = [p for p in DEST.rglob('*') if p.is_file() and '.git' not in p.relative_to(DEST).parts]
    extras = sorted(p.relative_to(DEST).as_posix() for p in actual_files if p.relative_to(DEST).as_posix() not in outputs)
    report = {'status': 'engineering_archive_verified', 'delivery': 'delivery/xi-engineering',
              'allowlisted_source_files': len(policy['files']), 'exported_files': len(outputs),
              'total_bytes': sum(map(len, outputs.values())), 'manifest_sha256': digest(outputs['EXPORT_MANIFEST.json']),
              'source_hashes_verified': True, 'target_hashes_verified': True, 'credential_scan_passed': True,
              'extra_files_preserved': extras, 'business_tests_executed': False, 'runtime_modified': False,
              'github_uploaded': False, 'openai_cloud_synced': False, 'one_click_install': False}
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    report_raw = encoded(report)
    if REPORT.exists() and REPORT.read_bytes() != report_raw:
        raise ValueError('Inventory report drift; not overwriting existing evidence')
    if not REPORT.exists():
        with REPORT.open('xb') as handle:
            handle.write(report_raw)
    print(json.dumps(report, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--initialize-manifest', action='store_true')
    args = parser.parse_args()
    if args.initialize_manifest:
        initialize()
    else:
        export()


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, UnicodeError, KeyError, json.JSONDecodeError) as error:
        # Do not print source content or credential values in failure diagnostics.
        print(json.dumps({'status': 'failed', 'reason': str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)

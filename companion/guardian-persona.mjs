import {homeTools} from './home-tools.mjs';
import {publicReading} from './public-reading.mjs';
// Adapter for the pinned Cormini class. Tools access only the fixed local home API.
export function guardedPersona(Base) {
  return class GuardianPersona extends Base {
    tools() {
      const base = super.tools();
      this.guardianPublicReading ??= publicReading();
      return [...base, ...homeTools(base), this.guardianPublicReading];
    }
    ioTools(tag) {
      const enabled = new Set(['qq_draft','qq_confirm','qq_read_history','qq_grep_history','qq_fetch_history','qq_history_archive']);
      return super.ioTools(tag).filter(tool => enabled.has(tool.name));
    }
    writeGuard(op, path, role) {
      const name = String(path).replaceAll('\\', '/').toLowerCase();
      const parts = name.split('/');
      if (name.startsWith('/') || name.includes(':') || parts.some(p => p === '..' || p === '.' || !p || p.endsWith('.') || p.endsWith(' '))) {
        return 'Use a plain workspace-relative path.';
      }
      // Self-chosen name and interests live in growth/, not in protected operating rules.
      const allowed = ['diary/', 'growth/', 'projects/', 'family-memory/', 'blobs/'];
      if (!allowed.some(prefix => name.startsWith(prefix))) {
        return 'This file is guardian-managed. Record a proposed change in growth/ instead.';
      }
      return super.writeGuard(op, path, role);
    }
  };
}

export function heartbeatDelay(now, intervalMs) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(now));
  return hour < 7 ? null : intervalMs;
}

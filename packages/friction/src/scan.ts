import { relative, resolve } from 'node:path';
import { aggregate, detect } from './aggregate.js';
import { parseTranscript, transcriptFiles } from './parse.js';
import type { Call, ScanOptions, ScanSummary } from './types.js';

export interface ScanInput extends ScanOptions {
  transcriptDir: string;
}

export function scan(input: ScanInput): ScanSummary {
  const files = transcriptFiles(input.transcriptDir);
  const calls: Call[] = [];
  const sessions = new Set<string>();

  for (const file of files) {
    for (const call of parseTranscript(file, input.maxGapMs)) {
      if (input.sinceMs !== undefined && call.at < input.sinceMs) continue;
      if (input.repo !== undefined && !insideRepo(call.cwd, input.repo)) continue;
      calls.push(call);
      sessions.add(call.session);
    }
  }

  const events = detect(calls, input);
  const summary: ScanSummary = {
    scannedSessions: sessions.size,
    scannedCalls: calls.length,
    observedMs: calls.reduce((n, c) => n + c.durationMs, 0),
    lostMs: events.reduce((n, e) => n + e.lostMs, 0),
    modules: aggregate(events),
    events,
  };
  if (input.sinceMs !== undefined) summary.since = new Date(input.sinceMs).toISOString();
  return summary;
}

function insideRepo(cwd: string, repo: string): boolean {
  if (cwd === '') return false;
  const rel = relative(resolve(repo), resolve(cwd));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

/** `30d`, `12h`, `90m` or an ISO date. */
export function parseSince(spec: string, now = Date.now()): number | null {
  const m = /^(\d+)([dhm])$/.exec(spec.trim());
  if (m !== null) {
    const n = Number(m[1]);
    const unit = m[2];
    const ms = unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000;
    return now - n * ms;
  }
  const t = Date.parse(spec);
  return Number.isNaN(t) ? null : t;
}

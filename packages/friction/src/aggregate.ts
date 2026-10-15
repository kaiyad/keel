import { isTestCommand, moduleOf } from './parse.js';
import {
  FRICTION_KINDS,
  type Call,
  type FrictionEvent,
  type FrictionKind,
  type ModuleSummary,
  type ScanOptions,
} from './types.js';

/**
 * Turn reconstructed calls into friction events. One call produces at most one
 * event — the highest-priority kind — so lost time is never counted twice.
 */
export function detect(calls: Call[], opts: ScanOptions): FrictionEvent[] {
  const events: FrictionEvent[] = [];
  for (const [, session] of groupBy(calls, (c) => c.session)) {
    const commandSeen = new Map<string, number>();
    const editSeen = new Map<string, number>();
    /** Most recently edited first: a test loop is about what was just changed. */
    const recentEdits: string[] = [];
    let testRuns = 0;

    for (const call of session) {
      const isEdit = /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(call.tool);
      if (isEdit) {
        for (const p of call.paths) {
          editSeen.set(p, (editSeen.get(p) ?? 0) + 1);
          const was = recentEdits.indexOf(p);
          if (was !== -1) recentEdits.splice(was, 1);
          recentEdits.unshift(p);
        }
      }
      const repeats = call.command === undefined ? 0 : (commandSeen.get(call.command) ?? 0) + 1;
      if (call.command !== undefined) commandSeen.set(call.command, repeats);
      if (isTestCommand(call.command)) testRuns++;

      if (call.isError) {
        push(events, call, 'tool-error', call.paths, opts, describe(call));
        continue;
      }
      if (call.command !== undefined && repeats >= opts.repeatThreshold) {
        push(events, call, 'repeat-command', call.paths, opts, `ran ${repeats}×: ${describe(call)}`);
        continue;
      }
      if (isEdit) {
        const churned = call.paths.filter((p) => (editSeen.get(p) ?? 0) >= opts.churnThreshold);
        if (churned.length > 0) {
          push(events, call, 'edit-churn', churned, opts, `edit ${editSeen.get(churned[0] ?? '') ?? 0} of ${churned[0] ?? ''}`);
          continue;
        }
      }
      if (isTestCommand(call.command) && testRuns >= 3) {
        push(
          events,
          call,
          'test-loop',
          recentEdits.filter(isCodePath).slice(0, 3),
          opts,
          `test run ${testRuns}: ${describe(call)}`,
        );
      }
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

function push(
  events: FrictionEvent[],
  call: Call,
  kind: FrictionKind,
  paths: string[],
  opts: ScanOptions,
  detail: string,
): void {
  const targets = paths.length === 0 ? [''] : paths;
  const share = call.durationMs / targets.length;
  for (const path of targets) {
    events.push({
      kind,
      module: moduleOf(path, opts.depth),
      path,
      lostMs: share,
      at: call.at,
      session: call.session,
      tool: call.tool,
      detail,
    });
  }
}

export function aggregate(events: FrictionEvent[]): ModuleSummary[] {
  const out: ModuleSummary[] = [];
  for (const [module, group] of groupBy(events, (e) => e.module)) {
    const byKind = Object.fromEntries(FRICTION_KINDS.map((k) => [k, 0])) as Record<FrictionKind, number>;
    for (const e of group) byKind[e.kind]++;
    out.push({
      module,
      lostMs: group.reduce((n, e) => n + e.lostMs, 0),
      events: group.length,
      byKind,
      sessions: new Set(group.map((e) => e.session)).size,
      topDetails: [...new Set(group.map((e) => e.detail))].slice(0, 3),
    });
  }
  return out.sort((a, b) => b.lostMs - a.lostMs || b.events - a.events);
}

/** Prose files are never what a failing test run is about. */
function isCodePath(path: string): boolean {
  return !/\.(md|markdown|txt|rst)$/i.test(path);
}

function describe(call: Call): string {
  if (call.command !== undefined) return truncate(call.command.replace(/\s+/g, ' '), 90);
  return call.paths.length > 0 ? `${call.tool} ${call.paths.join(' ')}` : call.tool;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = out.get(k) ?? [];
    list.push(x);
    out.set(k, list);
  }
  return out;
}

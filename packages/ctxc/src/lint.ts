import { matchAny, scopesOverlap, type Diagnostic } from '@keel/core';
import type { Config, ContextDoc } from './types.js';

export interface LintInput {
  docs: ContextDoc[];
  config: Config;
  /** Repo-relative code paths, used to catch scopes that match nothing. */
  codeFiles: string[];
  /** id -> last retrieval timestamp, or null when no telemetry exists yet. */
  retrieval: Map<string, string> | null;
  today: string;
}

export function lint(input: LintInput): Diagnostic[] {
  const { docs, config, codeFiles, retrieval, today } = input;
  const out: Diagnostic[] = [];
  const byId = new Map<string, ContextDoc>();

  for (const doc of docs) {
    const existing = byId.get(doc.id);
    if (existing !== undefined) {
      out.push({
        severity: 'error',
        code: 'duplicate-id',
        message: `id "${doc.id}" is already defined in ${existing.file}`,
        file: doc.file,
        hint: 'Ids are how supersedes and retrieval telemetry refer to a document; they must be unique.',
      });
      continue;
    }
    byId.set(doc.id, doc);
  }

  const superseded = new Set<string>();
  for (const doc of docs) {
    for (const id of doc.supersedes) {
      const target = byId.get(id);
      if (target === undefined) {
        out.push({
          severity: 'error',
          code: 'dangling-supersedes',
          message: `supersedes unknown id "${id}"`,
          file: doc.file,
          hint: 'Either the superseded document was deleted instead of retired, or the id is a typo.',
        });
        continue;
      }
      superseded.add(id);
      if (target.status === 'active') {
        out.push({
          severity: 'error',
          code: 'superseded-but-active',
          message: `"${id}" is superseded by "${doc.id}" but still has status: active`,
          file: target.file,
          hint: 'Set status: superseded. Two live answers to the same question is the contradiction agents cannot resolve.',
        });
      }
    }
  }

  const active = docs.filter((d) => d.status === 'active');

  for (const doc of active) {
    if (doc.expires !== undefined) {
      const days = daysBetween(today, doc.expires);
      if (days === null) {
        out.push({
          severity: 'error',
          code: 'bad-date',
          message: `expires: "${doc.expires}" is not YYYY-MM-DD`,
          file: doc.file,
        });
      } else if (days < 0) {
        out.push({
          severity: 'error',
          code: 'expired',
          message: `expired ${-days} days ago (${doc.expires}) and is still active`,
          file: doc.file,
          hint: 'Renew it with a new expiry, or set status: superseded. Expiry is the only thing that evicts context.',
        });
      } else if (days <= config.expiringWithinDays) {
        out.push({
          severity: 'warn',
          code: 'expiring-soon',
          message: `expires in ${days} days (${doc.expires})`,
          file: doc.file,
          hint: `Re-confirm it with its owner (${doc.owner}) before it starts failing the build.`,
        });
      }
    }

    for (const glob of doc.scope) {
      if (codeFiles.length > 0 && !codeFiles.some((f) => matchAny([glob], f))) {
        out.push({
          severity: 'warn',
          code: 'unknown-scope',
          message: `scope "${glob}" matches no file in the repository`,
          file: doc.file,
          hint: 'The code moved or was deleted. Rules scoped to paths that no longer exist are never retrieved and never noticed.',
        });
      }
    }
  }

  out.push(...ruleConflicts(active));

  if (retrieval === null) {
    out.push({
      severity: 'info',
      code: 'no-retrieval-telemetry',
      message: `no retrieval log at ${config.retrievalLog}; staleness cannot be checked`,
      hint: 'Have agents call `ctxc retrieved <id>` when they use a document, or pipe `ctxc pack --json` through a wrapper that does.',
    });
  } else {
    for (const doc of active) {
      const last = retrieval.get(doc.id);
      if (last === undefined) {
        out.push({
          severity: 'warn',
          code: 'never-retrieved',
          message: 'no agent has ever retrieved this document',
          file: doc.file,
          hint: 'Either its scope is wrong or nobody needs it. Both are worth knowing before it rots.',
        });
        continue;
      }
      const days = daysBetween(today, last.slice(0, 10));
      if (days !== null && -days > config.staleDays) {
        out.push({
          severity: 'warn',
          code: 'stale-retrieval',
          message: `not retrieved for ${-days} days (threshold ${config.staleDays})`,
          file: doc.file,
          hint: 'Context nobody reads is context nobody maintains. Retire it or fix its scope.',
        });
      }
    }
  }

  return out.sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      (a.file ?? '').localeCompare(b.file ?? ''),
  );
}

/**
 * Two active rules contradict when they assert opposite directives about the same
 * subject and value over scopes that can contain the same file. This is the check
 * that makes "contradictory rules fail the build" mechanical rather than aspirational.
 */
function ruleConflicts(active: ContextDoc[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const rules = active.filter((d) => d.rule !== undefined);
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i];
      const b = rules[j];
      if (a === undefined || b === undefined) continue;
      const ra = a.rule;
      const rb = b.rule;
      if (ra === undefined || rb === undefined) continue;
      if (ra.subject !== rb.subject || ra.value !== rb.value) continue;
      if (!anyScopeOverlap(a.scope, b.scope)) continue;
      if (ra.directive !== rb.directive) {
        out.push({
          severity: 'error',
          code: 'contradictory-rule',
          message: `"${a.id}" ${ra.directive}s and "${b.id}" ${rb.directive}s ${ra.subject}=${ra.value} over overlapping scopes`,
          file: b.file,
          hint: `Narrow one scope, or supersede one of the two. An agent retrieving both picks whichever came last in the prompt.`,
        });
      } else {
        out.push({
          severity: 'warn',
          code: 'duplicate-rule',
          message: `"${a.id}" and "${b.id}" assert the same rule over overlapping scopes`,
          file: b.file,
          hint: 'Redundant context costs tokens on every retrieval and drifts apart when only one copy is updated.',
        });
      }
    }
  }
  return out;
}

function anyScopeOverlap(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => scopesOverlap(x, y)));
}

/** Positive means `then` is in the future relative to `from`. Null on bad input. */
export function daysBetween(from: string, then: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(then) || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${then}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function severityRank(s: Diagnostic['severity']): number {
  return s === 'error' ? 0 : s === 'warn' ? 1 : 2;
}

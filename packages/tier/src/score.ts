import { fileLog, matchAny } from '@keel/core';
import type { Config, Scored, Signals } from './types.js';
import type { DepGraph } from './deps.js';

export interface SignalInput {
  root: string;
  config: Config;
  graph: DepGraph;
  coverage: Map<string, number> | null;
  /** Injected in tests; defaults to reading git. */
  log?: (path: string) => { subject: string }[];
}

export function signalsFor(path: string, input: SignalInput): Signals {
  const { config, graph, coverage } = input;
  const notes: string[] = [];
  const dependents = graph.dependents.get(path)?.size ?? 0;
  const log = (input.log ?? ((p: string) => fileLog(p, input.root)))(path);
  const incidentRe = new RegExp(config.incidentPattern, 'i');
  const fixCommits = log.filter((c) => incidentRe.test(c.subject)).length;
  const cov = coverage === null ? null : coverage.get(path) ?? null;
  const sensitive = matchAny(config.sensitive, path);
  const reversible = !matchAny(config.irreversible, path);
  const exempt = matchAny(config.exempt, path);

  if (exempt) notes.push('exempt by configuration: no production risk, so it is not scored');
  if (coverage === null) notes.push(`no coverage report at ${config.coverageFile}; treated as uncovered`);
  else if (cov === null) notes.push('not present in the coverage report; treated as uncovered');
  if (log.length === 0) notes.push('no git history for this path (new file, or outside a repository)');
  if (sensitive) notes.push('inside the manual load-bearing core');
  if (!reversible) notes.push('effects are not undone by reverting the commit');

  return {
    path,
    dependents,
    fixCommits,
    commits: log.length,
    coverage: cov,
    reversible,
    sensitive,
    exempt,
    notes,
  };
}

/**
 * Risk is a weighted sum of four observable signals, then two floors are applied:
 * anything sensitive is at least tier 2, and anything sensitive and irreversible is
 * tier 3. The floors are the part a reviewer should be able to argue with, so they
 * are stated separately from the arithmetic rather than hidden inside the weights.
 */
export function scoreFile(signals: Signals, config: Config): Scored {
  const { weights } = config;
  if (signals.exempt) {
    return {
      signals,
      risk: 0,
      tier: 0,
      reasons: ['exempt by configuration'],
      components: { blast: 0, incidents: 0, coverage: 0, irreversible: 0, sensitive: 0 },
    };
  }
  const blast = Math.min(1, signals.dependents / Math.max(1, config.dependentsCeiling));
  const incidents =
    signals.commits === 0
      ? 0
      : Math.min(
          1,
          signals.fixCommits /
            Math.max(config.fixCountCeiling, signals.commits * config.fixShareCeiling),
        );
  const uncovered = 1 - (signals.coverage ?? 0);
  const irreversible = signals.reversible ? 0 : 1;
  const sensitive = signals.sensitive ? 1 : 0;

  const components = {
    blast: blast * weights.blast,
    incidents: incidents * weights.incidents,
    coverage: uncovered * weights.coverage,
    irreversible: irreversible * weights.irreversible,
    sensitive: sensitive * weights.sensitive,
  };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const risk = total === 0 ? 0 : Object.values(components).reduce((a, b) => a + b, 0) / total;

  let tier = 0;
  const [t1, t2, t3] = config.thresholds;
  if (risk >= t3) tier = 3;
  else if (risk >= t2) tier = 2;
  else if (risk >= t1) tier = 1;

  const reasons: string[] = [];
  for (const [name, value] of Object.entries(components).sort((a, b) => b[1] - a[1])) {
    if (value <= 0) continue;
    reasons.push(`${name} contributes ${(value / total).toFixed(2)}`);
  }
  if (signals.sensitive && tier < 2) {
    tier = 2;
    reasons.unshift('floor: inside the manual load-bearing core, so never below tier 2');
  }
  if (signals.sensitive && !signals.reversible && tier < 3) {
    tier = 3;
    reasons.unshift('floor: load-bearing and irreversible, so tier 3');
  }
  if (reasons.length === 0) reasons.push('no risk signals found');

  return { signals, risk, tier, reasons, components };
}

export function changeTier(scored: Scored[]): number {
  return scored.reduce((max, s) => Math.max(max, s.tier), 0);
}

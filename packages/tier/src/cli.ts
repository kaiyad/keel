#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { bold, changedFiles, dim, green, heading, isRepo, red, repoRoot, table, yellow } from '@keel/core';
import { loadConfig, writeDefaultConfig } from './config.js';
import { buildGraph } from './deps.js';
import { readLcov } from './coverage.js';
import { changeTier, scoreFile, signalsFor } from './score.js';
import type { Config, Policy, Scored } from './types.js';

const USAGE = `tier — derive the autonomy level for a change from your own telemetry: blast
radius, incident history, coverage of the touched paths and reversibility.

  tier init                 write .keel/autonomy.json with the default policy
  tier diff [--base main]   score the current change and print the policy it requires
  tier score <path>...      score specific paths
  tier explain <path>       the full arithmetic for one path
  tier policy               the tier-to-policy table in force

Options
  --root <dir>      repository root (default: the enclosing repo)
  --base <ref>      comparison ref for diff (default: main)
  --gate <tier>     exit 1 when the change needs a higher tier than this
  --json            machine-readable output
`;

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      base: { type: 'string', default: 'main' },
      gate: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false, short: 'h' },
    },
  });

  const command = positionals[0] ?? 'help';
  if (values.help === true || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  const cwd = process.cwd();
  const root = resolve(values.root ?? repoRoot(cwd) ?? cwd);
  const config = loadConfig(root);
  const json = values.json === true;

  if (command === 'init') {
    process.stdout.write(`${green('wrote')} ${writeDefaultConfig(root)}\n`);
    return 0;
  }
  if (command === 'policy') {
    if (json) {
      process.stdout.write(`${JSON.stringify(config.policies, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`${policyTable(config)}\n`);
    return 0;
  }

  let paths: string[];
  if (command === 'diff') {
    if (!isRepo(root)) {
      process.stderr.write(`${root} is not a git repository; use "tier score <path>..."\n`);
      return 2;
    }
    paths = changedFiles(values.base ?? 'main', root);
    if (paths.length === 0) {
      process.stdout.write(`no changes against ${values.base ?? 'main'}\n`);
      return 0;
    }
  } else if (command === 'score' || command === 'explain') {
    paths = positionals.slice(1);
    if (paths.length === 0) {
      process.stderr.write(`${command} needs at least one path\n`);
      return 2;
    }
  } else {
    process.stderr.write(`unknown command "${command}"\n\n${USAGE}`);
    return 2;
  }

  const graph = buildGraph(root);
  const coverage = readLcov(root, config.coverageFile);
  const input = { root, config, graph, coverage };
  const scored = paths.map((p) => scoreFile(signalsFor(p, input), config));
  const tier = changeTier(scored);
  const policy = config.policies[String(tier)];

  if (command === 'explain') {
    if (json) {
      process.stdout.write(`${JSON.stringify(scored, null, 2)}\n`);
      return 0;
    }
    for (const s of scored) process.stdout.write(explain(s, config));
    return 0;
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ tier, policy, files: scored, unresolvedImports: graph.unresolved }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(
      `${bold(`tier ${tier}`)} — ${policy?.summary ?? 'no policy configured for this tier'}\n`,
    );
    if (policy !== undefined) process.stdout.write(`${requirements(policy)}\n`);
    process.stdout.write(heading(`${paths.length} file(s)`) + '\n');
    process.stdout.write(`${fileTable(scored)}\n`);
    process.stdout.write(
      dim(
        `\n${graph.files.length} files in the dependency graph, ${graph.unresolved} import(s) unresolved` +
          `${coverage === null ? `, no coverage report at ${config.coverageFile}` : ''}\n`,
      ),
    );
  }

  if (values.gate !== undefined) {
    const max = Number.parseInt(values.gate, 10);
    if (Number.isFinite(max) && tier > max) {
      process.stderr.write(
        `${red('blocked')} this change needs tier ${tier}; the gate allows up to ${max}\n`,
      );
      return 1;
    }
  }
  return 0;
}

function fileTable(scored: Scored[]): string {
  return table(
    [
      { head: 'tier', align: 'right' },
      { head: 'risk', align: 'right' },
      { head: 'path' },
      { head: 'dependents', align: 'right' },
      { head: 'fixes/commits', align: 'right' },
      { head: 'coverage', align: 'right' },
      { head: 'flags' },
    ],
    [...scored]
      .sort((a, b) => b.tier - a.tier || b.risk - a.risk)
      .map((s) => [
        tierLabel(s.tier),
        s.risk.toFixed(2),
        s.signals.path,
        String(s.signals.dependents),
        `${s.signals.fixCommits}/${s.signals.commits}`,
        s.signals.coverage === null ? dim('none') : `${Math.round(s.signals.coverage * 100)}%`,
        [s.signals.sensitive ? yellow('load-bearing') : '', s.signals.reversible ? '' : red('irreversible')]
          .filter((x) => x !== '')
          .join(' '),
      ]),
  );
}

function tierLabel(tier: number): string {
  return tier >= 3 ? red(String(tier)) : tier === 2 ? yellow(String(tier)) : String(tier);
}

function requirements(p: Policy): string {
  return [
    `  model: ${p.model}`,
    `  reviewers: ${p.reviewers}`,
    `  auto-merge: ${p.autoMerge ? 'yes' : 'no'}`,
    p.oracleIsolation ? '  oracle isolation: the test-writing agent must not see the implementation' : '',
    p.dualKey ? '  dual-key: two approvals from different people' : '',
    p.humanAuthoring ? '  human authoring: the model may propose, a human types' : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function explain(s: Scored, config: Config): string {
  const lines = [
    `${bold(s.signals.path)} → ${bold(`tier ${s.tier}`)} (risk ${s.risk.toFixed(3)})`,
    '',
    table(
      [{ head: 'signal' }, { head: 'observed' }, { head: 'weighted', align: 'right' }],
      [
        ['blast radius', `${s.signals.dependents} dependents (ceiling ${config.dependentsCeiling})`, s.components['blast']?.toFixed(3) ?? '0'],
        ['incident history', `${s.signals.fixCommits} of ${s.signals.commits} commits`, s.components['incidents']?.toFixed(3) ?? '0'],
        ['coverage', s.signals.coverage === null ? 'unknown' : `${Math.round(s.signals.coverage * 100)}%`, s.components['coverage']?.toFixed(3) ?? '0'],
        ['reversibility', s.signals.reversible ? 'revertable' : 'not revertable', s.components['irreversible']?.toFixed(3) ?? '0'],
        ['load-bearing core', s.signals.sensitive ? 'yes' : 'no', s.components['sensitive']?.toFixed(3) ?? '0'],
      ],
    ),
    '',
    ...s.reasons.map((r) => `  ${dim('·')} ${r}`),
    ...s.signals.notes.map((n) => `  ${yellow('note')} ${n}`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function policyTable(config: Config): string {
  return table(
    [
      { head: 'tier' },
      { head: 'model' },
      { head: 'reviewers', align: 'right' },
      { head: 'auto-merge' },
      { head: 'oracle isolation' },
      { head: 'dual key' },
      { head: 'human authoring' },
    ],
    Object.entries(config.policies)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([t, p]) => [
        t,
        p.model,
        String(p.reviewers),
        p.autoMerge ? 'yes' : 'no',
        p.oracleIsolation ? 'yes' : 'no',
        p.dualKey ? 'yes' : 'no',
        p.humanAuthoring ? 'yes' : 'no',
      ]),
  );
}

process.exit(main(process.argv.slice(2)));

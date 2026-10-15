#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { bar, bold, dim, heading, repoRoot, table, writeText } from '@keel/core';
import { defaultTranscriptDir } from './parse.js';
import { parseSince, scan } from './scan.js';
import { DEFAULT_SCAN, type ScanSummary } from './types.js';

const USAGE = `friction — where agents stall, retry and thrash in your repository, charged to
the module that caused it. Rank platform investment by agent-minutes lost.

  friction scan        ranked modules (default command)
  friction events      the underlying evidence, newest last
  friction sessions    what was scanned

Options
  --repo <dir>       only sessions whose cwd is inside this repo (default: this repo)
  --all-repos        do not filter by repo
  --dir <dir>        transcript directory (default: ~/.claude/projects)
  --since <spec>     30d, 12h, 90m or an ISO date
  --depth <n>        path depth that defines a module (default: 2)
  --top <n>          rows to show (default: 20)
  --module <name>    filter events to one module
  --max-gap <sec>    cap on a single call's attributed time (default: 300)
  --markdown         markdown instead of a terminal table
  --json             machine-readable output
  --out <file>       write the output to a file as well

What is counted as lost agent time
  tool-error      a tool call that failed, and the time until the agent's next action
  repeat-command  the second and later identical commands in one session
  edit-churn      the third and later edit of one file in one session
  test-loop       the third and later test run in one session, charged to the files edited

Nothing here measures a human. Durations are capped so an idle terminal is not
counted, and a session with no timestamps contributes events with zero minutes.
`;

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      repo: { type: 'string' },
      'all-repos': { type: 'boolean', default: false },
      dir: { type: 'string' },
      since: { type: 'string' },
      depth: { type: 'string' },
      top: { type: 'string' },
      module: { type: 'string' },
      'max-gap': { type: 'string' },
      markdown: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
      help: { type: 'boolean', default: false, short: 'h' },
    },
  });

  const command = positionals[0] ?? 'scan';
  if (values.help === true || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  const transcriptDir = resolve(values.dir ?? defaultTranscriptDir(homedir()));
  const cwd = process.cwd();
  const repo = values['all-repos'] === true ? undefined : resolve(values.repo ?? repoRoot(cwd) ?? cwd);
  const depth = int(values.depth, DEFAULT_SCAN.depth);
  const top = int(values.top, 20);
  const maxGapMs = int(values['max-gap'], DEFAULT_SCAN.maxGapMs / 1000) * 1000;

  let sinceMs: number | undefined;
  if (values.since !== undefined) {
    const parsed = parseSince(values.since);
    if (parsed === null) {
      process.stderr.write(`cannot read --since "${values.since}" — use 30d, 12h, 90m or an ISO date\n`);
      return 2;
    }
    sinceMs = parsed;
  }

  const summary = scan({
    ...DEFAULT_SCAN,
    transcriptDir,
    depth,
    maxGapMs,
    ...(repo === undefined ? {} : { repo }),
    ...(sinceMs === undefined ? {} : { sinceMs }),
  });

  if (summary.scannedCalls === 0) {
    process.stderr.write(
      `no agent activity found in ${transcriptDir}` +
        (repo === undefined ? '' : ` for ${repo}`) +
        (sinceMs === undefined ? '' : ` since ${new Date(sinceMs).toISOString().slice(0, 10)}`) +
        '\n',
    );
    return 1;
  }

  const text =
    command === 'events'
      ? renderEvents(summary, values.module, top)
      : command === 'sessions'
        ? renderSessions(summary)
        : values.markdown === true
          ? renderMarkdown(summary, top)
          : renderScan(summary, top, repo, transcriptDir);

  if (values.json === true) {
    const payload = command === 'events' ? summary.events : { ...summary, events: undefined };
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    process.stdout.write(json);
    if (values.out !== undefined) writeText(resolve(values.out), json);
    return 0;
  }
  process.stdout.write(text);
  if (values.out !== undefined) writeText(resolve(values.out), text);
  return 0;
}

function renderScan(summary: ScanSummary, top: number, repo: string | undefined, dir: string): string {
  const lines: string[] = [];
  const lostMin = summary.lostMs / 60_000;
  const observedMin = summary.observedMs / 60_000;
  const share = observedMin === 0 ? 0 : lostMin / observedMin;
  lines.push(
    `${bold(`${lostMin.toFixed(0)} agent-minutes lost`)} of ${observedMin.toFixed(0)} observed ` +
      `(${Math.round(share * 100)}%) across ${summary.scannedSessions} session(s), ${summary.scannedCalls} tool calls`,
  );
  lines.push(dim(`transcripts: ${dir}${repo === undefined ? ' (all repos)' : ` · repo: ${repo}`}${summary.since === undefined ? '' : ` · since ${summary.since.slice(0, 10)}`}`));
  lines.push(heading('Agent-minutes lost per module'));
  const max = summary.modules[0]?.lostMs ?? 0;
  lines.push(
    table(
      [
        { head: 'module' },
        { head: 'lost min', align: 'right' },
        { head: '' },
        { head: 'errors', align: 'right' },
        { head: 'repeats', align: 'right' },
        { head: 'churn', align: 'right' },
        { head: 'test loops', align: 'right' },
        { head: 'sessions', align: 'right' },
      ],
      summary.modules.slice(0, top).map((m) => [
        m.module === '' ? dim('(no path)') : m.module,
        (m.lostMs / 60_000).toFixed(1),
        bar(max === 0 ? 0 : m.lostMs / max, 10),
        String(m.byKind['tool-error']),
        String(m.byKind['repeat-command']),
        String(m.byKind['edit-churn']),
        String(m.byKind['test-loop']),
        String(m.sessions),
      ]),
    ),
  );
  const worst = summary.modules[0];
  if (worst !== undefined && worst.topDetails.length > 0) {
    lines.push(heading(`Worst module: ${worst.module || '(no path)'}`));
    for (const d of worst.topDetails) lines.push(`  ${dim('·')} ${d}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderMarkdown(summary: ScanSummary, top: number): string {
  const rows = summary.modules
    .slice(0, top)
    .map(
      (m) =>
        `| \`${m.module || '(no path)'}\` | ${(m.lostMs / 60_000).toFixed(1)} | ${m.byKind['tool-error']} | ${m.byKind['repeat-command']} | ${m.byKind['edit-churn']} | ${m.byKind['test-loop']} | ${m.sessions} |`,
    );
  return [
    '# Agent friction',
    '',
    `${(summary.lostMs / 60_000).toFixed(0)} agent-minutes lost of ${(summary.observedMs / 60_000).toFixed(0)} observed, across ${summary.scannedSessions} session(s).`,
    summary.since === undefined ? '' : `Window: since ${summary.since.slice(0, 10)}.`,
    '',
    '| module | lost min | errors | repeats | churn | test loops | sessions |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

function renderEvents(summary: ScanSummary, module: string | undefined, top: number): string {
  const events = (module === undefined ? summary.events : summary.events.filter((e) => e.module === module)).slice(-top);
  if (events.length === 0) return 'no events matched\n';
  return `${table(
    [{ head: 'when' }, { head: 'kind' }, { head: 'module' }, { head: 'lost s', align: 'right' }, { head: 'detail' }],
    events.map((e) => [
      new Date(e.at).toISOString().slice(0, 16).replace('T', ' '),
      e.kind,
      e.module || dim('(no path)'),
      (e.lostMs / 1000).toFixed(0),
      e.detail,
    ]),
  )}\n`;
}

function renderSessions(summary: ScanSummary): string {
  const bySession = new Map<string, { events: number; lostMs: number }>();
  for (const e of summary.events) {
    const b = bySession.get(e.session) ?? { events: 0, lostMs: 0 };
    b.events++;
    b.lostMs += e.lostMs;
    bySession.set(e.session, b);
  }
  if (bySession.size === 0) return `${summary.scannedSessions} session(s) scanned, no friction events\n`;
  return `${table(
    [{ head: 'session' }, { head: 'events', align: 'right' }, { head: 'lost min', align: 'right' }],
    [...bySession.entries()]
      .sort((a, b) => b[1].lostMs - a[1].lostMs)
      .map(([id, b]) => [id.slice(0, 8), String(b.events), (b.lostMs / 60_000).toFixed(1)]),
  )}\n${dim(`\n${summary.scannedSessions} session(s) scanned`)}\n`;
}

function int(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

process.exit(main(process.argv.slice(2)));

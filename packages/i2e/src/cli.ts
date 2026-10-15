#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { bar, bold, dim, green, heading, isFile, readJsonOr, red, table, writeText, yellow } from '@keel/core';
import { loadConfig } from './config.js';
import { loadCases, saveCase } from './cases.js';
import { importPostmortem, parseAssertSpecs } from './import.js';
import { compare, latestRun, runCases, saveRun } from './run.js';
import { markdownReport } from './report.js';
import type { Run } from './types.js';

const USAGE = `i2e — every production incident becomes a permanent eval case: would the
current agent, with the current context, have written this bug?

  i2e import <postmortem.md>...   turn postmortems into eval cases
  i2e list                        the case corpus
  i2e run                         run the corpus against an agent and gate on regressions
  i2e report                      markdown report for the latest run

Options
  --root <dir>         repository root (default: cwd)
  --agent <command>    shell template; {{prompt}} {{paths}} {{id}} are substituted,
                       and the prompt is also written to stdin
  --replay <dir>       score pre-captured outputs from <dir>/<id>.txt instead of running an agent
  --label <name>       names the run file (default: the agent's first word)
  --only <id>          run one case; repeatable
  --gate <mode>        regression (default) | all | none
  --assert <kind=value>  extra assertion on import; repeatable
  --category <name>    category for imported cases
  --prompt <text>      override the imported prompt
  --dry-run            print the case instead of writing it
  --out <file>         write the markdown report here
  --json               machine-readable output
`;

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      agent: { type: 'string' },
      replay: { type: 'string' },
      label: { type: 'string' },
      only: { type: 'string', multiple: true, default: [] },
      gate: { type: 'string', default: 'regression' },
      assert: { type: 'string', multiple: true, default: [] },
      category: { type: 'string' },
      prompt: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      out: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false, short: 'h' },
    },
  });

  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  const root = resolve(values.root ?? process.cwd());
  const config = loadConfig(root);
  const json = values.json === true;

  switch (command) {
    case 'import': {
      const files = positionals.slice(1);
      if (files.length === 0) {
        process.stderr.write('import needs at least one postmortem path\n');
        return 2;
      }
      const notes: string[] = [];
      const extra = parseAssertSpecs(values.assert ?? [], notes);
      let failures = 0;
      for (const file of files) {
        const full = resolve(root, file);
        let built;
        try {
          built = importPostmortem(readFileSync(full, 'utf8'), {
            source: relative(root, full),
            extraAssertions: extra,
            ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
            ...(values.category === undefined ? {} : { category: values.category }),
          });
        } catch (err) {
          process.stderr.write(`${red('skipped')} ${file}\n  ${(err as Error).message}\n`);
          failures++;
          continue;
        }
        if (values['dry-run'] === true) {
          process.stdout.write(`${JSON.stringify(built.case, null, 2)}\n`);
        } else {
          const path = saveCase(root, config.cases, built.case);
          process.stdout.write(
            `${green('imported')} ${built.case.id} ${dim(`${built.case.assertions.length} assertion(s) → ${relative(root, path)}`)}\n`,
          );
        }
        for (const note of [...notes, ...built.notes]) {
          process.stdout.write(`  ${yellow('note')} ${note}\n`);
        }
      }
      return failures > 0 ? 1 : 0;
    }

    case 'list': {
      const cases = loadCases(root, config.cases);
      if (json) {
        process.stdout.write(`${JSON.stringify(cases, null, 2)}\n`);
        return 0;
      }
      if (cases.length === 0) {
        process.stdout.write(`no cases in ${config.cases} — start with: i2e import <postmortem.md>\n`);
        return 0;
      }
      process.stdout.write(
        `${table(
          [{ head: 'case' }, { head: 'category' }, { head: 'assertions', align: 'right' }, { head: 'incident' }, { head: '' }],
          cases.map((c) => [
            c.id,
            c.category,
            String(c.assertions.length),
            c.incident,
            c.needsReview === true ? yellow('prompt needs review') : '',
          ]),
        )}\n`,
      );
      return 0;
    }

    case 'run': {
      const all = loadCases(root, config.cases);
      const only = values.only ?? [];
      const cases = only.length === 0 ? all : all.filter((c) => only.includes(c.id));
      if (cases.length === 0) {
        process.stderr.write(`no cases to run (corpus: ${config.cases})\n`);
        return 2;
      }
      const agent = values.agent ?? config.agent;
      if (values.replay === undefined && agent === '') {
        process.stderr.write(
          'no agent configured. Pass --agent "<command>" or set "agent" in .keel/i2e.json.\n' +
            'The prompt is written to the command\'s stdin and substituted for {{prompt}}.\n',
        );
        return 2;
      }
      const label = values.label ?? (values.replay !== undefined ? 'replay' : firstWord(agent));
      const contextVersion = readContextVersion(root);
      const run = runCases({
        root,
        config,
        cases,
        agent,
        label,
        ...(values.replay === undefined ? {} : { replayDir: values.replay }),
        ...(contextVersion === null ? {} : { contextVersion }),
      });
      const previous = latestRun(root, config.runs);
      const cmp = compare(run, previous);
      const path = saveRun(root, config.runs, run);

      if (json) {
        process.stdout.write(`${JSON.stringify({ run, comparison: { regressions: cmp.regressions, fixes: cmp.fixes } }, null, 2)}\n`);
      } else {
        printRun(run, cmp.regressions, cmp.fixes, previous);
        process.stdout.write(dim(`\nrun saved to ${relative(root, path)}\n`));
      }

      const gate = values.gate ?? 'regression';
      if (gate === 'all' && run.passed < run.caseCount) return 1;
      if (gate === 'regression' && cmp.regressions.length > 0) return 1;
      return 0;
    }

    case 'report': {
      const run = latestRun(root, config.runs);
      if (run === null) {
        process.stderr.write(`no runs in ${config.runs}\n`);
        return 2;
      }
      const md = markdownReport(run, compare(run, latestRun(root, config.runs, 1)));
      if (values.out !== undefined) {
        writeText(resolve(root, values.out), md);
        process.stdout.write(`${green('wrote')} ${values.out}\n`);
      } else {
        process.stdout.write(md);
      }
      return 0;
    }

    default:
      process.stderr.write(`unknown command "${command}"\n\n${USAGE}`);
      return 2;
  }
}

function printRun(run: Run, regressions: string[], fixes: string[], previous: Run | null): void {
  const pct = Math.round(run.score * 100);
  process.stdout.write(
    `${bold(`${run.passed}/${run.caseCount}`)} incident cases pass ${bar(run.score)} ${pct}%` +
      (previous === null ? '' : dim(`  (was ${Math.round(previous.score * 100)}% in ${previous.label})`)) +
      '\n',
  );
  process.stdout.write(heading('By category') + '\n');
  process.stdout.write(
    `${table(
      [{ head: 'category' }, { head: 'passed', align: 'right' }, { head: 'total', align: 'right' }, { head: '' }],
      Object.entries(run.byCategory)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, v]) => [k, String(v.passed), String(v.total), bar(v.total === 0 ? 0 : v.passed / v.total, 8)]),
    )}\n`,
  );

  const failures = run.results.filter((r) => !r.passed);
  if (failures.length > 0) {
    process.stdout.write(heading('Failures') + '\n');
    for (const r of failures) {
      process.stdout.write(`${red('fail')} ${bold(r.id)} ${dim(`(${r.category})`)}\n`);
      if (r.error !== undefined) process.stdout.write(`     ${yellow('harness')} ${r.error}\n`);
      for (const a of r.assertions.filter((x) => !x.passed)) {
        process.stdout.write(`     ${a.assertion.kind} ${dim(a.assertion.value)} — ${a.detail}\n`);
      }
    }
  }
  if (regressions.length > 0) {
    process.stdout.write(`\n${red('regressions')} ${regressions.join(', ')}\n`);
  }
  if (fixes.length > 0) {
    process.stdout.write(`${green('newly passing')} ${fixes.join(', ')}\n`);
  }
}

/** Join runs to the compiled context they ran against, when ctxc is in use. */
function readContextVersion(root: string): string | null {
  const path = join(root, '.keel', 'context', 'context.json');
  if (!isFile(path)) return null;
  const bundle = readJsonOr<{ version?: string }>(path, {});
  return bundle.version ?? null;
}

function firstWord(s: string): string {
  return (s.trim().split(/\s+/)[0] ?? 'agent').replace(/[^\w.-]/g, '') || 'agent';
}

process.exit(main(process.argv.slice(2)));

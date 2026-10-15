#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import {
  bold,
  countBy,
  dim,
  green,
  heading,
  readJsonOr,
  red,
  table,
  walk,
  writeJson,
  writeText,
  yellow,
  type Diagnostic,
} from '@keel/core';
import { loadConfig } from './config.js';
import { loadDocs } from './load.js';
import { lint } from './lint.js';
import { compile, renderBundle } from './bundle.js';
import { coverage, pack } from './pack.js';
import { readRetrieval, recordRetrieval } from './retrieval.js';
import { scaffold } from './scaffold.js';
import type { Bundle } from './types.js';

const USAGE = `ctxc — compile your decision records, incidents, deprecations and rules into a
versioned context artifact for agents, then lint it like any other build input.

  ctxc init                 scaffold a context directory, config and CI workflow
  ctxc build [--strict]     compile to <out>/context.json + context.md, lint first
  ctxc lint [--strict]      diagnostics only; exit 1 on error
  ctxc pack <path...>       the context that applies to these paths (feed it to an agent)
  ctxc retrieved <id...>    record that an agent used these documents
  ctxc stats                what the context covers and how fresh it is

Options
  --root <dir>    repository root (default: cwd)
  --json          machine-readable output
  --strict        warnings fail the build too
  --today <date>  YYYY-MM-DD, for deterministic expiry checks
  --agent <name>  attributed on "ctxc retrieved"
`;

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      json: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
      today: { type: 'string' },
      agent: { type: 'string' },
      'no-lint': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false, short: 'h' },
    },
  });

  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  const root = resolve(values.root ?? process.cwd());
  const today = values.today ?? new Date().toISOString().slice(0, 10);
  const config = loadConfig(root);
  const json = values.json === true;
  const strict = values.strict === true;

  switch (command) {
    case 'init': {
      const written = scaffold(root);
      if (written.length === 0) {
        process.stdout.write('Nothing to do — every scaffold file already exists.\n');
        return 0;
      }
      process.stdout.write(`${written.map((w) => `${green('created')} ${w}`).join('\n')}\n`);
      process.stdout.write(dim('\nNext: ctxc build\n'));
      return 0;
    }

    case 'lint':
    case 'build': {
      const { docs, diagnostics: loadDiags } = loadDocs(root, config.sources);
      const codeFiles = codeFilesFor(root, config.codeRoots, config.codeExts);
      const diags = [
        ...loadDiags,
        ...lint({
          docs,
          config,
          codeFiles,
          retrieval: readRetrieval(root, config.retrievalLog),
          today,
        }),
      ];
      const errors = countBy(diags, 'error');
      const warns = countBy(diags, 'warn');
      const failed = errors > 0 || (strict && warns > 0);

      if (command === 'build' && !failed) {
        const bundle = compile(docs);
        writeJson(join(root, config.out, 'context.json'), bundle);
        writeText(join(root, config.out, 'context.md'), renderBundle(bundle));
        if (json) {
          process.stdout.write(`${JSON.stringify({ ok: true, bundle: summary(bundle), diagnostics: diags }, null, 2)}\n`);
        } else {
          process.stdout.write(
            `${green('compiled')} ${bundle.docCount} documents → ${config.out}/context.json ${dim(`version ${bundle.version}`)}\n`,
          );
          report(diags, strict);
        }
        return 0;
      }

      if (json) {
        process.stdout.write(`${JSON.stringify({ ok: !failed, diagnostics: diags }, null, 2)}\n`);
      } else {
        report(diags, strict);
      }
      return failed ? 1 : 0;
    }

    case 'pack': {
      const paths = positionals.slice(1);
      if (paths.length === 0) {
        process.stderr.write('pack needs at least one path\n');
        return 2;
      }
      const bundle = loadBundle(root, config.out);
      if (bundle === null) {
        process.stderr.write(`no compiled context at ${config.out}/context.json — run ctxc build\n`);
        return 2;
      }
      const { docs, markdown } = pack(bundle, paths);
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ version: bundle.version, ids: docs.map((d) => d.id), docs }, null, 2)}\n`,
        );
      } else {
        process.stdout.write(markdown);
      }
      return 0;
    }

    case 'retrieved': {
      const ids = positionals.slice(1);
      if (ids.length === 0) {
        process.stderr.write('retrieved needs at least one document id\n');
        return 2;
      }
      const meta: { agent?: string; at: string } = { at: `${today}T00:00:00.000Z` };
      if (values.agent !== undefined) meta.agent = values.agent;
      recordRetrieval(root, config.retrievalLog, ids, meta);
      process.stdout.write(`${green('recorded')} ${ids.length} retrieval(s) → ${config.retrievalLog}\n`);
      return 0;
    }

    case 'stats': {
      const { docs } = loadDocs(root, config.sources);
      const bundle = compile(docs);
      const codeFiles = codeFilesFor(root, config.codeRoots, config.codeExts);
      const cov = coverage(bundle, codeFiles);
      const retrieval = readRetrieval(root, config.retrievalLog);
      const kinds = new Map<string, number>();
      for (const d of bundle.docs) kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);

      if (json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              version: bundle.version,
              docs: bundle.docCount,
              retired: docs.length - bundle.docCount,
              kinds: Object.fromEntries(kinds),
              coverage: cov,
              retrievalKnown: retrieval === null ? 0 : retrieval.size,
            },
            null,
            2,
          )}\n`,
        );
        return 0;
      }
      process.stdout.write(`${bold('context')} ${bundle.version}\n`);
      process.stdout.write(
        `${bundle.docCount} active, ${docs.length - bundle.docCount} retired, across ${kinds.size} kinds\n`,
      );
      process.stdout.write(heading('By kind') + '\n');
      process.stdout.write(
        `${table(
          [{ head: 'kind' }, { head: 'docs', align: 'right' }],
          [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, String(n)]),
        )}\n`,
      );
      process.stdout.write(heading('Coverage') + '\n');
      const pct = cov.total === 0 ? 0 : Math.round((cov.covered / cov.total) * 100);
      process.stdout.write(
        `${cov.covered}/${cov.total} code files (${pct}%) are in scope of at least one rule, deprecation or ownership document\n`,
      );
      process.stdout.write(
        retrieval === null
          ? dim(`no retrieval telemetry at ${config.retrievalLog}\n`)
          : `${retrieval.size}/${bundle.docCount} documents have ever been retrieved\n`,
      );
      return 0;
    }

    default:
      process.stderr.write(`unknown command "${command}"\n\n${USAGE}`);
      return 2;
  }
}

function summary(bundle: Bundle) {
  return { version: bundle.version, docCount: bundle.docCount, generatedAt: bundle.generatedAt };
}

function loadBundle(root: string, out: string): Bundle | null {
  const bundle = readJsonOr<Bundle | null>(join(root, out, 'context.json'), null);
  return bundle !== null && Array.isArray(bundle.docs) ? bundle : null;
}

function codeFilesFor(root: string, roots: string[], exts: string[]): string[] {
  const seen = new Set<string>();
  for (const r of roots) {
    const base = r === '.' ? root : join(root, r);
    for (const f of walk(base, { exts, maxFiles: 20_000 })) {
      seen.add(r === '.' ? f : `${r}/${f}`);
    }
  }
  return [...seen];
}

function report(diags: Diagnostic[], strict: boolean): void {
  if (diags.length === 0) {
    process.stdout.write(`${green('clean')} no context problems found\n`);
    return;
  }
  for (const d of diags) {
    const tag = d.severity === 'error' ? red('error') : d.severity === 'warn' ? yellow('warn') : dim('info');
    const where = d.file === undefined ? '' : `${bold(d.file)} `;
    process.stdout.write(`${tag} ${where}${dim(`[${d.code}]`)} ${d.message}\n`);
    if (d.hint !== undefined) process.stdout.write(`      ${dim(d.hint)}\n`);
  }
  const errors = countBy(diags, 'error');
  const warns = countBy(diags, 'warn');
  const verdict = errors > 0 || (strict && warns > 0) ? red('failed') : green('passed');
  process.stdout.write(`\n${verdict} — ${errors} error(s), ${warns} warning(s)${strict ? ' (strict)' : ''}\n`);
}

process.exit(main(process.argv.slice(2)));

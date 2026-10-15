import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDir, isFile, readJson, writeJson } from '@keel/core';
import { readFileSync } from 'node:fs';
import { check, touchedFromDiff } from './assert.js';
import type { CaseResult, Config, EvalCase, Run } from './types.js';

export interface RunOptions {
  root: string;
  config: Config;
  cases: EvalCase[];
  /** Shell command template. {{prompt}}, {{paths}}, {{id}} are substituted. */
  agent: string;
  label: string;
  /** Score pre-captured outputs from <dir>/<id>.txt instead of invoking the agent. */
  replayDir?: string;
  contextVersion?: string;
  now?: Date;
}

export function runCases(opts: RunOptions): Run {
  const results: CaseResult[] = [];
  for (const c of opts.cases) {
    results.push(opts.replayDir === undefined ? invoke(c, opts) : replay(c, opts, opts.replayDir));
  }
  return summarise(results, {
    at: (opts.now ?? new Date()).toISOString(),
    label: opts.label,
    agent: opts.replayDir === undefined ? opts.agent : `replay:${opts.replayDir}`,
    contextVersion: opts.contextVersion,
  });
}

function invoke(c: EvalCase, opts: RunOptions): CaseResult {
  const started = Date.now();
  const command = render(opts.agent, c);
  const proc = spawnSync(command, {
    shell: true,
    cwd: opts.root,
    input: c.prompt,
    encoding: 'utf8',
    timeout: opts.config.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, I2E_CASE_ID: c.id },
  });
  const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`;
  const result = score(c, output, opts.config.outputLimit, Date.now() - started);
  if (proc.error !== undefined) {
    return { ...result, passed: false, error: String(proc.error.message) };
  }
  if (proc.status !== 0 && output.trim() === '') {
    return { ...result, passed: false, error: `agent exited ${proc.status ?? 'null'} with no output` };
  }
  return result;
}

function replay(c: EvalCase, opts: RunOptions, dir: string): CaseResult {
  const path = join(opts.root, dir, `${c.id}.txt`);
  if (!isFile(path)) {
    return {
      id: c.id,
      category: c.category,
      passed: false,
      skipped: true,
      durationMs: 0,
      assertions: [],
      output: '',
      error: `no replay output at ${dir}/${c.id}.txt`,
    };
  }
  return score(c, readFileSync(path, 'utf8'), opts.config.outputLimit, 0);
}

function score(c: EvalCase, output: string, limit: number, durationMs: number): CaseResult {
  const assertions = check(c.assertions, { output, touched: touchedFromDiff(output) });
  return {
    id: c.id,
    category: c.category,
    passed: assertions.every((a) => a.passed),
    durationMs,
    assertions,
    output: output.length > limit ? `${output.slice(0, limit)}\n…truncated` : output,
  };
}

function render(template: string, c: EvalCase): string {
  return template
    .replace(/\{\{prompt\}\}/g, shellQuote(c.prompt))
    .replace(/\{\{paths\}\}/g, c.paths.map(shellQuote).join(' '))
    .replace(/\{\{id\}\}/g, shellQuote(c.id));
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function summarise(
  results: CaseResult[],
  meta: { at: string; label: string; agent: string; contextVersion?: string },
): Run {
  const byCategory: Record<string, { passed: number; total: number }> = {};
  for (const r of results) {
    const bucket = byCategory[r.category] ?? { passed: 0, total: 0 };
    bucket.total++;
    if (r.passed) bucket.passed++;
    byCategory[r.category] = bucket;
  }
  const passed = results.filter((r) => r.passed).length;
  const run: Run = {
    at: meta.at,
    label: meta.label,
    agent: meta.agent,
    caseCount: results.length,
    passed,
    score: results.length === 0 ? 0 : passed / results.length,
    byCategory,
    results,
  };
  if (meta.contextVersion !== undefined) run.contextVersion = meta.contextVersion;
  return run;
}

export interface Comparison {
  regressions: string[];
  fixes: string[];
  previous: Run | null;
}

/** Regression gating: a case that used to pass and now fails blocks the change. */
export function compare(current: Run, previous: Run | null): Comparison {
  if (previous === null) return { regressions: [], fixes: [], previous: null };
  const before = new Map(previous.results.map((r) => [r.id, r.passed]));
  const regressions: string[] = [];
  const fixes: string[] = [];
  for (const r of current.results) {
    const was = before.get(r.id);
    if (was === undefined) continue;
    if (was && !r.passed) regressions.push(r.id);
    if (!was && r.passed) fixes.push(r.id);
  }
  return { regressions, fixes, previous };
}

export function saveRun(root: string, dir: string, run: Run): string {
  const stamp = run.at.replace(/[:.]/g, '-');
  const path = join(root, dir, `${stamp}-${run.label}.json`);
  writeJson(path, run);
  return path;
}

/** Saved run files, oldest first. The name carries the timestamp, so sorting is enough. */
export function runFiles(root: string, dir: string): string[] {
  const full = join(root, dir);
  if (!isDir(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(full, f))
    .sort();
}

export function readRun(path: string): Run | null {
  try {
    return readJson<Run>(path);
  } catch {
    return null;
  }
}

/** `back` counts from the end: 0 is the most recent run, 1 the one before it. */
export function latestRun(root: string, dir: string, back = 0): Run | null {
  const files = runFiles(root, dir);
  const path = files[files.length - 1 - back];
  return path === undefined ? null : readRun(path);
}

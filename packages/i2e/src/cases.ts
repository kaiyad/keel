import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDir, readJson, writeJson } from '@keel/core';
import { ASSERTION_KINDS, type EvalCase } from './types.js';

export function caseFiles(root: string, dir: string): string[] {
  const full = join(root, dir);
  if (!isDir(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(full, f));
}

export function loadCases(root: string, dir: string): EvalCase[] {
  return caseFiles(root, dir).map((f) => validate(readJson<EvalCase>(f), f));
}

export function saveCase(root: string, dir: string, c: EvalCase): string {
  const path = join(root, dir, `${c.id}.json`);
  writeJson(path, c);
  return path;
}

/** Fail loudly at load: a malformed case silently scoring zero is worse than a crash. */
export function validate(c: EvalCase, where: string): EvalCase {
  const need = ['id', 'title', 'prompt'] as const;
  for (const field of need) {
    if (typeof c[field] !== 'string' || c[field] === '') {
      throw new Error(`${where}: case is missing "${field}"`);
    }
  }
  if (!Array.isArray(c.assertions) || c.assertions.length === 0) {
    throw new Error(`${where}: case has no assertions, so it cannot pass or fail`);
  }
  for (const a of c.assertions) {
    if (!(ASSERTION_KINDS as readonly string[]).includes(a.kind)) {
      throw new Error(`${where}: unknown assertion kind "${a.kind}"`);
    }
    if (a.kind.endsWith('_pattern')) {
      try {
        new RegExp(a.value);
      } catch {
        throw new Error(`${where}: assertion value is not a valid regular expression: ${a.value}`);
      }
    }
  }
  return {
    ...c,
    category: c.category ?? 'uncategorised',
    paths: Array.isArray(c.paths) ? c.paths : [],
    weight: typeof c.weight === 'number' ? c.weight : 1,
  };
}

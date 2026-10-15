import { readFileSync } from 'node:fs';
import { dirname, join, normalize as nodeNormalize } from 'node:path';
import { normalize, walk } from '@keel/core';

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rb'];

const JS_IMPORT = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const PY_IMPORT = /^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/gm;

export interface DepGraph {
  /** path -> files that import it. */
  dependents: Map<string, Set<string>>;
  files: string[];
  /** Import specifiers that could not be resolved inside the repo. */
  unresolved: number;
}

/**
 * Reverse dependency counts from static imports. Only intra-repo, resolvable
 * specifiers count — an unresolved import is reported, never guessed at.
 */
export function buildGraph(root: string): DepGraph {
  const files = walk(root, { exts: SOURCE_EXTS, maxFiles: 20_000 });
  const known = new Set(files);
  const dependents = new Map<string, Set<string>>();
  let unresolved = 0;

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const spec of specifiers(text, file)) {
      const target = resolveSpec(spec, file, known);
      if (target === null) {
        unresolved++;
        continue;
      }
      const set = dependents.get(target) ?? new Set<string>();
      set.add(file);
      dependents.set(target, set);
    }
  }
  return { dependents, files, unresolved };
}

function specifiers(text: string, file: string): string[] {
  const out: string[] = [];
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) {
    for (const m of text.matchAll(JS_IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec !== undefined) out.push(spec);
    }
  }
  if (file.endsWith('.py')) {
    for (const m of text.matchAll(PY_IMPORT)) {
      const spec = m[1] ?? m[2];
      if (spec !== undefined) out.push(spec);
    }
  }
  return out;
}

export function resolveSpec(spec: string, from: string, known: Set<string>): string | null {
  if (spec.startsWith('.')) {
    const base = normalize(nodeNormalize(join(dirname(from), spec)));
    return firstKnown(base, known);
  }
  if (from.endsWith('.py') && !spec.startsWith('.')) {
    // A dotted module path is tried as a repo path, which covers src-layout projects.
    return firstKnown(spec.replace(/\./g, '/'), known);
  }
  return null;
}

function firstKnown(base: string, known: Set<string>): string | null {
  const candidates = [
    base,
    ...SOURCE_EXTS.map((e) => `${base}${e}`),
    ...SOURCE_EXTS.map((e) => `${base}/index${e}`),
    `${base}/__init__.py`,
  ];
  for (const c of candidates) {
    const n = normalize(c);
    if (known.has(n)) return n;
  }
  return null;
}

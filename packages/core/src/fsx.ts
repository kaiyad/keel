import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { normalize } from './globs.js';

const SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.venv', '__pycache__',
  '.turbo', '.cache', 'vendor', '.keel',
]);

export interface WalkOptions {
  /** Only return files whose extension is in this set (with the dot). */
  exts?: string[];
  skipDirs?: Set<string>;
  maxFiles?: number;
}

/** Repo-relative, slash-separated paths, depth-first, skipping the usual noise. */
export function walk(root: string, opts: WalkOptions = {}): string[] {
  const skip = opts.skipDirs ?? SKIP;
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github') {
        if (skip.has(e.name) || e.isDirectory()) continue;
      }
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue;
        stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      if (opts.exts && !opts.exts.some((x) => e.name.endsWith(x))) continue;
      out.push(normalize(relative(root, full)));
      if (opts.maxFiles !== undefined && out.length >= opts.maxFiles) return out.sort();
    }
  }
  return out.sort();
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function readJsonOr<T>(path: string, fallback: T): T {
  try {
    return readJson<T>(path);
  } catch {
    return fallback;
  }
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

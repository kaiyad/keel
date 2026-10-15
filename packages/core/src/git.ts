import { execFileSync } from 'node:child_process';

export interface Commit {
  hash: string;
  date: string;
  subject: string;
}

export function git(args: string[], cwd: string): string {
  // stderr is captured rather than inherited, so a repo without commits does not
  // print git's own complaints into a report.
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** null rather than a throw, for the many places where "no git here" is fine. */
export function gitOr(args: string[], cwd: string): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

export function isRepo(cwd: string): boolean {
  return gitOr(['rev-parse', '--git-dir'], cwd) !== null;
}

export function repoRoot(cwd: string): string | null {
  return gitOr(['rev-parse', '--show-toplevel'], cwd);
}

export function changedFiles(base: string, cwd: string): string[] {
  const ref = gitOr(['merge-base', 'HEAD', base], cwd) ?? base;
  const out = gitOr(['diff', '--name-only', `${ref}...HEAD`], cwd);
  const staged = gitOr(['diff', '--name-only', '--cached'], cwd) ?? '';
  const dirty = gitOr(['diff', '--name-only'], cwd) ?? '';
  const all = [out ?? '', staged, dirty].join('\n');
  return [...new Set(all.split('\n').map((s) => s.trim()).filter((s) => s !== ''))].sort();
}

export function fileLog(path: string, cwd: string, limit = 400): Commit[] {
  const out = gitOr(
    ['log', `-n${limit}`, '--follow', '--date=short', '--format=%h%x09%ad%x09%s', '--', path],
    cwd,
  );
  if (out === null || out === '') return [];
  return out.split('\n').map((line) => {
    const [hash = '', date = '', ...rest] = line.split('\t');
    return { hash, date, subject: rest.join('\t') };
  });
}

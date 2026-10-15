/** Path globs, enough of them for scopes like `src/payments/**` and `**\/*.sql`. */

export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] ?? '';
    if (ch === '*') {
      const double = glob[i + 1] === '*';
      if (double) {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      re += '[^/]';
      continue;
    }
    re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchGlob(glob: string, path: string): boolean {
  return globToRegExp(glob).test(normalize(path));
}

export function matchAny(globs: string[], path: string): boolean {
  return globs.some((g) => matchGlob(g, path));
}

export function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * A representative concrete path for a glob: wildcards become one opaque segment.
 * Used to decide whether two scopes can refer to the same file without
 * enumerating the filesystem.
 */
export function globLiteral(glob: string): string {
  return normalize(glob)
    .replace(/\*\*\/?/g, 'x/')
    .replace(/[*?]+/g, 'x')
    .replace(/\/+$/, '')
    .replace(/\/\//g, '/');
}

export function scopesOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  return matchGlob(a, globLiteral(b)) || matchGlob(b, globLiteral(a));
}

/** Longest leading run of segments with no wildcard — the glob's directory anchor. */
export function globPrefix(glob: string): string {
  const parts = normalize(glob).split('/');
  const keep: string[] = [];
  for (const p of parts) {
    if (p.includes('*') || p.includes('?')) break;
    keep.push(p);
  }
  return keep.join('/');
}

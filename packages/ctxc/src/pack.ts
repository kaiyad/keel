import { matchAny } from '@keel/core';
import { byPriority, renderDoc } from './bundle.js';
import type { Bundle, ContextDoc } from './types.js';

/** Documents that apply to a path: scoped ones that match, plus unscoped globals. */
export function applicable(bundle: Bundle, path: string): ContextDoc[] {
  return bundle.docs
    .filter((doc) => (doc.scope.length === 0 ? true : matchAny(doc.scope, path)))
    .sort(byPriority);
}

export function pack(bundle: Bundle, paths: string[]): { docs: ContextDoc[]; markdown: string } {
  const seen = new Map<string, ContextDoc>();
  for (const p of paths) for (const doc of applicable(bundle, p)) seen.set(doc.id, doc);
  const docs = [...seen.values()].sort(byPriority);
  const header = [
    `<!-- ctxc pack · context ${bundle.version} · ${paths.length} path(s) -->`,
    `# Context for this change`,
    '',
    paths.map((p) => `- \`${p}\``).join('\n'),
    '',
    docs.length === 0
      ? '_No compiled context applies to these paths. That is itself worth knowing._'
      : `${docs.length} document(s) apply, most binding first.`,
    '',
  ].join('\n');
  return { docs, markdown: `${header}\n${docs.map(renderDoc).join('\n\n')}\n`.trimEnd() + '\n' };
}

/** Share of code files that have at least one rule, deprecation or ownership doc. */
export function coverage(bundle: Bundle, codeFiles: string[]): { covered: number; total: number } {
  const binding = bundle.docs.filter(
    (d) => d.kind === 'rule' || d.kind === 'deprecation' || d.kind === 'ownership',
  );
  let covered = 0;
  for (const f of codeFiles) {
    if (binding.some((d) => matchAny(d.scope, f))) covered++;
  }
  return { covered, total: codeFiles.length };
}

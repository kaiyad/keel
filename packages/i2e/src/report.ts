import type { Comparison } from './run.js';
import type { Run } from './types.js';

export function markdownReport(run: Run, cmp: Comparison): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines: string[] = [
    `# Incident eval — ${run.label}`,
    '',
    `${run.passed}/${run.caseCount} incident cases pass (${pct(run.score)}) · agent \`${run.agent}\` · ${run.at}`,
    run.contextVersion === undefined ? '' : `Context version \`${run.contextVersion}\`.`,
    '',
    '| category | passed | total |',
    '| --- | --- | --- |',
    ...Object.entries(run.byCategory)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => `| ${k} | ${v.passed} | ${v.total} |`),
    '',
  ];

  if (cmp.previous !== null) {
    lines.push(
      `Compared with \`${cmp.previous.label}\` (${pct(cmp.previous.score)}): ` +
        `${cmp.regressions.length} regression(s), ${cmp.fixes.length} newly passing.`,
      '',
    );
    if (cmp.regressions.length > 0) {
      lines.push('## Regressions', '', ...cmp.regressions.map((id) => `- \`${id}\``), '');
    }
  }

  const failures = run.results.filter((r) => !r.passed);
  if (failures.length > 0) {
    lines.push('## Failing cases', '');
    for (const r of failures) {
      lines.push(`### \`${r.id}\` (${r.category})`, '');
      if (r.error !== undefined) lines.push(`Harness error: ${r.error}`, '');
      for (const a of r.assertions.filter((x) => !x.passed)) {
        lines.push(`- **${a.assertion.kind}** \`${a.assertion.value}\` — ${a.detail}`);
        if (a.assertion.why !== undefined) lines.push(`  - ${a.assertion.why}`);
      }
      lines.push('');
    }
  }
  return `${lines.filter((l) => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

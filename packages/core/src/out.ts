const plain = process.env['NO_COLOR'] !== undefined || !process.stdout.isTTY;

const wrap = (code: string) => (s: string) => (plain ? s : `\u001b[${code}m${s}\u001b[0m`);

export const dim = wrap('2');
export const bold = wrap('1');
export const red = wrap('31');
export const green = wrap('32');
export const yellow = wrap('33');

export interface Column {
  head: string;
  align?: 'left' | 'right';
}

export function table(cols: Column[], rows: string[][]): string {
  const widths = cols.map((c, i) =>
    Math.max(visible(c.head), ...rows.map((r) => visible(r[i] ?? ''))),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => {
        const w = widths[i] ?? 0;
        const pad = ' '.repeat(Math.max(0, w - visible(cell)));
        return cols[i]?.align === 'right' ? pad + cell : cell + pad;
      })
      .join('  ')
      .trimEnd();
  const head = line(cols.map((c) => bold(c.head)));
  const rule = dim(widths.map((w) => '─'.repeat(w)).join('  '));
  return [head, rule, ...rows.map(line)].join('\n');
}

/** Width ignoring escape codes, so colored cells still line up. */
function visible(s: string): number {
  return s.replace(/\u001b\[[0-9;]*m/g, '').length;
}

export function bar(fraction: number, width = 12): string {
  const n = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return '█'.repeat(n) + dim('·'.repeat(width - n));
}

export function heading(text: string): string {
  return `\n${bold(text)}\n${dim('─'.repeat(text.length))}`;
}

export type Severity = 'error' | 'warn' | 'info';

export interface Diagnostic {
  severity: Severity;
  /** Stable machine-readable code, e.g. `contradictory-rule`. CI pins on these. */
  code: string;
  message: string;
  file?: string;
  line?: number;
  /** What to do about it, in one imperative sentence. */
  hint?: string;
}

export function countBy(diags: Diagnostic[], severity: Severity): number {
  return diags.filter((d) => d.severity === severity).length;
}

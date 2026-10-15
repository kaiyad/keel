import { matchGlob, normalize } from '@keel/core';
import type { Assertion, AssertionResult } from './types.js';

export interface Evidence {
  /** Everything the agent wrote, including any diff it printed. */
  output: string;
  /** Paths the agent touched, when the harness can observe them. */
  touched: string[];
}

export function check(assertions: Assertion[], evidence: Evidence): AssertionResult[] {
  return assertions.map((assertion) => evaluate(assertion, evidence));
}

function evaluate(assertion: Assertion, evidence: Evidence): AssertionResult {
  const { kind, value } = assertion;
  if (kind === 'require_pattern' || kind === 'forbid_pattern') {
    const re = new RegExp(value, 'm');
    const hit = re.exec(evidence.output);
    const found = hit !== null;
    const want = kind === 'require_pattern';
    return {
      assertion,
      passed: found === want,
      detail: found ? `matched: ${excerpt(hit?.[0] ?? '')}` : 'no match',
    };
  }
  const touched = evidence.touched.map(normalize);
  const found = touched.some((p) => p === normalize(value) || matchGlob(value, p));
  const want = kind === 'require_path';
  return {
    assertion,
    passed: found === want,
    detail: found ? `touched ${value}` : `did not touch ${value}`,
  };
}

/** Paths from a unified diff, so a case can assert on what the agent edited. */
export function touchedFromDiff(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split('\n')) {
    const plus = /^\+\+\+ [ab]\/(.+)$/.exec(line);
    if (plus?.[1] !== undefined) out.add(plus[1].trim());
    const diff = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
    if (diff?.[2] !== undefined) out.add(diff[2].trim());
  }
  return [...out].filter((p) => p !== '/dev/null');
}

function excerpt(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 80 ? `${one.slice(0, 77)}...` : one;
}

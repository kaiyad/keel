import { join } from 'node:path';
import { readJsonOr, writeJson } from '@keel/core';
import { DEFAULT_CONFIG, type Config } from './types.js';

export function loadConfig(root: string): Config {
  const partial = readJsonOr<Partial<Config>>(join(root, '.keel', 'autonomy.json'), {});
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    weights: { ...DEFAULT_CONFIG.weights, ...(partial.weights ?? {}) },
    policies: { ...DEFAULT_CONFIG.policies, ...(partial.policies ?? {}) },
  };
}

export function writeDefaultConfig(root: string): string {
  const path = join(root, '.keel', 'autonomy.json');
  writeJson(path, DEFAULT_CONFIG);
  return path;
}

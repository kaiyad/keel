import { join } from 'node:path';
import { readJsonOr } from '@keel/core';
import { DEFAULT_CONFIG, type Config } from './types.js';

export function loadConfig(root: string): Config {
  return { ...DEFAULT_CONFIG, ...readJsonOr<Partial<Config>>(join(root, '.keel', 'i2e.json'), {}) };
}

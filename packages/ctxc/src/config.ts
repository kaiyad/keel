import { join } from 'node:path';
import { readJsonOr } from '@keel/core';
import { DEFAULT_CONFIG, type Config } from './types.js';

export function loadConfig(root: string): Config {
  const partial = readJsonOr<Partial<Config>>(join(root, '.keel', 'ctxc.json'), {});
  return { ...DEFAULT_CONFIG, ...partial };
}

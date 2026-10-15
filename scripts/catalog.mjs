#!/usr/bin/env node
// Regenerates the product table in README.md from catalog/catalog.json.
// Run after editing the catalog: npm run catalog
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { products } = JSON.parse(readFileSync(join(root, 'catalog/catalog.json'), 'utf8'));

const STATUS = {
  built: '**built**',
  next: 'next',
  spec: 'spec',
};

const row = (p) =>
  `| ${p.n} | ${p.name} | ${p.group} | ${p.cost} | ${STATUS[p.status] ?? p.status}${p.package ? ` \`${p.bin}\`` : ''} |`;

const table = [
  '| # | product | part | cost | status |',
  '| --- | --- | --- | --- | --- |',
  ...products.map(row),
].join('\n');

const readmePath = join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const start = '<!-- catalog:start -->';
const end = '<!-- catalog:end -->';
const a = readme.indexOf(start);
const b = readme.indexOf(end);
if (a === -1 || b === -1) {
  console.error(`README.md is missing the ${start} / ${end} markers`);
  process.exit(1);
}
const next = `${readme.slice(0, a + start.length)}\n\n${table}\n\n${readme.slice(b)}`;
if (next === readme) {
  console.log('catalog table already up to date');
} else {
  writeFileSync(readmePath, next);
  console.log(`catalog table written: ${products.length} products`);
}

#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const rootIndex = process.argv.indexOf('--root');
const root = rootIndex >= 0 ? resolve(process.argv[rootIndex + 1] ?? '') : process.cwd();

const files = [
  'bin/knowledge.js',
  'bin/knowledge-mcp.js',
  'bin/knowledge-serve.js',
  'bin/knowledge-migrate.js',
  'dist/index.js',
  'dist/storage.js',
  'dist/serve.js',
];

for (const file of files) {
  const path = join(root, file);
  const input = readFileSync(path, 'utf8');
  const output = input
    .replace(/[ \t]+$/gm, '')
    .replaceAll(/node_modules\/\.pnpm\/([^/\n]+)\/node_modules\//g, 'node_modules/');
  if (output !== input) {
    writeFileSync(path, output);
  }
}

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
  'dist/mcp-payload.js',
  'dist/storage.js',
  'dist/serve.js',
];

for (const file of files) {
  const path = join(root, file);
  const input = readFileSync(path, 'utf8');
  const output = input
    .replace(/[ \t]+$/gm, '')
    .replaceAll(/node_modules\/\.pnpm\/([^/\n]+)\/node_modules\//g, 'node_modules/')
    .replace(/^\/\/ [^\n]*node_modules\/([^\n]+)$/gm, '// node_modules/$1');
  if (/^\/\/ (?!node_modules\/).*node_modules\//m.test(output)) {
    throw new Error(`generated file retains topology-dependent dependency provenance: ${file}`);
  }
  for (const forbiddenRoot of [resolve(process.cwd()), resolve(process.cwd(), 'node_modules')]) {
    if (output.includes(forbiddenRoot)) {
      throw new Error(`generated file retains an absolute workspace/dependency path: ${file}`);
    }
  }
  if (output !== input) {
    writeFileSync(path, output);
  }
}

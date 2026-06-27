#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'node:fs';

const files = [
  'bin/knowledge.js',
  'bin/knowledge-mcp.js',
  'dist/index.js',
  'dist/storage.js',
];

for (const file of files) {
  const input = readFileSync(file, 'utf8');
  const output = input.replace(/[ \t]+$/gm, '');
  if (output !== input) {
    writeFileSync(file, output);
  }
}

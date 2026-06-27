#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const stableDiff = spawnSync('git', ['diff', '--exit-code', '--', 'bin/knowledge-mcp.js', 'dist'], {
  encoding: 'utf8',
  stdio: 'inherit',
});

if ((stableDiff.status ?? 1) !== 0) {
  process.exit(stableDiff.status ?? 1);
}

const generatedFiles = [
  'bin/knowledge.js',
  'bin/knowledge-mcp.js',
  'dist/index.js',
  'dist/storage.js',
];

const stalePatterns = [
  /path:\s*decodeURIComponent\([^)]*\.pathname\)/,
  /file:\/\/\$\{/,
];

for (const file of generatedFiles) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of stalePatterns) {
    if (pattern.test(text)) {
      console.error(`${file} contains stale generated Windows path handling: ${pattern}`);
      process.exit(1);
    }
  }
}

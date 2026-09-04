// Regression tests for the bin runtime contract (reviewer finding, cycle 2):
//
//   The CLI import graph reaches TypeScript-only modules — the vendored
//   storage-kit (`.js` import specifiers that exist only as `.ts`, resolved by
//   Bun but not by Node) and `server/pg-migrations.ts`. Under a `node` shebang
//   every local command fails with "Cannot find module .../storage-kit/index.js".
//
//   The contract: all three bins carry a `#!/usr/bin/env bun` shebang, the
//   package declares bun as the runtime, and each bin executes successfully
//   when invoked through that shebang — the exact mechanism the installed
//   artifact uses (`bun install -g` symlinks the bin; the kernel resolves the
//   shebang to `env bun`).

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = join(import.meta.dir, '..');
const BINS = ['bin/notes.mjs', 'bin/notes-mcp.mjs', 'bin/notes-serve.mjs'];
// The direct-entry modules the bins load (and README instructs running
// straight from the repo) carry the same graph and the same shebang contract.
const ENTRIES = [...BINS, 'cli/notes.mjs', 'mcp/notes-mcp.mjs'];

// The shebang is `#!/usr/bin/env bun`, so PATH must contain bun's own bin
// directory for the kernel's `env bun` lookup — defensive when the suite runs
// from an environment where bun is not already on PATH.
const bunBinDir = dirname(process.execPath);
const execEnv = {
  ...process.env,
  PATH: `${bunBinDir}${process.env.PATH ? `:${process.env.PATH}` : ''}`,
};

function directExec(bin, args, env = {}) {
  // Execute the bin file itself — the kernel honors the shebang, exactly like
  // the installed artifact's symlink target.
  const root = mkdtempSync(join(tmpdir(), 'notes-bin-runtime-'));
  const result = spawnSync(join(REPO, bin), args, {
    env: { ...execEnv, HASNA_NOTES_ROOT: root, ...env },
    encoding: 'utf8',
  });
  rmSync(root, { recursive: true, force: true });
  return { rc: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('bin runtime contract', () => {
  test('all bins and direct entries carry the bun shebang', () => {
    for (const bin of ENTRIES) {
      const first = readFileSync(join(REPO, bin), 'utf8').split('\n')[0];
      expect(first, `${bin} shebang`).toBe('#!/usr/bin/env bun');
    }
  });

  test('bins are executable files (kernel shebang path works)', () => {
    for (const bin of BINS) {
      const mode = statSync(join(REPO, bin)).mode;
      expect(mode & 0o111, `${bin} executable bit`).not.toBe(0);
    }
  });

  test('package engines declare bun, not node', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    expect(pkg.engines).toEqual({ bun: '>=1.0' });
  });

  test('bin/notes.mjs authenticated HTTPS status runs through the shebang', () => {
    const { rc, stdout, stderr } = directExec('bin/notes.mjs', ['storage', 'status', '--json'], {
      HASNA_NOTES_API_URL: 'https://notes.example.test',
      HASNA_NOTES_API_KEY: 'secret',
    });
    expect(stderr).toBe('');
    expect(rc).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.client.transport).toBe('http');
    expect(report.localFallback).toBe(false);
  });

  test('bin/notes.mjs help runs through the shebang', () => {
    const { rc, stdout } = directExec('bin/notes.mjs', ['--help']);
    expect(rc).toBe(0);
    expect(stdout).toContain('Usage:');
  });

  test('bin/notes.mjs fails closed rather than opening a local store', () => {
    const { rc, stdout, stderr } = directExec('bin/notes.mjs', ['list', '--limit', '1']);
    expect(rc).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('HASNA_NOTES_API_URL');
  });
});

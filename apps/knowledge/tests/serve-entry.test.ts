import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { knowledgeTestEnv } from './preload';
import { handleEarlyArgs, getPackageVersion } from '../src/serve-entry.ts';

// Binds-before-args regression (O15-00294, same class as the projects-serve
// fix): knowledge-serve --help / --version must answer with exit 0 and no
// HASNA_KNOWLEDGE_DATABASE_URL in the environment. Before this fix the serve
// entry built the DB client before looking at argv, so --help died with
// "knowledge server requires HASNA_KNOWLEDGE_DATABASE_URL for PostgreSQL".
const BIN = new URL('../bin/knowledge-serve.js', import.meta.url).pathname;

// The preload strips the DB URL and API route keys; strip the signing-secret
// and guarded-authority keys too so the spawn is hermetic in every direction.
const SIGNING_KEYS = [
  'HASNA_KNOWLEDGE_API_SIGNING_KEY',
  'API_KEY_SIGNING_SECRET',
  'HASNA_API_SIGNING_KEY',
  'HASNA_KNOWLEDGE_AUTHORITY_CLASSIFICATION',
  'HASNA_KNOWLEDGE_AUTHORITY_ID',
];

function serveEnvWithoutDbUrl(): Record<string, string> {
  const env = knowledgeTestEnv();
  for (const key of SIGNING_KEYS) delete env[key];
  return env;
}

function runServeBin(args: string[]): { status: number; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [BIN, ...args], {
    env: serveEnvWithoutDbUrl(),
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    status: run.status ?? 1,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
  };
}

describe('knowledge-serve --help / --version without a database URL', () => {
  test('--help exits 0 and prints usage when HASNA_KNOWLEDGE_DATABASE_URL is unset', () => {
    const { status, stdout, stderr } = runServeBin(['--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('usage: knowledge-serve');
    expect(stdout).toContain('--help');
    expect(stdout).toContain('--version');
    // The DB-URL error that used to preempt --help must not appear anywhere.
    expect(stdout + stderr).not.toContain('HASNA_KNOWLEDGE_DATABASE_URL');
  });

  test('--version exits 0 and prints the package version when HASNA_KNOWLEDGE_DATABASE_URL is unset', () => {
    const { status, stdout, stderr } = runServeBin(['--version']);
    expect(status).toBe(0);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(stdout.trim()).toBe(pkg.version);
    expect(stdout + stderr).not.toContain('HASNA_KNOWLEDGE_DATABASE_URL');
  });

  test('a bare start argv is classified as start, never as an early exit', () => {
    expect(handleEarlyArgs([])).toBe('start');
    expect(handleEarlyArgs(['--port', '9000'])).toBe('start');
  });
});

describe('handleEarlyArgs classification', () => {
  test('--help and --version classify before any env-bound work', () => {
    expect(handleEarlyArgs(['--help'])).toBe('help');
    expect(handleEarlyArgs(['--version'])).toBe('version');
    expect(handleEarlyArgs(['--help', '--port', '8080'])).toBe('help');
    expect(handleEarlyArgs(['--port', '8080', '--version'])).toBe('version');
  });
});

describe('getPackageVersion', () => {
  test('matches the package.json version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(getPackageVersion()).toBe(pkg.version);
  });
});

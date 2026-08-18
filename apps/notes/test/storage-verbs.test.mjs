// Regression tests for the storage verbs and the fail-closed gates:
//   - `notes storage status --json` reports client transport + server
//     backend selection WITHOUT credentials,
//   - `notes storage migrate --dry-run` refuses when the postgres backend is
//     not configured,
//   - scripts/apply-postgres-migrations.mjs fails closed without a DSN and
//     never echoes the DSN,
//   - scripts/pg-test-gate.mjs fails closed (exit 2) without
//     NOTES_TEST_DATABASE_URL — a proof gate that reports success when it did
//     not run is the vacuous check the contract's pgTestGate exists to prevent.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = join(import.meta.dir, '..');
let envBase;

beforeAll(() => {
  envBase = { ...process.env, HASNA_NOTES_ROOT: mkdtempSync(join(tmpdir(), 'notes-storage-verbs-')) };
});

afterAll(() => {
  spawnSync('rm', ['-rf', envBase.HASNA_NOTES_ROOT]);
});

function runCli(args, env = {}) {
  const result = spawnSync('bun', [join(REPO, 'cli/notes.mjs'), ...args], {
    env: { ...envBase, ...env },
    encoding: 'utf8',
  });
  return { rc: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('notes storage verbs', () => {
  test('storage status without API URL reports the local client transport', () => {
    const { rc, stdout } = runCli(['storage', 'status', '--json']);
    expect(rc).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.client.transport).toBe('local');
    expect(report.server.backend).toBe('sqlite');
  });

  test('storage status with API URL + key reports the http client transport', () => {
    const { rc, stdout } = runCli(['storage', 'status', '--json'], {
      HASNA_NOTES_API_URL: 'https://notes.example.test/v1',
      HASNA_NOTES_API_KEY: 'k',
    });
    expect(rc).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.client.transport).toBe('http');
  });

  test('storage status with API URL but no key fails closed', () => {
    const { rc, stdout, stderr } = runCli(['storage', 'status', '--json'], {
      HASNA_NOTES_API_URL: 'https://notes.example.test/v1',
    });
    expect(rc).toBe(1);
    expect(`${stdout}${stderr}`).toMatch(/HASNA_NOTES_API_KEY/);
  });

  test('storage status reports the postgres server backend without the DSN value', () => {
    const { rc, stdout } = runCli(['storage', 'status', '--json'], {
      HASNA_NOTES_DATABASE_URL: 'postgres://user:secret@db.example.test/notes',
    });
    expect(rc).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.server.backend).toBe('postgresql');
    expect(report.server.databaseUrlPresent).toBe(true);
    expect(JSON.stringify(report)).not.toContain('secret');
    expect(JSON.stringify(report)).not.toMatch(/postgres:\/\//);
  });

  test('storage migrate --dry-run refuses when the postgres backend is not configured', () => {
    const { rc, stdout, stderr } = runCli(['storage', 'migrate', '--dry-run', '--json']);
    expect(rc).toBe(1);
    expect(`${stdout}${stderr}`).toMatch(/HASNA_NOTES_DATABASE_URL/);
  });
});

describe('fail-closed gates', () => {
  test('apply-postgres-migrations.mjs fails without a DSN and never prints it', () => {
    const result = spawnSync('bun', [join(REPO, 'scripts/apply-postgres-migrations.mjs'), '--dry-run', '--json'], {
      env: { ...envBase, HASNA_NOTES_DATABASE_URL: undefined },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/HASNA_NOTES_DATABASE_URL/);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/postgres:\/\//);
  });

  test('pg-test-gate.mjs exits 2 (fail closed) without NOTES_TEST_DATABASE_URL', () => {
    const result = spawnSync('bun', [join(REPO, 'scripts/pg-test-gate.mjs')], {
      env: { ...envBase, NOTES_TEST_DATABASE_URL: undefined },
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/NOTES_TEST_DATABASE_URL/);
  });
});

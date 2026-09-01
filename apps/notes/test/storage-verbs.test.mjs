import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = join(import.meta.dir, '..');
let home;

beforeAll(() => { home = realpathSync(mkdtempSync(join(tmpdir(), 'notes-storage-verbs-'))); });
afterAll(() => { rmSync(home, { recursive: true, force: true }); });

function cleanEnv(extra = {}) {
  const env = { ...process.env, HOME: home, HASNA_DATA_HOME: join(home, 'xdg'), ...extra };
  for (const key of ['HASNA_NOTES_API_URL', 'HASNA_NOTES_API_KEY', 'HASNA_NOTES_DATABASE_URL']) {
    if (!(key in extra)) delete env[key];
  }
  return env;
}

function runCli(args, extra = {}) {
  const result = spawnSync('bun', [join(REPO, 'cli/notes.mjs'), ...args], {
    env: cleanEnv(extra), encoding: 'utf8',
  });
  return { rc: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('client storage boundary', () => {
  test('status fails closed without both HTTPS client values', () => {
    const result = runCli(['storage', 'status', '--json']);
    expect(result.rc).toBe(1);
    expect(result.stderr).toMatch(/HASNA_NOTES_API_URL/);
  });

  test('status reports only authenticated HTTPS and no local/DSN path', () => {
    const result = runCli(['storage', 'status', '--json'], {
      HASNA_NOTES_API_URL: 'https://notes.example.test/v1',
      HASNA_NOTES_API_KEY: 'not-printed',
    });
    expect(result.rc, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.client.transport).toBe('http');
    expect(report.client.scheme).toBe('https');
    expect(report.localFallback).toBe(false);
    expect(report.clientDatabaseDsn).toBe(false);
    expect(result.stdout).not.toContain('not-printed');
  });

  test('a server DSN in the client environment is rejected without disclosure', () => {
    const dsn = 'postgres://user:secret@example.test/notes';
    const result = runCli(['storage', 'status', '--json'], {
      HASNA_NOTES_API_URL: 'https://notes.example.test',
      HASNA_NOTES_API_KEY: 'key',
      HASNA_NOTES_DATABASE_URL: dsn,
    });
    expect(result.rc).toBe(1);
    expect(result.stderr).toContain('server-only');
    expect(`${result.stdout}${result.stderr}`).not.toContain(dsn);
    expect(`${result.stdout}${result.stderr}`).not.toContain('secret');
  });
});

describe('explicit data migration CLI', () => {
  test('dry-run is non-mutating and apply is copy-only', () => {
    const source = join(home, '.hasna', 'notes', 'notes');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'one.md'), 'one\n');

    const dry = runCli(['storage', 'migrate-legacy-path', '--source', 'legacy', '--dry-run', '--json']);
    expect(dry.rc, dry.stderr).toBe(0);
    expect(JSON.parse(dry.stdout).copyFiles).toBe(1);
    expect(existsSync(join(home, 'xdg', 'notes', 'notes', 'one.md'))).toBe(false);

    const unreviewed = runCli(['storage', 'migrate-legacy-path', '--source', 'legacy', '--yes', '--json']);
    expect(unreviewed.rc).toBe(1);
    expect(unreviewed.stderr).toContain('--plan-fingerprint');
    const mismatched = runCli(['storage', 'migrate-legacy-path', '--source', 'legacy', '--yes', '--plan-fingerprint', 'wrong', '--json']);
    expect(mismatched.rc).toBe(1);
    expect(existsSync(join(home, 'xdg', 'notes'))).toBe(false);

    const applied = runCli(['storage', 'migrate-legacy-path', '--source', 'legacy', '--yes', '--plan-fingerprint', JSON.parse(dry.stdout).planFingerprint, '--json']);
    expect(applied.rc, applied.stderr).toBe(0);
    expect(JSON.parse(applied.stdout).sourcePreserved).toBe(true);
    expect(readFileSync(join(home, 'xdg', 'notes', 'notes', 'one.md'), 'utf8')).toBe('one\n');
    expect(readFileSync(join(source, 'one.md'), 'utf8')).toBe('one\n');
  });
});

describe('server-only PostgreSQL gates', () => {
  test('migration runner fails closed without a DSN', () => {
    const result = spawnSync('bun', [join(REPO, 'scripts/apply-postgres-migrations.mjs'), '--dry-run', '--json'], {
      env: cleanEnv(), encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/HASNA_NOTES_DATABASE_URL/);
  });

  test('live PostgreSQL gate exits 2 when its test DSN is absent', () => {
    const env = cleanEnv();
    delete env.NOTES_TEST_DATABASE_URL;
    const result = spawnSync('bun', [join(REPO, 'scripts/pg-test-gate.mjs')], { env, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/NOTES_TEST_DATABASE_URL/);
  });
});

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
import { mkdtempSync, readdirSync, rmSync, readFileSync, statSync } from 'node:fs';
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

// Hermetic against the machine (hasna/apps#1720 validation): the child's
// resolver walks the AMBIENT tiers because it receives its own live
// process.env, so a provisioned macOS station's Keychain items
// (hasna.credentials.notes.api-key / api-url, account HASNA_STATION else the
// short hostname) would otherwise resolve here — turning the fixed-authority
// case into a Keychain-vs-env conflict and the no-credential case into a live
// fleet request. A sentinel HASNA_STATION makes the Keychain tier miss (item
// not found, exit 44), a throwaway HASNA_HOME makes the disk tier read an
// empty root, and the parent's own fleet variables never reach the child.
const STATION_SENTINEL = 'notes-test-no-such-station';
const AMBIENT_FLEET_KEYS = [
  'HASNA_NOTES_API_URL', 'HASNA_NOTES_API_KEY', 'HASNA_NOTES_API_KEY_OVERRIDE',
  'HASNA_NOTES_API_KEY_REF', 'HASNA_PROFILE', 'HASNA_HOME', 'HASNA_CONFIG_HOME',
  'HASNA_NOTES_DATABASE_URL', 'HASNA_STATION',
];
const execEnv = {
  ...process.env,
  PATH: `${bunBinDir}${process.env.PATH ? `:${process.env.PATH}` : ''}`,
};
for (const key of AMBIENT_FLEET_KEYS) delete execEnv[key];

function directExec(bin, args, env = {}) {
  // Execute the bin file itself — the kernel honors the shebang, exactly like
  // the installed artifact's symlink target. `root` is the throwaway
  // HASNA_HOME (exists, empty); the maintenance data root is a child of it
  // that does not exist, so `created` lists everything the child wrote.
  const root = mkdtempSync(join(tmpdir(), 'notes-bin-runtime-'));
  const result = spawnSync(join(REPO, bin), args, {
    env: {
      ...execEnv,
      HASNA_STATION: STATION_SENTINEL,
      HASNA_HOME: root,
      HASNA_NOTES_ROOT: join(root, 'notes-root'),
      ...env,
    },
    encoding: 'utf8',
  });
  const created = readdirSync(root);
  rmSync(root, { recursive: true, force: true });
  return { rc: result.status, stdout: result.stdout, stderr: result.stderr, created };
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
    const { rc, stdout, stderr, created } = directExec('bin/notes.mjs', ['storage', 'status', '--json'], {
      HASNA_NOTES_API_URL: 'https://notes.example.test',
      HASNA_NOTES_API_KEY: 'secret',
    });
    expect(stderr).toBe('');
    expect(rc).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.client.transport).toBe('http');
    expect(report.client.baseUrl).toBe('https://notes.example.test/v1');
    // The fixture pair resolved through the env tier: the sentinel station
    // kept the machine Keychain out, and the empty HASNA_HOME held no file.
    expect(report.client.apiKeyTier).toBe('env');
    expect(report.client.apiKeySource).toBe('HASNA_NOTES_API_KEY');
    expect(report.client.apiUrlSource).toBe('HASNA_NOTES_API_URL');
    expect(report.client.apiUrlPresent).toBe(true);
    expect(report.localFallback).toBe(false);
    expect(stdout).not.toContain('secret');
    expect(created).toEqual([]);
  });

  test('retired storage-mode selectors are inert at the CLI: status still resolves', () => {
    const { rc, stdout, stderr } = directExec('bin/notes.mjs', ['storage', 'status', '--json'], {
      HASNA_NOTES_API_URL: 'https://notes.example.test',
      HASNA_NOTES_API_KEY: 'secret',
      PERSONALNOTES_MODE: 'local',
      HASNA_NOTES_STORAGE_MODE: 'sqlite',
      HASNA_NOTES_MODE: 'cloud',
      NOTES_STORAGE_MODE: 'legacy',
      NOTES_MODE: 'local',
    });
    expect(stderr).toBe('');
    expect(rc).toBe(0);
    expect(JSON.parse(stdout).client.transport).toBe('http');
  });

  test('bin/notes.mjs help runs through the shebang', () => {
    const { rc, stdout } = directExec('bin/notes.mjs', ['--help']);
    expect(rc).toBe(0);
    expect(stdout).toContain('Usage:');
  });

  test('pure markdown helpers run offline: zero configuration, hostile env, no transport resolution', () => {
    // Headline contract: `markdown commands` and `markdown apply-command` are
    // pure Markdown transforms that must run BEFORE any transport resolution —
    // no URL, no key, no credentials file, no network — so they work in any
    // environment. The env carries a client-forbidden DSN and every retired
    // storage-mode selector: the old code refused on the DSN alone (client
    // environment) and on the selectors alone (retired ratchet), so success
    // here proves the offline branch precedes resolution.
    const hostile = {
      HASNA_NOTES_DATABASE_URL: 'postgresql://not-for-clients.example.test/notes',
      PERSONALNOTES_MODE: 'local',
      HASNA_NOTES_STORAGE_MODE: 'sqlite',
      HASNA_NOTES_MODE: 'cloud',
      NOTES_STORAGE_MODE: 'legacy',
      NOTES_MODE: 'local',
    };
    const commands = directExec('bin/notes.mjs', ['markdown', 'commands', '--json'], hostile);
    expect(commands.stderr).toBe('');
    expect(commands.rc).toBe(0);
    const listed = JSON.parse(commands.stdout);
    expect(Array.isArray(listed.commands)).toBe(true);
    expect(listed.commands.some((command) => command.id === 'bold')).toBe(true);
    expect(commands.created).toEqual([]);

    const applied = directExec('bin/notes.mjs', [
      'markdown', 'apply-command', 'bold', '--text', 'hello',
      '--selection-start', '0', '--selection-end', '5', '--json',
    ], hostile);
    expect(applied.stderr).toBe('');
    expect(applied.rc).toBe(0);
    expect(JSON.parse(applied.stdout).markdown).toBe('**hello**');
    expect(applied.created).toEqual([]);
  });

  test('network markdown helpers still fail closed without a credential', () => {
    // `markdown render <id>` reads a note: it needs the transport, so a
    // retired selector must not smuggle it through and the failure stays
    // transport-neutral (no retired ratchet, no canonical-API phrasing, no
    // local-mode hint).
    const rendered = directExec('bin/notes.mjs', [
      'markdown', 'render', '00000000-0000-0000-0000-000000000000', '--json',
    ], { PERSONALNOTES_MODE: 'local' });
    expect(rendered.rc).toBe(1);
    expect(rendered.stdout).toBe('');
    expect(rendered.stderr).toContain('HASNA_NOTES_API_URL');
    expect(rendered.stderr).not.toMatch(/retired|canonical|local-fallback|local mode/i);
    expect(rendered.created).toEqual([]);
  });

  test('bin/notes.mjs fails closed rather than opening a local store', () => {
    const { rc, stdout, stderr, created } = directExec('bin/notes.mjs', ['list', '--limit', '1']);
    expect(rc).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('HASNA_NOTES_API_URL');
    // The first stderr line names where the credential should live — every
    // tier, in chain order — and nothing local was opened or created.
    expect(stderr.split('\n')[0]).toMatch(/Keychain[\s\S]*credential file[\s\S]*HASNA_NOTES_API_KEY/);
    expect(stderr).not.toMatch(/local-fallback|local mode/i);
    expect(created).toEqual([]);
  });
});

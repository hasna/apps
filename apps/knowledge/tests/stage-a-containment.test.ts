import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.ts');

function runContainedCli(env: Record<string, string>, args = ['db', 'init', '--scope', 'project', '--json']) {
  const cwd = mkdtempSync(join(tmpdir(), 'knowledge-stage-a-cli-'));
  const home = join(cwd, 'home');
  const result = Bun.spawnSync(['bun', cli, ...args], {
    cwd,
    env: sanitizedLocalTestEnv({
      HASNA_KNOWLEDGE_STORAGE_MODE: undefined,
      PATH: process.env.PATH ?? '',
      HOME: home,
      USERPROFILE: home,
      BUN_CONFIG_INSTALL_AUTO: 'disable',
      ...env,
    }),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    cwd,
    home,
    result,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe('Stage-A CLI containment', () => {
  const cases: Array<{ name: string; env: Record<string, string> }> = [
    {
      name: 'explicit hosted mode',
      env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted' },
    },
    {
      name: 'complete hosted HTTP intent',
      env: {
        HASNA_KNOWLEDGE_API_URL: 'https://knowledge.invalid.test',
        HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key',
      },
    },
    {
      name: 'partial API URL intent',
      env: { HASNA_KNOWLEDGE_API_URL: 'https://knowledge.invalid.test' },
    },
    {
      name: 'partial API key intent',
      env: { HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key' },
    },
    {
      name: 'unknown mode',
      env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'mystery' },
    },
    {
      name: 'conflicting local and hosted modes',
      env: {
        HASNA_KNOWLEDGE_STORAGE_MODE: 'local',
        KNOWLEDGE_STORAGE_MODE: 'cloud',
      },
    },
    {
      name: 'local mode with active hosted credentials',
      env: {
        HASNA_KNOWLEDGE_STORAGE_MODE: 'local',
        HASNA_KNOWLEDGE_API_URL: 'https://knowledge.invalid.test',
        HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key',
      },
    },
    {
      name: 'database URL without operator role',
      env: { HASNA_KNOWLEDGE_DATABASE_URL: 'postgres://synthetic.invalid/knowledge' },
    },
  ];

  for (const scenario of cases) {
    test(`${scenario.name} fails before workspace construction`, () => {
      const run = runContainedCli(scenario.env);
      expect(run.result.exitCode).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toContain('KNOWLEDGE_');
      expect(existsSync(join(run.cwd, '.hasna'))).toBe(false);
      expect(existsSync(join(run.home, '.hasna'))).toBe(false);
    });
  }

  const commandFamilies = [
    'add', 'list', 'get', 'delete', 'update', 'archive', 'restore', 'upsert', 'untag',
    'export', 'prune', 'dedupe', 'stats', 'inventory', 'project-panel', 'paths', 'setup',
    'auth', 'remote', 'storage', 'machines', 'sync', 'db', 'wiki', 'app-wiki', 'source',
    'ingest', 'reindex', 'search', 'context', 'proposals', 'web', 'ask', 'build',
    'embeddings', 'providers', 'safety', 'events', 'webhooks',
  ];

  for (const command of commandFamilies) {
    test(`${command} family is gated before dispatch`, () => {
      const run = runContainedCli(
        { HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted' },
        [command, '--scope', 'project', '--json'],
      );
      expect(run.result.exitCode).toBe(1);
      expect(run.stderr).toContain('KNOWLEDGE_HOSTED_CONTAINED');
      expect(existsSync(join(run.cwd, '.hasna'))).toBe(false);
      expect(existsSync(join(run.home, '.hasna'))).toBe(false);
    });
  }

  test('help, version, and completion metadata remain pure under hosted env', () => {
    for (const args of [['--help'], ['--version'], ['--completions', 'bash']]) {
      const run = runContainedCli({ HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted' }, args);
      expect(run.result.exitCode).toBe(0);
      expect(run.stdout.length).toBeGreaterThan(0);
      expect(run.stderr).toBe('');
      expect(existsSync(join(run.cwd, '.hasna'))).toBe(false);
      expect(existsSync(join(run.home, '.hasna'))).toBe(false);
    }
  });
});

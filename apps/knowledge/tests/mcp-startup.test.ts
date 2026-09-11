import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };
import {
  KNOWLEDGE_API_KEY_ENV,
  KNOWLEDGE_API_URL_ENV,
  KNOWLEDGE_LOCAL_OPT_IN_ENV,
} from '../src/client-transport';
import { assertKnowledgeMcpTransportResolvable } from '../src/mcp.js';
import { knowledgeTestEnv } from './preload';

// ============================================================================
// The real MCP entry point, in a real subprocess, with every credential tier
// closed — the shape of a coding agent that registered `knowledge-mcp` on a
// station without fleet credentials (hasna/apps#1720 acceptance (c)). The
// server must fail closed at STARTUP: non-zero exit BEFORE the stdio transport
// is connected or an HTTP port is bound, so `initialize` is never answered and
// nothing on-box is created. Refusing individual tool calls is not enough —
// a healthy handshake followed by per-call errors is the false green #1868
// closed for mementos.
// ============================================================================

const MCP = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp.js');
const API_URL = 'https://knowledge.invalid';
const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'control', version: '0' } },
});

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A sandbox HOME with every tier closed: `knowledgeTestEnv` scrubs the env
 * tiers (canonical, alias, override, pointer, profile) and the HASNA_HOME /
 * HASNA_CONFIG_HOME roots, HOME anchors the disk tier and the workspace under
 * the sandbox, HASNA_STATION pins the Keychain account to one that does not
 * exist (the tier is also off under the NODE_ENV=test network guard), and the
 * suite's inherited local opt-in is blanked so nothing selects the on-box store.
 */
function closedTiers(extra: Record<string, string> = {}): { home: string; env: Record<string, string> } {
  const home = mkdtempSync(join(tmpdir(), 'knowledge-mcp-startup-'));
  tempDirs.push(home);
  const env = knowledgeTestEnv({
    HOME: home,
    USERPROFILE: home,
    HASNA_STATION: 'no-such-station',
    [KNOWLEDGE_LOCAL_OPT_IN_ENV]: '',
    ...extra,
  });
  return { home, env };
}

async function runMcp(
  args: string[],
  env: Record<string, string>,
  stdinText = '',
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', MCP, ...args], {
    env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (stdinText) proc.stdin.write(stdinText);
  // Closing stdin ends a stdio MCP session that DID start; one that failed
  // closed never reads it.
  proc.stdin.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function onBoxWorkspace(home: string): string {
  return join(home, '.hasna', 'knowledge');
}

describe('knowledge-mcp fails closed at startup', () => {
  test('FAILING INPUT: no credential and no opt-in — non-zero before serving, initialize unanswered, nothing created', async () => {
    const { home, env } = closedTiers();

    const { stdout, stderr, exitCode } = await runMcp([], env, `${INITIALIZE}\n`);

    expect(exitCode).not.toBe(0);
    // The handshake was never answered: no JSON-RPC result reached stdout.
    expect(stdout).toBe('');
    expect(stderr).not.toContain('serverInfo');
    expect(stderr).not.toContain('running on stdio');
    // The refusal names every place the credential was looked for, and the
    // opt-in that is the only road to the on-box store.
    expect(stderr).toContain('no API key could be resolved');
    expect(stderr).toContain('Keychain');
    expect(stderr).toContain(join(home, '.hasna', 'knowledge', 'config', 'credentials'));
    expect(stderr).toContain(KNOWLEDGE_API_KEY_ENV);
    expect(stderr).toContain(`${KNOWLEDGE_LOCAL_OPT_IN_ENV}=1`);
    expect(stderr).toContain('no local fallback');
    // No local-mode banner and no fallback event may accompany the rejection.
    expect(stderr).not.toContain('local mode');
    expect(stderr).not.toContain('knowledge-local-fallback');
    // Nothing on-box — no workspace skeleton, no *.db — was created on the way out.
    expect(existsSync(onBoxWorkspace(home))).toBe(false);
  }, 30_000);

  test('a configured authority with no resolvable credential fails closed the same way, without rendering the value', async () => {
    const { home, env } = closedTiers({ [KNOWLEDGE_API_URL_ENV]: API_URL });

    const { stdout, stderr, exitCode } = await runMcp([], env, `${INITIALIZE}\n`);

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain(KNOWLEDGE_API_KEY_ENV);
    expect(stderr).not.toContain(API_URL);
    expect(stderr).not.toContain('running on stdio');
    expect(existsSync(onBoxWorkspace(home))).toBe(false);
  }, 30_000);

  test('--http mode fails closed before binding a port', async () => {
    const { home, env } = closedTiers();

    const { stdout, stderr, exitCode } = await runMcp(['--http', '--port', '0'], env);

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain('no API key could be resolved');
    expect(stderr).not.toMatch(/listening|127\.0\.0\.1/);
    expect(existsSync(onBoxWorkspace(home))).toBe(false);
  }, 30_000);

  test('a retired storage selector is refused at startup, before serving', async () => {
    const { env } = closedTiers({ HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres' });

    const { stdout, stderr, exitCode } = await runMcp([], env, `${INITIALIZE}\n`);

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain('HASNA_KNOWLEDGE_STORAGE_MODE');
    expect(stderr).not.toContain('running on stdio');
  }, 30_000);

  test('control: the explicit HASNA_KNOWLEDGE_LOCAL=1 opt-in starts the server, answers initialize, and says "local" once on stderr', async () => {
    const { env } = closedTiers({ [KNOWLEDGE_LOCAL_OPT_IN_ENV]: '1' });

    const { stdout, stderr, exitCode } = await runMcp([], env, `${INITIALIZE}\n`);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('"serverInfo"');
    expect(stdout).toContain(`"version":"${pkg.version}"`);
    expect(stderr).toContain('local mode');
    expect(stderr.match(/local mode/g)).toHaveLength(1);
    expect(stderr).toContain('running on stdio');
  }, 30_000);

  test('control: a credential in the env tier starts the server hosted — initialize answered, no local banner, nothing created on-box', async () => {
    const { home, env } = closedTiers({
      [KNOWLEDGE_API_URL_ENV]: API_URL,
      [KNOWLEDGE_API_KEY_ENV]: 'k_fake_test_key',
    });

    const { stdout, stderr, exitCode } = await runMcp([], env, `${INITIALIZE}\n`);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('"serverInfo"');
    expect(stderr).not.toContain('local mode');
    expect(stderr).not.toContain('k_fake_test_key');
    expect(stdout).not.toContain('k_fake_test_key');
    // Startup resolves NAMES only and touches nothing on-box.
    expect(existsSync(onBoxWorkspace(home))).toBe(false);
  }, 30_000);
});

describe('knowledge-mcp metadata-only invocations', () => {
  test('--version prints the package version and exits zero without a credential and without starting a server', async () => {
    const { home, env } = closedTiers();

    const { stdout, stderr, exitCode } = await runMcp(['--version'], env);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
    expect(stderr).not.toContain('running on stdio');
    expect(stderr).not.toContain('no API key could be resolved');
    expect(existsSync(onBoxWorkspace(home))).toBe(false);
  }, 30_000);

  test('--help answers without a credential and documents --version', async () => {
    const { env } = closedTiers();

    const { stderr, exitCode } = await runMcp(['--help'], env);

    expect(exitCode).toBe(0);
    expect(stderr).toContain('Usage: knowledge-mcp');
    expect(stderr).toContain('--version');
    expect(stderr).not.toContain('running on stdio');
  }, 30_000);
});

describe('assertKnowledgeMcpTransportResolvable (the startup gate, in-process)', () => {
  test('throws the fail-closed diagnostic for an env with no credential and no opt-in', () => {
    // A caller-built env never reaches the Keychain (the tier is ambient), so
    // this is hermetic on a populated station too.
    expect(() => assertKnowledgeMcpTransportResolvable({ HOME: '/nonexistent/knowledge-mcp-gate' }))
      .toThrow(/no local fallback/);
  });

  test('returns the resolved report (names only) for the opt-in and for an env credential', () => {
    expect(assertKnowledgeMcpTransportResolvable({ HOME: '/nonexistent/knowledge-mcp-gate', [KNOWLEDGE_LOCAL_OPT_IN_ENV]: '1' }))
      .toMatchObject({ transport: 'sqlite', source: 'local-opt-in', api_key_present: false });
    const hosted = assertKnowledgeMcpTransportResolvable({
      HOME: '/nonexistent/knowledge-mcp-gate',
      [KNOWLEDGE_API_KEY_ENV]: 'k_fake_test_key',
    });
    expect(hosted).toMatchObject({ transport: 'http', source: 'default', api_key_present: true, api_key_tier: 'env' });
    expect(JSON.stringify(hosted)).not.toContain('k_fake_test_key');
  });
});

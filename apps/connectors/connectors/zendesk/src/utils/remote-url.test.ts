import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// The remote API URL used to fall back to a hardcoded deployment host. It no
// longer has a shipped default, so these lock in how the CLI behaves when it is
// unset: display commands must still print, and commands that genuinely need
// the URL must fail with actionable guidance rather than an uncaught throw.
//
// Resolution order itself is covered in config.test.ts. This file covers the
// CLI surface: os.homedir() does not observe runtime process.env.HOME mutation,
// so each case runs the real CLI in a subprocess with its own HOME.

const CLI = join(import.meta.dir, '..', 'cli', 'index.ts');
const ENV_KEY = 'ZENDESK_REMOTE_API_URL';

let home: string;

function runCli(args: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', CLI, ...args],
    env: { ...process.env, HOME: home, [ENV_KEY]: '', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: result.exitCode,
    out: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
  };
}

describe('CLI behaviour when the remote API URL is unset', () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'connect-zendesk-remote-url-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  test('config show reports it as unset instead of throwing', () => {
    const { code, out } = runCli(['config', 'show']);
    expect(code).toBe(0);
    expect(out).toContain('Remote API URL:');
    expect(out).toContain('not set');
  });

  test('remote url reports it as unset instead of throwing', () => {
    const { code, out } = runCli(['remote', 'url']);
    expect(code).toBe(0);
    expect(out).toContain('not set');
    expect(out).not.toContain('at getRemoteApiUrl');
  });

  test.each(['status', 'health'])(
    'remote %s fails with actionable guidance, not a stack trace',
    (sub) => {
      const { code, out } = runCli(['remote', sub]);
      expect(code).toBe(1);
      expect(out).toContain(ENV_KEY);
      expect(out).toContain('config set-remote-url');
      expect(out).not.toContain('at getRemoteApiUrl');
    },
  );

  test('no deployment host is baked in as a fallback', () => {
    // A regression here means someone reintroduced a literal default.
    const { out } = runCli(['remote', 'url']);
    expect(out).not.toMatch(/https?:\/\/\S+/);
  });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as builtRoot from '../dist/index.js';
import * as builtServe from '../dist/serve.js';
import { resolveKnowledgeRuntimeRole } from '../src/runtime-role.ts';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env';

const root = join(import.meta.dir, '..');
const builtCli = join(root, 'bin', 'knowledge.js');
const builtMcp = join(root, 'bin', 'knowledge-mcp.js');

const HOSTED_ROLE_SIGNALS = [
  ['CODEWITH_RUNTIME_ROLE', 'hosted'],
  ['CODEWITH_EXECUTION_ROLE', 'hosted'],
  ['CODEWITH_AGENT_ROLE', 'hosted'],
  ['CODEWITH_ROLE', 'hosted'],
  ['CODEWITH_HOSTED', 'true'],
  ['KNOWLEDGE_RUNTIME_ROLE', 'hosted'],
  ['KNOWLEDGE_EXECUTION_ROLE', 'hosted'],
  ['KNOWLEDGE_AGENT_ROLE', 'hosted'],
  ['KNOWLEDGE_ROLE', 'hosted'],
  ['KNOWLEDGE_HOSTED', 'true'],
] as const;

afterEach(() => {
  for (const [key] of HOSTED_ROLE_SIGNALS) delete process.env[key];
});

function builtProcessEnv(
  key: string,
  value: string,
  home: string,
): Record<string, string> {
  return sanitizedLocalTestEnv({
    HASNA_KNOWLEDGE_STORAGE_MODE: undefined,
    HOME: home,
    USERPROFILE: home,
    [key]: value,
  });
}

function containmentShape(error: unknown): Record<string, unknown> {
  expect(error).toMatchObject({
    name: 'KnowledgeContainmentError',
    code: 'KNOWLEDGE_HOSTED_CONTAINED',
    status: 503,
    role: 'hosted-client',
  });
  return error as Record<string, unknown>;
}

describe('rebuilt role-family parity across executable surfaces', () => {
  test('every canonical role family contains source, dist SDK/project-panel/server, CLI, and MCP', async () => {
    for (const [key, value] of HOSTED_ROLE_SIGNALS) {
      const cwd = mkdtempSync(join(tmpdir(), 'knowledge-built-role-'));
      const home = join(cwd, 'home');
      try {
        process.env[key] = value;

        expect(resolveKnowledgeRuntimeRole({ env: {} }).role).toBe('hosted-client');
        expect('resolveKnowledgeRuntimeRole' in builtRoot).toBe(false);

        let sdkError: unknown;
        try {
          builtRoot.createKnowledgeService({ scope: 'project', cwd, env: {} } as never);
        } catch (error) {
          sdkError = error;
        }
        containmentShape(sdkError);

        delete process.env[key];
        expect(resolveKnowledgeRuntimeRole({ env: {} }).role, `${key} source reset`).toBe('local');
        const service = builtRoot.createKnowledgeService({ scope: 'project', cwd, env: {} } as never);
        process.env[key] = value;
        let panelError: unknown;
        try {
          builtRoot.createKnowledgeProjectPanel('synthetic-project', { service });
        } catch (error) {
          panelError = error;
        }
        containmentShape(panelError);

        const serverResponse = await builtServe.createServeHandler({ version: 'test' } as never)(
          new Request('http://localhost/v1/notes'),
        );
        expect(serverResponse.status).toBe(503);
        expect(await serverResponse.json()).toMatchObject({
          code: 'KNOWLEDGE_AUTHORITY_UNAVAILABLE',
          status: 503,
        });

        const env = builtProcessEnv(key, value, home);
        const cli = Bun.spawnSync(['bun', builtCli, 'paths', '--scope', 'project', '--json'], {
          cwd,
          env,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(cli.exitCode).toBe(1);
        expect(new TextDecoder().decode(cli.stderr)).toContain('KNOWLEDGE_HOSTED_CONTAINED');

        const mcp = Bun.spawnSync(['bun', builtMcp], {
          cwd,
          env,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(mcp.exitCode).toBe(1);
        expect(new TextDecoder().decode(mcp.stderr)).toContain('KNOWLEDGE_HOSTED_CONTAINED');

        expect(existsSync(join(cwd, '.hasna'))).toBe(false);
        expect(existsSync(join(home, '.hasna'))).toBe(false);
      } finally {
        delete process.env[key];
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  });
});

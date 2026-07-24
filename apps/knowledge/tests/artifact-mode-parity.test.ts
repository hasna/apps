import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env.ts';

const repositoryRoot = join(import.meta.dir, '..');

async function expectContained(operation: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await operation();
    throw new Error('expected artifact containment');
  } catch (error) {
    expect(error).toMatchObject({ name: 'KnowledgeContainmentError', status: 503 });
  }
}

function childPut(entryUrl: string, artifactRoot: string, body: string) {
  const code = `
const { LocalArtifactStore } = await import(${JSON.stringify(entryUrl)});
try {
  const store = new LocalArtifactStore(${JSON.stringify(artifactRoot)});
  await store.put({ key: 'race.txt', body: ${JSON.stringify(body)} });
  console.log('ok');
} catch (error) {
  console.log('contained:' + String(error?.code ?? error?.name ?? 'error'));
}
`;
  return Bun.spawn({
    cmd: ['bun', '--eval', code],
    cwd: repositoryRoot,
    env: sanitizedLocalTestEnv({ BUN_CONFIG_INSTALL_AUTO: 'disable' }),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

describe('source and committed artifact confidentiality parity', () => {
  for (const entry of ['src/index.ts', 'dist/index.js'] as const) {
    test(`${entry} continuously enforces modes, replacement, concurrency, and cleanup`, async () => {
      const fixture = mkdtempSync(join(tmpdir(), 'knowledge-artifact-parity-'));
      const artifactRoot = join(fixture, 'artifacts');
      const entryUrl = pathToFileURL(join(repositoryRoot, entry)).href;
      mkdirSync(artifactRoot, { mode: 0o700 });
      try {
        const { LocalArtifactStore } = await import(entryUrl);
        const store = new LocalArtifactStore(artifactRoot);
        await store.put({ key: 'valid.txt', body: 'valid' });
        expect(statSync(artifactRoot).mode & 0o777).toBe(0o700);
        expect(statSync(join(artifactRoot, 'valid.txt')).mode & 0o777).toBe(0o600);
        expect(await store.getText('valid.txt')).toBe('valid');

        chmodSync(join(artifactRoot, 'valid.txt'), 0o640);
        await expectContained(() => store.getText('valid.txt'));
        await store.put({ key: 'valid.txt', body: 'replaced' });
        expect(statSync(join(artifactRoot, 'valid.txt')).mode & 0o777).toBe(0o600);
        expect(readFileSync(join(artifactRoot, 'valid.txt'), 'utf8')).toBe('replaced');

        chmodSync(artifactRoot, 0o750);
        await expectContained(() => store.getText('valid.txt'));
        await expectContained(() => store.put({ key: 'blocked.txt', body: 'blocked' }));
        expect(existsSync(join(artifactRoot, 'blocked.txt'))).toBe(false);
        chmodSync(artifactRoot, 0o700);

        writeFileSync(join(artifactRoot, 'race.txt'), 'baseline', { mode: 0o600 });
        const children = [
          childPut(entryUrl, artifactRoot, 'first'),
          childPut(entryUrl, artifactRoot, 'second'),
        ];
        const outputs = await Promise.all(children.map(async (child) => {
          const [exitCode, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ]);
          expect(exitCode, stderr).toBe(0);
          return stdout.trim();
        }));
        expect(outputs.some((output) => output === 'ok')).toBe(true);
        expect(['first', 'second']).toContain(readFileSync(join(artifactRoot, 'race.txt'), 'utf8'));
        expect(statSync(join(artifactRoot, 'race.txt')).mode & 0o777).toBe(0o600);
        expect(readdirSync(artifactRoot).filter((name) => name.startsWith('.knowledge-')))
          .toEqual([]);
      } finally {
        if (existsSync(artifactRoot)) chmodSync(artifactRoot, 0o700);
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }
});

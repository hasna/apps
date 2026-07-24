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
import { KNOWLEDGE_TEST_ROLE_ENV_KEYS } from './helpers/sanitized-env.ts';

const repositoryRoot = join(import.meta.dir, '..');

async function expectContained(operation: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await operation();
    throw new Error('expected artifact containment');
  } catch (error) {
    expect(error).toMatchObject({ name: 'KnowledgeContainmentError', status: 503 });
  }
}

function artifactWorker(
  entryUrl: string,
  artifactRoot: string,
  bodyPrefix: string,
): Worker {
  const code = `
for (const key of ${JSON.stringify(KNOWLEDGE_TEST_ROLE_ENV_KEYS)}) delete process.env[key];
process.env.HASNA_KNOWLEDGE_STORAGE_MODE = 'local';
const { LocalArtifactStore } = await import(${JSON.stringify(entryUrl)});
const store = new LocalArtifactStore(${JSON.stringify(artifactRoot)});
self.onmessage = async (event) => {
  if (event.data?.type !== 'write') return;
  const round = event.data.round;
  try {
    await store.put({ key: 'race.txt', body: ${JSON.stringify(bodyPrefix)} + '-' + round });
    self.postMessage({ type: 'done', round });
  } catch (error) {
    self.postMessage({
      type: 'error',
      round,
      code: String(error?.code ?? error?.name ?? 'error'),
      message: String(error?.message ?? 'artifact write failed'),
    });
  }
};
self.postMessage({ type: 'ready' });
`;
  return new Worker(`data:text/javascript,${encodeURIComponent(code)}`);
}

function nextWorkerMessage(worker: Worker): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const onMessage = (event: MessageEvent) => {
      cleanup();
      resolve(event.data as Record<string, unknown>);
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(event.error ?? new Error(event.message));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
  });
}

describe('source and committed artifact confidentiality parity', () => {
  for (const entry of ['src/index.ts', 'dist/index.js'] as const) {
    test(`${entry} continuously enforces modes, replacement, concurrency, and cleanup`, async () => {
      const fixture = mkdtempSync(join(tmpdir(), 'knowledge-artifact-parity-'));
      const artifactRoot = join(fixture, 'artifacts');
      const entryUrl = pathToFileURL(join(repositoryRoot, entry)).href;
      const rounds = 32;
      const workers: Worker[] = [];
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

        workers.push(
          artifactWorker(entryUrl, artifactRoot, 'first'),
          artifactWorker(entryUrl, artifactRoot, 'second'),
        );
        const readyMessages = await Promise.all(workers.map(nextWorkerMessage));
        expect(readyMessages.map(({ type }) => type)).toEqual(['ready', 'ready']);

        for (let round = 0; round < rounds; round += 1) {
          const first = `first-${round}`;
          const second = `second-${round}`;
          writeFileSync(join(artifactRoot, 'race.txt'), 'baseline', { mode: 0o600 });
          const doneMessages = workers.map(nextWorkerMessage);
          for (const worker of workers) worker.postMessage({ type: 'write', round });
          expect(await Promise.all(doneMessages)).toEqual([
            { type: 'done', round },
            { type: 'done', round },
          ]);
          expect([first, second]).toContain(readFileSync(join(artifactRoot, 'race.txt'), 'utf8'));
          expect(statSync(join(artifactRoot, 'race.txt')).mode & 0o777).toBe(0o600);
          expect(readdirSync(artifactRoot).filter((name) => name.startsWith('.knowledge-')))
            .toEqual([]);
        }
      } finally {
        for (const worker of workers) worker.terminate();
        if (existsSync(artifactRoot)) chmodSync(artifactRoot, 0o700);
        rmSync(fixture, { recursive: true, force: true });
      }
    }, 30_000);
  }
});

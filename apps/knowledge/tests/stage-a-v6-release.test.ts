import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { setAnchoredFsTestHook } from '../src/anchored-fs.ts';
import { createKnowledgeService } from '../src/service.ts';
import {
  loadStore,
  saveStore,
  withLock,
  type KnowledgeItem,
} from '../src/store.ts';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env.ts';

const repositoryRoot = join(import.meta.dir, '..');
const builtCli = join(repositoryRoot, 'bin', 'knowledge.js');

function text(bytes: Uint8Array | undefined): string {
  return new TextDecoder().decode(bytes);
}

function item(index: number, prefix = 'V6 inventory'): KnowledgeItem {
  const timestamp = '2026-07-19T00:00:00.000Z';
  return {
    id: `k_v6_${prefix.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${index}`,
    short_id: `v6-${index}`,
    title: `${prefix} ${index}`,
    content: `${prefix} body ${index}`,
    url: null,
    tags: [],
    archived: false,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function localEnv(home: string, overrides: Record<string, string | undefined> = {}): Record<string, string> {
  return sanitizedLocalTestEnv({
    HOME: home,
    USERPROFILE: home,
    BUN_CONFIG_INSTALL_AUTO: 'disable',
    CI: '1',
    ...overrides,
  });
}

function copyRepository(destination: string): void {
  cpSync(repositoryRoot, destination, {
    recursive: true,
    dereference: false,
    filter(source) {
      const path = relative(repositoryRoot, source);
      if (!path) return true;
      const first = path.split(/[\\/]/)[0];
      return first !== '.git'
        && first !== 'node_modules'
        && !first.startsWith('.knowledge-build-');
    },
  });
  symlinkSync(join(repositoryRoot, 'node_modules'), join(destination, 'node_modules'), 'dir');
}

function runBuild(root: string, injection?: string) {
  return Bun.spawnSync(['bun', 'scripts/build.mjs'], {
    cwd: root,
    env: localEnv(join(root, '.test-home'), {
      KNOWLEDGE_BUILD_INJECT_FAILURE: injection,
    }),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function runVerifier(root: string) {
  return Bun.spawnSync([
    'bun',
    join(repositoryRoot, 'scripts', 'verify-generated-artifacts.mjs'),
    '--root',
    root,
  ], {
    cwd: root,
    env: localEnv(join(root, '.test-home')),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function generatedDigest(root: string): string {
  const hash = createHash('sha256');
  const roots = [
    join(root, 'src', 'generated'),
    join(root, 'dist'),
    join(root, 'bin'),
    join(root, 'generated-artifacts.json'),
    join(root, 'repository-generated-artifacts.json'),
  ];
  const visit = (path: string) => {
    const stat = lstatSync(path);
    hash.update(relative(root, path));
    hash.update(String(stat.mode & 0o777));
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry));
    } else {
      hash.update(readFileSync(path));
    }
  };
  for (const path of roots) visit(path);
  return hash.digest('hex');
}

function transactionEntries(root: string): string[] {
  return readdirSync(root)
    .filter((entry) => entry.startsWith('.knowledge-build-'))
    .sort();
}

function ensureScratchKillInjection(root: string): void {
  const buildPath = join(root, 'scripts', 'build.mjs');
  const source = readFileSync(buildPath, 'utf8');
  if (source.includes('SIGKILL') && source.includes('KNOWLEDGE_BUILD_INJECT_FAILURE')) return;
  const anchor = '      completed.push({ ...replacement, backup, hadTarget });\n';
  if (!source.includes(anchor)) throw new Error('build replacement hook anchor changed');
  writeFileSync(buildPath, source.replace(anchor, `${anchor}      if (process.env.KNOWLEDGE_BUILD_INJECT_FAILURE === \`kill-\${index + 1}\`) {\n        process.kill(process.pid, 'SIGKILL');\n      }\n`));
}

describe('Stage A V6 durable release and snapshot regressions', () => {
  test('V6-5 SIGKILL at multiple replacement boundaries is recovered by the next verifier/build entry', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v6-kill-recovery-'));
    try {
      for (const boundary of [1, 2, 4]) {
        const scratch = join(fixture, `boundary-${boundary}`);
        copyRepository(scratch);
        mkdirSync(join(scratch, '.test-home'), { mode: 0o700 });
        ensureScratchKillInjection(scratch);
        const sourcePath = join(scratch, 'src', 'index.ts');
        writeFileSync(
          sourcePath,
          `${readFileSync(sourcePath, 'utf8')}\nexport const __stageAV6CrashProbe${boundary} = ${JSON.stringify(`boundary-${boundary}`)};\n`,
        );
        const before = generatedDigest(scratch);
        const killed = runBuild(scratch, `kill-${boundary}`);
        expect(killed.exitCode, `boundary ${boundary} unexpectedly completed`).not.toBe(0);
        expect(transactionEntries(scratch).length, `boundary ${boundary} left no recoverable transaction`).toBeGreaterThan(0);

        const recovered = runVerifier(scratch);
        expect(
          recovered.exitCode,
          `boundary ${boundary}: ${text(recovered.stderr)}${text(recovered.stdout)}`,
        ).toBe(0);
        expect(generatedDigest(scratch), `boundary ${boundary} did not roll back deterministically`).toBe(before);
        expect(transactionEntries(scratch), `boundary ${boundary} left transaction state`).toEqual([]);

        const completed = runBuild(scratch);
        expect(completed.exitCode, text(completed.stderr)).toBe(0);
        const verified = runVerifier(scratch);
        expect(verified.exitCode, text(verified.stderr)).toBe(0);
        expect(transactionEntries(scratch)).toEqual([]);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 60_000);

  test('V6-6 inventory retries a bounded snapshot raced by ordinary locked writers and survives add/inventory stress', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v6-inventory-race-'));
    const project = join(fixture, 'project');
    const home = join(fixture, 'home');
    const storePath = join(project, 'store.json');
    mkdirSync(project, { mode: 0o700 });
    mkdirSync(home, { mode: 0o700 });
    writeFileSync(storePath, `${JSON.stringify({ items: [item(0)] }, null, 2)}\n`, { mode: 0o600 });
    let fired = false;
    let deterministicError: unknown;
    let deterministicCount = -1;
    try {
      const service = createKnowledgeService({ scope: 'project', cwd: project, env: {} });
      setAnchoredFsTestHook((event) => {
        if (event !== 'snapshot-after-read' || fired) return;
        fired = true;
        setAnchoredFsTestHook(undefined);
        withLock(storePath, () => {
          const store = loadStore(storePath);
          store.items.push(item(1));
          saveStore(storePath, store);
        });
      });
      try {
        deterministicCount = service.inventory({ storePath }).summary.legacy_items;
      } catch (error) {
        deterministicError = error;
      } finally {
        setAnchoredFsTestHook(undefined);
      }

      const env = localEnv(home);
      const writerScript = `
        const launcher = ${JSON.stringify(builtCli)};
        for (let index = 0; index < 24; index += 1) {
          const result = Bun.spawnSync(['bun', launcher, 'add', 'Concurrent ' + index, 'body ' + index, '--scope', 'project', '--store', ${JSON.stringify(storePath)}, '--json'], {
            cwd: ${JSON.stringify(project)}, env: ${JSON.stringify(env)}, stdout: 'pipe', stderr: 'pipe',
          });
          if (result.exitCode !== 0) {
            console.error(new TextDecoder().decode(result.stderr));
            process.exit(1);
          }
        }
      `;
      const writer = Bun.spawn(['bun', '--eval', writerScript], {
        cwd: project,
        env,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const readerErrors: string[] = [];
      for (let index = 0; index < 72; index += 1) {
        const read = Bun.spawnSync([
          'bun',
          builtCli,
          'inventory',
          '--scope',
          'project',
          '--store',
          storePath,
          '--json',
        ], {
          cwd: project,
          env,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        if (read.exitCode !== 0) {
          readerErrors.push(text(read.stderr));
          continue;
        }
        const payload = JSON.parse(text(read.stdout));
        if (payload.ok !== true || payload.legacy_store?.read_error !== null) {
          readerErrors.push(`iteration ${index}: invalid inventory payload`);
        }
      }
      const writerExit = await writer.exited;
      const writerStderr = text(await new Response(writer.stderr).arrayBuffer());
      const final = Bun.spawnSync([
        'bun',
        builtCli,
        'inventory',
        '--scope',
        'project',
        '--store',
        storePath,
        '--json',
      ], {
        cwd: project,
        env,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(fired).toBe(true);
      expect(deterministicError).toBeUndefined();
      expect(deterministicCount).toBe(2);
      expect(writerExit, writerStderr).toBe(0);
      expect(readerErrors).toEqual([]);
      expect(final.exitCode, text(final.stderr)).toBe(0);
      expect(JSON.parse(text(final.stdout)).summary.legacy_items).toBe(26);
    } finally {
      setAnchoredFsTestHook(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 60_000);

  test('V6-7 generated verifier rejects descriptor/artifact aliases and exact-inventory hostile shapes', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v6-verifier-shapes-'));
    const scratch = join(fixture, 'root');
    const bypasses: string[] = [];
    try {
      copyRepository(scratch);
      mkdirSync(join(scratch, '.test-home'), { mode: 0o700 });
      const baseline = runVerifier(scratch);
      expect(baseline.exitCode, text(baseline.stderr)).toBe(0);

      const verifyRejected = (name: string) => {
        const result = runVerifier(scratch);
        if (result.exitCode === 0) bypasses.push(name);
      };
      const verifyRestored = () => {
        const result = runVerifier(scratch);
        expect(result.exitCode, text(result.stderr)).toBe(0);
      };

      const artifact = join(scratch, 'dist', 'index.d.ts');
      const artifactBackup = join(scratch, '.v6-index.d.ts');

      renameSync(artifact, artifactBackup);
      linkSync(artifactBackup, artifact);
      verifyRejected('artifact-hardlink');
      unlinkSync(artifact);
      renameSync(artifactBackup, artifact);
      verifyRestored();

      renameSync(artifact, artifactBackup);
      symlinkSync('../.v6-index.d.ts', artifact);
      verifyRejected('artifact-symlink');
      unlinkSync(artifact);
      renameSync(artifactBackup, artifact);
      verifyRestored();

      renameSync(artifact, artifactBackup);
      const fifo = Bun.spawnSync(['mkfifo', artifact], { stdout: 'pipe', stderr: 'pipe' });
      expect(fifo.exitCode, text(fifo.stderr)).toBe(0);
      verifyRejected('artifact-fifo');
      unlinkSync(artifact);
      renameSync(artifactBackup, artifact);
      verifyRestored();

      renameSync(artifact, artifactBackup);
      verifyRejected('artifact-missing');
      renameSync(artifactBackup, artifact);
      verifyRestored();

      const extra = join(scratch, 'dist', 'v6-extra-generated.d.ts');
      writeFileSync(extra, 'export {};\n', { mode: 0o644 });
      verifyRejected('artifact-extra');
      unlinkSync(extra);
      verifyRestored();

      const renamed = join(scratch, 'dist', 'index-renamed.d.ts');
      renameSync(artifact, renamed);
      verifyRejected('artifact-renamed');
      renameSync(renamed, artifact);
      verifyRestored();

      const descriptor = join(scratch, 'generated-artifacts.json');
      const descriptorBackup = join(scratch, '.v6-generated-artifacts.json');

      renameSync(descriptor, descriptorBackup);
      linkSync(descriptorBackup, descriptor);
      verifyRejected('descriptor-hardlink');
      unlinkSync(descriptor);
      renameSync(descriptorBackup, descriptor);
      verifyRestored();

      renameSync(descriptor, descriptorBackup);
      symlinkSync('.v6-generated-artifacts.json', descriptor);
      verifyRejected('descriptor-symlink');
      unlinkSync(descriptor);
      renameSync(descriptorBackup, descriptor);
      verifyRestored();

      renameSync(descriptor, descriptorBackup);
      mkdirSync(descriptor);
      verifyRejected('descriptor-special-directory');
      rmSync(descriptor, { recursive: true, force: true });
      renameSync(descriptorBackup, descriptor);
      verifyRestored();

      renameSync(descriptor, descriptorBackup);
      verifyRejected('descriptor-missing');
      renameSync(descriptorBackup, descriptor);
      verifyRestored();

      expect(bypasses).toEqual([]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);
});

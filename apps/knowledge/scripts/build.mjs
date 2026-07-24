#!/usr/bin/env bun
/**
 * Transactional Bun build.
 *
 * Every generated source, declaration, bundle, and executable is produced in
 * an isolated sibling directory. Checked-in src/dist/bin outputs are replaced
 * only after generation and local TypeScript compilation have all succeeded.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  cpSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE_PREFIX = '.knowledge-build-';
const STAGE_NAME = /^\.knowledge-build-[A-Za-z0-9]{6}$/;
const TRANSACTION_MARKER = '.knowledge-build-transaction.json';
const REPLACEMENT_LAYOUT = Object.freeze([
  Object.freeze({ id: 'generated-source', staged: 'src/generated', target: 'src/generated', kind: 'directory' }),
  Object.freeze({ id: 'dist', staged: 'dist', target: 'dist', kind: 'directory' }),
  Object.freeze({ id: 'bin', staged: 'bin', target: 'bin', kind: 'directory' }),
  Object.freeze({ id: 'package-manifest', staged: 'generated-artifacts.json', target: 'generated-artifacts.json', kind: 'file' }),
  Object.freeze({ id: 'repository-manifest', staged: 'repository-generated-artifacts.json', target: 'repository-generated-artifacts.json', kind: 'file' }),
]);

function statOrUndefined(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function syncPath(path) {
  const descriptor = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function syncParent(path) {
  syncPath(dirname(path));
}

function assertReplacementNode(path, kind, label) {
  const stat = statOrUndefined(path);
  if (!stat) return undefined;
  if (stat.isSymbolicLink()) throw new Error(`${label} is an unsafe symbolic-link alias`);
  if (kind === 'directory' && !stat.isDirectory()) {
    throw new Error(`${label} is not the expected generated directory`);
  }
  if (kind === 'file' && (!stat.isFile() || stat.nlink !== 1)) {
    throw new Error(`${label} is not a single-link generated file`);
  }
  if (kind === 'directory') {
    for (const entry of readdirSync(path)) {
      const child = join(path, entry);
      const childStat = lstatSync(child);
      if (childStat.isSymbolicLink()) {
        throw new Error(`${label} contains an unsafe symbolic-link alias`);
      }
      if (childStat.isDirectory()) assertReplacementNode(child, 'directory', label);
      else if (!childStat.isFile() || childStat.nlink !== 1) {
        throw new Error(`${label} contains a linked or special generated artifact`);
      }
    }
  }
  return stat;
}

function markerBody(phase, hadTargets) {
  return `${JSON.stringify({
    version: 1,
    phase,
    replacements: REPLACEMENT_LAYOUT.map((entry, index) => ({
      ...entry,
      had_target: hadTargets?.[index] ?? null,
    })),
  }, null, 2)}\n`;
}

function writeTransactionMarker(stagePath, phase, hadTargets) {
  const marker = join(stagePath, TRANSACTION_MARKER);
  const temporary = join(stagePath, `${TRANSACTION_MARKER}.${phase}.tmp`);
  writeFileSync(temporary, markerBody(phase, hadTargets), { flag: 'wx', mode: 0o600 });
  syncPath(temporary);
  renameSync(temporary, marker);
  syncPath(marker);
  syncPath(stagePath);
}

function readTransactionMarker(stagePath) {
  const marker = join(stagePath, TRANSACTION_MARKER);
  const stat = statOrUndefined(marker);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 32_768) {
    throw new Error(`interrupted build scratch has no safe transaction marker: ${stagePath}`);
  }
  const parsed = JSON.parse(readFileSync(marker, 'utf8'));
  if (
    parsed?.version !== 1
    || !['preparing', 'replacing'].includes(parsed.phase)
    || !Array.isArray(parsed.replacements)
    || parsed.replacements.length !== REPLACEMENT_LAYOUT.length
  ) {
    throw new Error(`interrupted build transaction marker is invalid: ${stagePath}`);
  }
  parsed.replacements.forEach((entry, index) => {
    const expected = REPLACEMENT_LAYOUT[index];
    if (
      entry?.id !== expected.id
      || entry?.staged !== expected.staged
      || entry?.target !== expected.target
      || entry?.kind !== expected.kind
      || (parsed.phase === 'preparing' && entry.had_target !== null)
      || (parsed.phase === 'replacing' && typeof entry.had_target !== 'boolean')
    ) {
      throw new Error(`interrupted build transaction layout is invalid: ${stagePath}`);
    }
  });
  return parsed;
}

function removeBuildStage(stagePath) {
  const stat = statOrUndefined(stagePath);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`refusing to remove unsafe build scratch alias: ${stagePath}`);
  }
  rmSync(stagePath, { recursive: true, force: false });
  syncPath(root);
}

function rollbackTransaction(stagePath, replacements) {
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const replacement = replacements[index];
    const target = join(root, replacement.target);
    const staged = join(stagePath, replacement.staged);
    const backup = join(stagePath, 'backup', String(index));
    const targetStat = statOrUndefined(target);
    const stagedStat = statOrUndefined(staged);
    const backupStat = statOrUndefined(backup);

    if (backupStat) {
      assertReplacementNode(backup, replacement.kind, `replacement backup ${replacement.id}`);
      if (targetStat) {
        assertReplacementNode(target, replacement.kind, `installed replacement ${replacement.id}`);
        rmSync(target, { recursive: replacement.kind === 'directory', force: false });
        syncParent(target);
      }
      renameSync(backup, target);
      syncParent(backup);
      syncParent(target);
      continue;
    }

    if (replacement.had_target) {
      if (!targetStat) {
        throw new Error(`cannot recover missing original generated target: ${replacement.id}`);
      }
      assertReplacementNode(target, replacement.kind, `recovered replacement ${replacement.id}`);
      continue;
    }

    if (!stagedStat && targetStat) {
      assertReplacementNode(target, replacement.kind, `installed replacement ${replacement.id}`);
      rmSync(target, { recursive: replacement.kind === 'directory', force: false });
      syncParent(target);
    } else if (stagedStat && targetStat) {
      throw new Error(`cannot distinguish an external generated target during recovery: ${replacement.id}`);
    }
  }
}

function recoverInterruptedBuilds() {
  const candidates = readdirSync(root)
    .filter((entry) => entry.startsWith(STAGE_PREFIX))
    .sort();
  for (const entry of candidates) {
    if (!STAGE_NAME.test(entry)) {
      throw new Error(`refusing unrecognized build scratch path: ${entry}`);
    }
    const stagePath = join(root, entry);
    const stat = statOrUndefined(stagePath);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`refusing unsafe build scratch alias: ${entry}`);
    }
    const marker = readTransactionMarker(stagePath);
    if (marker.phase === 'replacing') rollbackTransaction(stagePath, marker.replacements);
    removeBuildStage(stagePath);
  }
}

recoverInterruptedBuilds();
const stage = mkdtempSync(join(root, STAGE_PREFIX));
syncPath(root);
writeTransactionMarker(stage, 'preparing');
const stagedSource = join(stage, 'src');
const stagedDist = join(stage, 'dist');
const stagedBin = join(stage, 'bin');
const stagedManifest = join(stage, 'generated-artifacts.json');
const stagedRepositoryManifest = join(stage, 'repository-generated-artifacts.json');
const buildEnv = { ...process.env, BUN_CONFIG_INSTALL_AUTO: 'disable' };
let retainStageForRecovery = false;

const commonExternal = [
  'pg',
  '@hasna/machines',
  '@hasna/machines/consumer',
  '@aws-sdk/client-s3',
  '@aws-sdk/credential-providers',
  'ai',
  '@ai-sdk/openai',
  '@ai-sdk/anthropic',
  '@ai-sdk/deepseek',
];

function externalArgs(extra = []) {
  return [...commonExternal, ...extra].flatMap((name) => ['--external', name]);
}

function run(label, args, cwd = root) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env: buildEnv,
    stdio: 'inherit',
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${label} failed with status ${result.status ?? 'unknown'}`);
  }
}

function canonicalizeTreeModes(staged, fileMode = 0o644) {
  const stat = lstatSync(staged);
  chmodSync(staged, stat.isDirectory() ? 0o755 : fileMode);
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(staged)) {
    canonicalizeTreeModes(join(staged, entry), fileMode);
  }
}

function listRegularFiles(directory, prefix = '') {
  const output = [];
  for (const entry of readdirSync(directory).sort()) {
    const absolute = join(directory, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`generated tree contains a symlink: ${relative}`);
    if (stat.isDirectory()) output.push(...listRegularFiles(absolute, relative));
    else if (stat.isFile()) output.push(relative);
    else throw new Error(`generated tree contains a non-regular entry: ${relative}`);
  }
  return output;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function transactionalReplace(replacements) {
  const backupRoot = join(stage, 'backup');
  mkdirSync(backupRoot, { mode: 0o700 });
  syncPath(stage);
  const hadTargets = replacements.map((replacement) => {
    const stat = assertReplacementNode(
      replacement.target,
      replacement.kind,
      `generated target ${replacement.id}`,
    );
    return stat !== undefined;
  });
  writeTransactionMarker(stage, 'replacing', hadTargets);
  try {
    replacements.forEach((replacement, index) => {
      const backup = join(backupRoot, String(index));
      const hadTarget = hadTargets[index];
      if (hadTarget) renameSync(replacement.target, backup);
      if (hadTarget) {
        syncParent(replacement.target);
        syncParent(backup);
      }
      if (process.env.KNOWLEDGE_BUILD_INJECT_TERMINATION === `after-backup-${index + 1}`) {
        process.kill(process.pid, 'SIGKILL');
      }
      renameSync(replacement.staged, replacement.target);
      syncParent(replacement.staged);
      syncParent(replacement.target);
      if (process.env.KNOWLEDGE_BUILD_INJECT_TERMINATION === `replace-${index + 1}`) {
        process.kill(process.pid, 'SIGKILL');
      }
      if (process.env.KNOWLEDGE_BUILD_INJECT_FAILURE === `replace-${index + 1}`) {
        throw new Error(`injected transactional replacement failure after ${index + 1}`);
      }
    });
  } catch (error) {
    try {
      rollbackTransaction(
        stage,
        REPLACEMENT_LAYOUT.map((replacement, index) => ({
          ...replacement,
          had_target: hadTargets[index],
        })),
      );
    } catch (rollbackError) {
      retainStageForRecovery = true;
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; rollback failed: `
        + `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }
    throw error;
  }
}

try {
  cpSync(join(root, 'src'), stagedSource, { recursive: true });
  cpSync(join(root, 'package.json'), join(stage, 'package.json'));
  mkdirSync(stagedDist);
  mkdirSync(stagedBin);

  run('SDK generation', [
    join(root, 'scripts', 'generate-sdk.mjs'),
    '--output', join(stagedSource, 'generated', 'knowledge-api-client.ts'),
  ]);

  const stagedStorageKit = join(stagedSource, 'generated', 'storage-kit');
  const storageKitManifestPath = join(stagedStorageKit, '.storage-kit-manifest.json');
  const storageKitFiles = listRegularFiles(stagedStorageKit)
    .filter((path) => path !== '.storage-kit-manifest.json');
  writeFileSync(storageKitManifestPath, `${JSON.stringify({
    generator: '@hasna/knowledge Stage-A compatibility build',
    kitVersion: '0.4.0',
    files: Object.fromEntries(storageKitFiles.map((path) => [
      path,
      `sha256:${sha256(join(stagedStorageKit, path))}`,
    ])),
  }, null, 2)}\n`);

  run('CLI bundle', [
    'build', '--target=bun', '--outfile=bin/knowledge.js', '--minify',
    ...externalArgs(), 'src/cli.ts',
  ], stage);
  run('MCP bundle', [
    'build', '--target=bun', '--outfile=bin/knowledge-mcp.js',
    ...externalArgs(['@modelcontextprotocol/sdk', '../dist/mcp-payload.js']), 'src/mcp-entry.js',
  ], stage);
  run('serve bundle', [
    'build', '--target=bun', '--outfile=bin/knowledge-serve.js',
    ...externalArgs(), 'src/serve-entry.ts',
  ], stage);
  run('migration bundle', [
    'build', '--target=bun', '--outfile=bin/knowledge-migrate.js',
    ...externalArgs(), 'src/migrate-entry.ts',
  ], stage);
  run('library bundles', [
    'build', 'src/index.ts', 'src/storage.ts', 'src/serve.ts',
    '--outdir', 'dist', '--target=bun', ...externalArgs(),
  ], stage);
  run('MCP payload bundle', [
    'build', '--target=bun', '--outfile=dist/mcp-payload.js',
    ...externalArgs(['@modelcontextprotocol/sdk']), 'src/mcp-payload.js',
  ], stage);
  run('generated normalization', [join(root, 'scripts', 'strip-generated-trailing-whitespace.mjs'), '--root', stage]);

  const stagedTsconfig = join(stage, 'tsconfig.build.json');
  const typecheckInclude = ['src/index.ts', 'src/storage.ts', 'src/serve.ts'];
  if (process.env.KNOWLEDGE_BUILD_INJECT_FAILURE === 'typecheck') {
    const injected = 'src/__injected-typecheck-failure.ts';
    writeFileSync(
      join(stage, injected),
      'const __knowledgeInjectedTypecheckFailure: never = 1;\n',
    );
    typecheckInclude.push(injected);
  }
  writeFileSync(stagedTsconfig, `${JSON.stringify({
    extends: '../tsconfig.json',
    compilerOptions: {
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      outDir: './dist',
      rootDir: './src',
    },
    include: typecheckInclude,
    exclude: ['node_modules', 'dist', 'bin', 'tests'],
  }, null, 2)}\n`);
  const compiler = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(compiler)) {
    throw new Error('declared local compiler is missing: node_modules/typescript/bin/tsc');
  }
  run('TypeScript declaration build', [compiler, '-p', stagedTsconfig]);

  canonicalizeTreeModes(stagedDist, 0o644);
  canonicalizeTreeModes(stagedBin, 0o755);
  canonicalizeTreeModes(join(stagedSource, 'generated'), 0o644);
  for (const name of ['knowledge.js', 'knowledge-mcp.js', 'knowledge-serve.js', 'knowledge-migrate.js']) {
    chmodSync(join(stagedBin, name), 0o755);
  }

  const manifestFiles = [
    ...listRegularFiles(stagedDist).map((path) => ({ path: `dist/${path}`, absolute: join(stagedDist, path) })),
    ...listRegularFiles(stagedBin).map((path) => ({ path: `bin/${path}`, absolute: join(stagedBin, path) })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  writeFileSync(stagedManifest, `${JSON.stringify({
    version: 1,
    files: manifestFiles.map(({ path, absolute }) => ({
      path,
      sha256: sha256(absolute),
      mode: lstatSync(absolute).mode & 0o777,
    })),
    exact_roots: ['dist', 'bin'],
    exact_files: [],
  }, null, 2)}\n`);
  chmodSync(stagedManifest, 0o644);
  const repositoryManifestFiles = listRegularFiles(join(stagedSource, 'generated'))
    .map((path) => ({
      path: `src/generated/${path}`,
      absolute: join(stagedSource, 'generated', path),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  writeFileSync(stagedRepositoryManifest, `${JSON.stringify({
    version: 1,
    files: repositoryManifestFiles.map(({ path, absolute }) => ({
      path,
      sha256: sha256(absolute),
      mode: lstatSync(absolute).mode & 0o777,
    })),
    exact_roots: ['src/generated'],
    exact_files: [],
  }, null, 2)}\n`);
  chmodSync(stagedRepositoryManifest, 0o644);

  for (const required of [
    join(stagedSource, 'generated', 'knowledge-api-client.ts'),
    storageKitManifestPath,
    join(stagedDist, 'index.js'),
    join(stagedDist, 'index.d.ts'),
    join(stagedBin, 'knowledge.js'),
    join(stagedBin, 'knowledge-mcp.js'),
    join(stagedBin, 'knowledge-serve.js'),
    join(stagedBin, 'knowledge-migrate.js'),
    stagedManifest,
    stagedRepositoryManifest,
  ]) {
    if (!existsSync(required) || !lstatSync(required).isFile()) {
      throw new Error(`required build artifact is missing: ${required}`);
    }
  }

  transactionalReplace(REPLACEMENT_LAYOUT.map((replacement) => ({
    ...replacement,
    staged: join(stage, replacement.staged),
    target: join(root, replacement.target),
  })));
  console.log('[knowledge] transactional build complete');
} catch (error) {
  console.error(`[knowledge] build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (!retainStageForRecovery) removeBuildStage(stage);
}

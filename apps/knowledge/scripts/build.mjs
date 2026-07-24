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
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stage = mkdtempSync(join(root, '.knowledge-build-'));
const stagedSource = join(stage, 'src');
const stagedDist = join(stage, 'dist');
const stagedBin = join(stage, 'bin');
const stagedManifest = join(stage, 'generated-artifacts.json');
const stagedRepositoryManifest = join(stage, 'repository-generated-artifacts.json');
const buildEnv = { ...process.env, BUN_CONFIG_INSTALL_AUTO: 'disable' };

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
  mkdirSync(backupRoot);
  const completed = [];
  try {
    replacements.forEach((replacement, index) => {
      const backup = join(backupRoot, String(index));
      const hadTarget = existsSync(replacement.target);
      if (hadTarget) renameSync(replacement.target, backup);
      try {
        renameSync(replacement.staged, replacement.target);
      } catch (error) {
        if (hadTarget && existsSync(backup)) renameSync(backup, replacement.target);
        throw error;
      }
      completed.push({ ...replacement, backup, hadTarget });
      if (process.env.KNOWLEDGE_BUILD_INJECT_FAILURE === `replace-${index + 1}`) {
        throw new Error(`injected transactional replacement failure after ${index + 1}`);
      }
    });
  } catch (error) {
    for (const replacement of completed.reverse()) {
      if (existsSync(replacement.target)) rmSync(replacement.target, { recursive: true, force: true });
      if (replacement.hadTarget && existsSync(replacement.backup)) {
        renameSync(replacement.backup, replacement.target);
      }
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

  transactionalReplace([
    {
      staged: join(stagedSource, 'generated'),
      target: join(root, 'src', 'generated'),
    },
    { staged: stagedDist, target: join(root, 'dist') },
    { staged: stagedBin, target: join(root, 'bin') },
    { staged: stagedManifest, target: join(root, 'generated-artifacts.json') },
    {
      staged: stagedRepositoryManifest,
      target: join(root, 'repository-generated-artifacts.json'),
    },
  ]);
  console.log('[knowledge] transactional build complete');
} catch (error) {
  console.error(`[knowledge] build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(stage, { recursive: true, force: true });
}

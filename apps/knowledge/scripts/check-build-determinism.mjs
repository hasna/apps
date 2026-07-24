#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dependencyRoot = realpathSync(join(root, 'node_modules'));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'knowledge-build-determinism-'));
const workspaceA = join(temporaryRoot, 'workspace-a');
const workspaceB = join(temporaryRoot, 'workspace-b');
const generatedPaths = [
  'src/generated',
  'dist',
  'bin',
  'generated-artifacts.json',
  'repository-generated-artifacts.json',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function copyRepository(destination) {
  cpSync(root, destination, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
    verbatimSymlinks: true,
    filter(source) {
      const path = relative(root, source);
      if (!path) return true;
      const first = path.split(sep)[0];
      return first !== '.git'
        && first !== 'node_modules'
        && !first.startsWith('.knowledge-build-');
    },
  });
}

function childEnvironment() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    TMPDIR: process.env.TMPDIR,
    BUN_CONFIG_INSTALL_AUTO: 'disable',
    BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  };
}

function run(label, args, cwd, mask = undefined) {
  const previousMask = mask === undefined ? undefined : process.umask(mask);
  try {
    const result = spawnSync(process.execPath, args, {
      cwd,
      env: childEnvironment(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if ((result.status ?? 1) !== 0) {
      throw new Error(
        `${label} failed with status ${result.status ?? 'unknown'}:\n${result.stderr || result.stdout}`,
      );
    }
    return result.stdout;
  } finally {
    if (previousMask !== undefined) process.umask(previousMask);
  }
}

function snapshotGenerated(workspace) {
  const files = new Map();
  const aggregate = createHash('sha256');
  const visit = (path) => {
    const stat = lstatSync(path);
    const name = relative(workspace, path);
    if (stat.isSymbolicLink()) {
      throw new Error(`generated output contains a symlink: ${name}`);
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry));
      return;
    }
    if (!stat.isFile()) {
      throw new Error(`generated output contains a non-regular entry: ${name}`);
    }
    const bytes = readFileSync(path);
    const mode = stat.mode & 0o777;
    const hash = sha256(bytes);
    files.set(name, { bytes, hash, mode });
    aggregate.update(name);
    aggregate.update('\0');
    aggregate.update(String(mode));
    aggregate.update('\0');
    aggregate.update(bytes);
    aggregate.update('\0');
  };
  for (const path of generatedPaths) visit(join(workspace, path));
  return { aggregate: aggregate.digest('hex'), files };
}

function assertSnapshotsEqual(label, expected, actual) {
  const expectedNames = [...expected.files.keys()].sort();
  const actualNames = [...actual.files.keys()].sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(actualNames)) {
    throw new Error(`${label} generated file inventory differs`);
  }
  for (const name of expectedNames) {
    const expectedFile = expected.files.get(name);
    const actualFile = actual.files.get(name);
    if (
      expectedFile.mode !== actualFile.mode
      || !expectedFile.bytes.equals(actualFile.bytes)
    ) {
      throw new Error(
        `${label} differs at ${name}: ${expectedFile.hash}/${expectedFile.mode.toString(8)}`
        + ` != ${actualFile.hash}/${actualFile.mode.toString(8)}`,
      );
    }
  }
  if (expected.aggregate !== actual.aggregate) {
    throw new Error(`${label} aggregate differs: ${expected.aggregate} != ${actual.aggregate}`);
  }
}

function assertCanonicalTopologyProvenance(label, snapshot, forbiddenRoots) {
  for (const [name, record] of snapshot.files) {
    if (!name.endsWith('.js') && !name.endsWith('.json') && !name.endsWith('.d.ts')) continue;
    const text = record.bytes.toString('utf8');
    if (/^\/\/ (?!node_modules\/).*node_modules\//m.test(text)) {
      throw new Error(`${label} contains non-canonical dependency provenance in ${name}`);
    }
    for (const forbiddenRoot of forbiddenRoots) {
      if (forbiddenRoot && text.includes(forbiddenRoot)) {
        throw new Error(`${label} contains an absolute workspace/dependency path in ${name}`);
      }
    }
  }
}

function buildAndSnapshot(label, workspace, mask) {
  run(`${label} build`, ['scripts/build.mjs'], workspace, mask);
  run(`${label} generated verification`, ['scripts/verify-generated-artifacts.mjs'], workspace);
  return snapshotGenerated(workspace);
}

function packHash(label, workspace) {
  const destination = join(temporaryRoot, `pack-${label}`);
  mkdirSync(destination);
  run(
    `${label} package`,
    ['pm', 'pack', '--ignore-scripts', '--destination', destination, '--quiet'],
    workspace,
  );
  const tarballs = readdirSync(destination).filter((name) => name.endsWith('.tgz'));
  if (tarballs.length !== 1) {
    throw new Error(`${label} expected one package tarball, found ${tarballs.length}`);
  }
  return sha256(readFileSync(join(destination, tarballs[0])));
}

if (process.platform === 'win32') {
  console.error('[knowledge] build determinism check requires POSIX symlink and umask support');
  process.exit(1);
}

try {
  copyRepository(workspaceA);
  copyRepository(workspaceB);
  symlinkSync(dependencyRoot, join(workspaceA, 'node_modules'), 'dir');
  cpSync(dependencyRoot, join(workspaceB, 'node_modules'), {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });

  const workspaceADependencies = realpathSync(join(workspaceA, 'node_modules'));
  const workspaceBDependencies = realpathSync(join(workspaceB, 'node_modules'));
  if (workspaceADependencies === workspaceBDependencies) {
    throw new Error('clean build dependency roots are not distinct');
  }

  const expected = snapshotGenerated(root);
  const expectedPackage = packHash('checked-in', workspaceA);
  const strict = buildAndSnapshot('workspace-a/umask-077', workspaceA, 0o077);
  const strictPackage = packHash('workspace-a', workspaceA);
  const normal = buildAndSnapshot('workspace-b/umask-022', workspaceB, 0o022);
  const normalPackage = packHash('workspace-b', workspaceB);

  assertSnapshotsEqual('workspace-a versus checked-in output', expected, strict);
  assertSnapshotsEqual('workspace-b versus checked-in output', expected, normal);
  assertSnapshotsEqual('workspace-a versus workspace-b output', strict, normal);
  assertCanonicalTopologyProvenance('checked-in output', expected, [root, dependencyRoot]);
  assertCanonicalTopologyProvenance('workspace-a output', strict, [
    root,
    workspaceA,
    workspaceADependencies,
  ]);
  assertCanonicalTopologyProvenance('workspace-b output', normal, [
    root,
    workspaceB,
    workspaceBDependencies,
  ]);
  if (expectedPackage !== strictPackage || expectedPackage !== normalPackage) {
    throw new Error(
      `package bytes differ: checked-in=${expectedPackage}`
      + ` workspace-a=${strictPackage} workspace-b=${normalPackage}`,
    );
  }

  console.log(`[knowledge] deterministic generated digest ${expected.aggregate}`);
  console.log(`[knowledge] deterministic package sha256 ${expectedPackage}`);
  console.log('[knowledge] exact checked-in output reproduced across two clean workspace/dependency roots and umasks 077/022');
} catch (error) {
  console.error(`[knowledge] build determinism failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

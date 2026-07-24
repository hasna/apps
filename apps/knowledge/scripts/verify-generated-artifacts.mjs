#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const scriptRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(optionValue(process.argv.slice(2), '--root') ?? scriptRoot);
const packageManifestPath = join(root, 'generated-artifacts.json');
const repositoryManifestPath = join(root, 'repository-generated-artifacts.json');
const failures = [];
const PACKAGE_EXACT_ROOTS = Object.freeze(['dist', 'bin']);
const REPOSITORY_EXACT_ROOTS = Object.freeze(['src/generated']);
const REPOSITORY_EXACT_FILES = Object.freeze([]);
const STORAGE_KIT_FILES = Object.freeze([
  'README.md',
  'health.ts',
  'index.ts',
  'migrations.ts',
  'mode.ts',
  'pool.ts',
  'query.ts',
  'tls.ts',
]);
const REQUIRED_REPOSITORY_FILES = Object.freeze([
  'src/generated/knowledge-api-client.ts',
  'src/generated/storage-kit/.storage-kit-manifest.json',
  ...STORAGE_KIT_FILES.map((path) => `src/generated/storage-kit/${path}`),
]);
const REQUIRED_PACKAGE_FILES = Object.freeze([
  'dist/index.js',
  'dist/index.d.ts',
  'dist/storage.js',
  'dist/storage.d.ts',
  'dist/serve.js',
  'dist/serve.d.ts',
  'dist/knowledge-db.d.ts',
  'dist/db/pg-migrations.d.ts',
  'dist/db/remote-storage.d.ts',
  'dist/db/storage-sync.d.ts',
  'dist/generated/storage-kit/index.d.ts',
  'dist/generated/storage-kit/migrations.d.ts',
  'dist/generated/storage-kit/query.d.ts',
  'dist/mcp-payload.js',
  'bin/knowledge.js',
  'bin/knowledge-mcp.js',
  'bin/knowledge-serve.js',
  'bin/knowledge-migrate.js',
]);
const FORBIDDEN_PACKAGE_FILES = Object.freeze(['dist/operator-capability.d.ts']);

function fail(message) {
  failures.push(message);
}

function fatal(message) {
  console.error(message);
  process.exit(1);
}

function lstatOrUndefined(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

const rootStat = lstatOrUndefined(root);
if (!rootStat) fatal('generated artifact root is missing');
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
  fatal('generated artifact root must be a real directory, not an alias or special file');
}

function safeRelative(path) {
  return typeof path === 'string'
    && path.length > 0
    && !isAbsolute(path)
    && normalize(path) === path
    && !path.split(/[\\/]/).some((part) => !part || part === '.' || part === '..');
}

function listFiles(directory, prefix = '') {
  const directoryStat = lstatOrUndefined(directory);
  if (!directoryStat) return [];
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    fail(`${prefix || relative(root, directory)} is not a real generated directory`);
    return [];
  }
  const output = [];
  for (const entry of readdirSync(directory).sort()) {
    const absolute = join(directory, entry);
    const path = prefix ? `${prefix}/${entry}` : entry;
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      fail(`${path} is a symlink; generated roots must contain regular files only`);
    } else if (stat.isDirectory()) {
      output.push(...listFiles(absolute, path));
    } else if (stat.isFile() && stat.nlink === 1) {
      output.push(path);
    } else if (stat.isFile()) {
      fail(`${path} is hard-linked; generated files must have exactly one link`);
    } else {
      fail(`${path} is not a regular generated file`);
    }
  }
  return output;
}

function safeGeneratedFile(path, label, expectedMode) {
  const stat = lstatOrUndefined(path);
  if (!stat) {
    fail(`${label} is missing`);
    return undefined;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${label} is not a regular file`);
    return undefined;
  }
  if (stat.nlink !== 1) {
    fail(`${label} is hard-linked; generated files must have exactly one link`);
    return undefined;
  }
  if (expectedMode !== undefined && (stat.mode & 0o777) !== expectedMode) {
    fail(`${label} mode changed: expected ${expectedMode}, got ${stat.mode & 0o777}`);
  }
  return stat;
}

function readGeneratedFile(path, label, expectedMode) {
  return safeGeneratedFile(path, label, expectedMode) ? readFileSync(path) : undefined;
}

function hash(path, label = relative(root, path)) {
  const content = readGeneratedFile(path, label);
  return content ? createHash('sha256').update(content).digest('hex') : undefined;
}

function readManifest(path, label) {
  const stat = lstatOrUndefined(path);
  if (!stat) fatal(`${label} is missing`);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    fatal(`${label} must be a single-link regular descriptor`);
  }
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (
      manifest?.version !== 1
      || !Array.isArray(manifest.files)
      || !Array.isArray(manifest.exact_roots)
      || !Array.isArray(manifest.exact_files)
    ) throw new Error('unsupported shape');
    return manifest;
  } catch {
    console.error(`${label} is malformed or has an unsupported shape`);
    process.exit(1);
  }
}

const packageManifest = readManifest(packageManifestPath, 'generated-artifacts.json');
const repositoryManifest = readManifest(
  repositoryManifestPath,
  'repository-generated-artifacts.json',
);
const expected = new Map();

function collectManifest(manifest, label, exactRoots, exactFiles) {
  if (JSON.stringify(manifest.exact_roots) !== JSON.stringify(exactRoots)) {
    fail(`${label} exact_roots does not match the verifier-owned scope`);
  }
  if (JSON.stringify(manifest.exact_files) !== JSON.stringify(exactFiles)) {
    fail(`${label} exact_files does not match the verifier-owned scope`);
  }
  for (const entry of manifest.files) {
    if (
      !safeRelative(entry?.path)
      || !/^[a-f0-9]{64}$/.test(entry?.sha256 ?? '')
      || !Number.isInteger(entry?.mode)
    ) {
      fail(`${label} entry is invalid: ${JSON.stringify(entry?.path)}`);
      continue;
    }
    const canonicalMode = entry.path.startsWith('bin/') ? 0o755 : 0o644;
    if (entry.mode !== canonicalMode) {
      fail(`${label} mode is not canonical for ${entry.path}: expected ${canonicalMode}, got ${entry.mode}`);
    }
    if (
      !exactFiles.includes(entry.path)
      && !exactRoots.some((exactRoot) => entry.path.startsWith(`${exactRoot}/`))
    ) fail(`${label} path is outside its generated scope: ${entry.path}`);
    if (expected.has(entry.path)) fail(`generated path is duplicated across manifests: ${entry.path}`);
    expected.set(entry.path, entry);
  }
}

collectManifest(packageManifest, 'package manifest', PACKAGE_EXACT_ROOTS, []);
collectManifest(
  repositoryManifest,
  'repository manifest',
  REPOSITORY_EXACT_ROOTS,
  REPOSITORY_EXACT_FILES,
);

for (const required of REQUIRED_PACKAGE_FILES) {
  if (!packageManifest.files.some((entry) => entry.path === required)) {
    fail(`package manifest omits required generated file: ${required}`);
  }
}
for (const required of REQUIRED_REPOSITORY_FILES) {
  if (!repositoryManifest.files.some((entry) => entry.path === required)) {
    fail(`repository manifest omits required generated file: ${required}`);
  }
}

function verifyExactRootInventory(manifest, exactRoots, label) {
  const actual = new Set();
  for (const exactRoot of exactRoots) {
    let current = root;
    let valid = true;
    for (const segment of exactRoot.split('/')) {
      current = join(current, segment);
      const stat = lstatOrUndefined(current);
      if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
        fail(`${exactRoot} contains a missing, aliased, or non-directory path component`);
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    for (const child of listFiles(join(root, exactRoot))) {
      actual.add(`${exactRoot}/${child}`);
    }
  }
  for (const path of actual) {
    if (!manifest.files.some((entry) => entry.path === path)) {
      fail(`unexpected ${label} artifact: ${path}`);
    }
  }
}

verifyExactRootInventory(packageManifest, PACKAGE_EXACT_ROOTS, 'generated package');
verifyExactRootInventory(repositoryManifest, REPOSITORY_EXACT_ROOTS, 'generated repository');

const storageKitRoot = join(root, 'src', 'generated', 'storage-kit');
const storageKitManifestPath = join(storageKitRoot, '.storage-kit-manifest.json');
if (existsSync(storageKitManifestPath)) {
  try {
    const storageKitManifestBody = readGeneratedFile(
      storageKitManifestPath,
      'src/generated/storage-kit/.storage-kit-manifest.json',
      0o644,
    );
    if (!storageKitManifestBody) throw new Error('unsafe descriptor');
    const storageKitManifest = JSON.parse(storageKitManifestBody.toString('utf8'));
    if (
      storageKitManifest?.generator !== '@hasna/knowledge Stage-A compatibility build'
      || storageKitManifest?.kitVersion !== '0.4.0'
      || typeof storageKitManifest?.files !== 'object'
      || storageKitManifest.files === null
      || Array.isArray(storageKitManifest.files)
    ) {
      throw new Error('unsupported shape');
    }
    const listed = Object.keys(storageKitManifest.files).sort();
    if (JSON.stringify(listed) !== JSON.stringify(STORAGE_KIT_FILES)) {
      fail('storage-kit inner manifest inventory differs from the required Stage-A source set');
    }
    for (const path of STORAGE_KIT_FILES) {
      const expectedHash = storageKitManifest.files[path];
      if (expectedHash !== `sha256:${hash(join(storageKitRoot, path))}`) {
        fail(`storage-kit inner manifest hash changed: ${path}`);
      }
    }
  } catch {
    fail('storage-kit inner manifest is malformed or has an unsupported shape');
  }
} else {
  fail('storage-kit inner manifest is missing');
}

for (const path of FORBIDDEN_PACKAGE_FILES) {
  if (packageManifest.files.some((entry) => entry.path === path)) {
    fail(`private operator capability declaration is published: ${path}`);
  }
}

const pinnedGeneratedDeclaration = readFileSync(
  join(scriptRoot, 'tests', 'fixtures', 'generated-api-e1eed58.d.ts'),
  'utf8',
).replace(/^\/\/ Pinned public declarations[^\n]*\n/, '');
const committedGeneratedDeclarationBody = readGeneratedFile(
  join(root, 'dist', 'generated', 'knowledge-api-client.d.ts'),
  'dist/generated/knowledge-api-client.d.ts',
  0o644,
);
const committedGeneratedDeclaration = committedGeneratedDeclarationBody?.toString('utf8');
if (committedGeneratedDeclaration === undefined || committedGeneratedDeclaration !== pinnedGeneratedDeclaration) {
  fail('generated API declaration differs from the pinned base contract');
}
const generatedClientSourceBody = readGeneratedFile(
  join(root, 'src', 'generated', 'knowledge-api-client.ts'),
  'src/generated/knowledge-api-client.ts',
  0o644,
);
const generatedClientSource = generatedClientSourceBody?.toString('utf8') ?? '';
for (const forbidden of [
  'globalThis.fetch',
  'this.baseUrl =',
  'this.apiKey =',
  'this.fetchImpl =',
  'new URL(',
  'KnowledgeApiClient requires a baseUrl',
]) {
  if (generatedClientSource.includes(forbidden)) {
    fail(`generated API client restored live state or transport: ${forbidden}`);
  }
}
if (!generatedClientSource.includes('containedClientBoundary()')) {
  fail('generated API client does not contain through the fixed Stage-A boundary');
}
const bundledRoot = readGeneratedFile(join(root, 'dist', 'index.js'), 'dist/index.js', 0o644)
  ?.toString('utf8') ?? '';
if (
  bundledRoot.includes('KnowledgeApiClient requires a baseUrl')
  || !bundledRoot.includes('KnowledgeApiClient is a zero-I/O compatibility boundary during Stage A')
) {
  fail('bundled root restored a live generated API client');
}

const stalePatterns = [
  /\bpath\s*[:=]\s*decodeURIComponent\([^)]*\.pathname\)/,
  /file:\/\/\$\{/,
];

for (const [path, entry] of expected) {
  const absolute = join(root, path);
  if (relative(root, absolute).startsWith('..')) {
    fail(`generated path escapes root: ${path}`);
    continue;
  }
  if (!existsSync(absolute)) {
    fail(`generated artifact is missing: ${path}`);
    continue;
  }
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    fail(`generated artifact is not a regular file: ${path}`);
    continue;
  }
  if (hash(absolute, path) !== entry.sha256) fail(`generated artifact hash changed: ${path}`);
  if ((stat.mode & 0o777) !== entry.mode) {
    fail(`generated artifact mode changed: ${path}`);
  }
  const content = readGeneratedFile(absolute, path, entry.mode);
  if (!content) continue;
  if (!content.includes(0)) {
    const text = content.toString('utf8');
    for (const pattern of stalePatterns) {
      if (pattern.test(text)) fail(`${path} contains stale generated path handling: ${pattern}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(`[knowledge] verified ${packageManifest.files.length} package and ${repositoryManifest.files.length} repository generated artifacts`);

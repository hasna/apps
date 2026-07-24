#!/usr/bin/env bun
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(
  readFileSync(join(root, 'tests', 'fixtures', 'public-reflection-e1eed58.json'), 'utf8'),
);
const instanceFixture = JSON.parse(
  readFileSync(join(root, 'tests', 'fixtures', 'public-instance-reflection-e1eed58.json'), 'utf8'),
);
const manifest = JSON.parse(readFileSync(join(root, 'generated-artifacts.json'), 'utf8'));
const pinnedDeclaration = readFileSync(
  join(root, 'tests', 'fixtures', 'generated-api-e1eed58.d.ts'),
  'utf8',
).replace(/^\/\/ Pinned public declarations[^\n]*\n/, '');
const productionDeclarationConsumerFixture = join(
  root,
  'tests',
  'fixtures',
  'extracted-production-consumer.ts',
);
const outboxDeclarationConsumerFixture = join(
  root,
  'tests',
  'fixtures',
  'extracted-outbox-consumer.ts',
);
const temporaryRoot = mkdtempSync(join(tmpdir(), 'knowledge-package-extraction-'));

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(args, options = {}) {
  const result = Bun.spawnSync(args, {
    cwd: root,
    env: { ...process.env, BUN_CONFIG_INSTALL_AUTO: 'disable' },
    stdout: 'pipe',
    stderr: 'pipe',
    ...options,
  });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  if (result.exitCode !== 0) {
    throw new Error(`${args.join(' ')} failed: ${stderr || stdout}`);
  }
  return stdout;
}

function runExpectFailure(args, options = {}) {
  const result = Bun.spawnSync(args, {
    cwd: root,
    env: { ...process.env, BUN_CONFIG_INSTALL_AUTO: 'disable' },
    stdout: 'pipe',
    stderr: 'pipe',
    ...options,
  });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  invariant(result.exitCode !== 0, `${args.join(' ')} unexpectedly succeeded`);
  return `${stdout}\n${stderr}`;
}

function memberShape(owner, key) {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  invariant(descriptor, `missing descriptor for ${key}`);
  if ('value' in descriptor && typeof descriptor.value === 'function') {
    return { kind: 'method', name: descriptor.value.name, length: descriptor.value.length };
  }
  return {
    kind: 'accessor',
    getLength: typeof descriptor.get === 'function' ? descriptor.get.length : null,
    setLength: typeof descriptor.set === 'function' ? descriptor.set.length : null,
  };
}

function constructable(value) {
  try {
    Reflect.construct(String, [], value);
    return true;
  } catch {
    return false;
  }
}

const ignoredStatics = new Set(['arguments', 'caller', 'length', 'name', 'prototype']);

function functionShape(value) {
  const members = {};
  if (value.prototype && typeof value.prototype === 'object') {
    for (const key of Object.getOwnPropertyNames(value.prototype).sort()) {
      members[key] = memberShape(value.prototype, key);
    }
  }
  const statics = {};
  for (const key of Object.getOwnPropertyNames(value).sort()) {
    if (!ignoredStatics.has(key)) statics[key] = memberShape(value, key);
  }
  return {
    name: value.name,
    length: value.length,
    constructable: constructable(value),
    members,
    statics,
  };
}

function assertReflection(surfaceName, module) {
  const expected = fixture.surfaces[surfaceName];
  invariant(
    isDeepStrictEqual(Object.keys(module).sort(), [...expected.keys].sort()),
    `${surfaceName} packed exports differ from the pinned base`,
  );
  for (const [name, shape] of Object.entries(expected.functions)) {
    invariant(typeof module[name] === 'function', `${surfaceName}.${name} is not callable`);
    const actual = functionShape(module[name]);
    invariant(
      isDeepStrictEqual(actual, shape),
      `${surfaceName}.${name} packed reflection differs from the pinned base`,
    );
  }
}

function instanceDescriptorShape(instance, key) {
  const descriptor = Object.getOwnPropertyDescriptor(instance, key);
  invariant(descriptor && 'value' in descriptor, `missing data descriptor for ${key}`);
  return {
    value: descriptor.value ?? null,
    value_kind: typeof descriptor.value,
    enumerable: descriptor.enumerable,
    configurable: descriptor.configurable,
    writable: descriptor.writable,
  };
}

function assertInstanceReflection(label, instance) {
  const expected = instanceFixture.instances[label];
  invariant(expected, `missing pinned instance reflection for ${label}`);
  invariant(isDeepStrictEqual(Object.getOwnPropertyNames(instance).sort(), expected.own_keys),
    `${label} own keys differ from the pinned base`);
  for (const [key, descriptor] of Object.entries(expected.descriptors)) {
    invariant(isDeepStrictEqual(instanceDescriptorShape(instance, key), descriptor),
      `${label}.${key} descriptor differs from the pinned base`);
  }
}

try {
  run(['bun', 'pm', 'pack', '--ignore-scripts', '--destination', temporaryRoot, '--quiet']);
  const tarballs = readdirSync(temporaryRoot).filter((name) => name.endsWith('.tgz'));
  invariant(tarballs.length === 1, `expected one local tarball, found ${tarballs.length}`);
  const tarball = join(temporaryRoot, tarballs[0]);
  const listed = run(['tar', '-tzf', tarball])
    .split('\n')
    .filter((path) => path && !path.endsWith('/'))
    .sort();
  const expectedFiles = [
    'package/package.json',
    'package/LICENSE',
    'package/README.md',
    'package/generated-artifacts.json',
    ...manifest.files
      .map(({ path }) => path)
      .map((path) => `package/${path}`),
  ].sort();
  invariant(
    isDeepStrictEqual(listed, expectedFiles),
    `packed file set differs: expected ${expectedFiles.length}, found ${listed.length}`,
  );

  const extractRoot = join(temporaryRoot, 'extract');
  mkdirSync(extractRoot);
  run(['tar', '-xzf', tarball, '-C', extractRoot]);
  const packageRoot = join(extractRoot, 'package');
  const extractedManifest = JSON.parse(
    readFileSync(join(packageRoot, 'generated-artifacts.json'), 'utf8'),
  );
  invariant(isDeepStrictEqual(extractedManifest, manifest),
    'packed generated-artifacts.json differs from the repository package manifest');
  invariant(isDeepStrictEqual(extractedManifest.exact_roots, ['dist', 'bin']),
    'packed generated manifest has unexpected exact_roots');
  invariant(isDeepStrictEqual(extractedManifest.exact_files, []),
    'packed generated manifest must not reference unshipped exact files');
  for (const path of expectedFiles) {
    const extractedPath = join(extractRoot, path);
    const stat = lstatSync(extractedPath);
    invariant(stat.isFile() && !stat.isSymbolicLink(), `${path} is not a regular packed file`);
    const expectedMode = path.startsWith('package/bin/')
      ? 0o755
      : path.startsWith('package/dist/') || path === 'package/generated-artifacts.json'
        ? 0o644
        : null;
    if (expectedMode !== null) {
      invariant(
        (stat.mode & 0o777) === expectedMode,
        `${path} has mode ${(stat.mode & 0o777).toString(8)}, expected ${expectedMode.toString(8)}`,
      );
    }
  }
  for (const entry of extractedManifest.files) {
    const extractedPath = join(packageRoot, entry.path);
    invariant(sha256(extractedPath) === entry.sha256,
      `packed generated artifact hash differs: ${entry.path}`);
    invariant((lstatSync(extractedPath).mode & 0o777) === entry.mode,
      `packed generated artifact mode differs: ${entry.path}`);
  }

  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  invariant(isDeepStrictEqual(Object.keys(packageJson.bin).sort(), [
    'knowledge',
    'knowledge-mcp',
    'knowledge-migrate',
    'knowledge-serve',
  ]), 'packed package must expose exactly four executable bins');
  invariant(isDeepStrictEqual(Object.keys(packageJson.exports).sort(), ['.', './serve', './storage']),
    'packed package exports differ from the intended public boundaries');

  const extractedGeneratedDeclaration = readFileSync(
    join(packageRoot, 'dist', 'generated', 'knowledge-api-client.d.ts'),
    'utf8',
  );
  invariant(extractedGeneratedDeclaration === pinnedDeclaration,
    'packed generated declarations differ from the pinned base contract');
  // Install only the packed package's production declaration dependencies.
  // The copied lock is an offline test input and is not part of the tarball.
  copyFileSync(join(root, 'bun.lock'), join(packageRoot, 'bun.lock'));
  run([
    'bun',
    'install',
    '--production',
    '--offline',
    '--frozen-lockfile',
    '--ignore-scripts',
  ], { cwd: packageRoot });
  // Keep consumers inside the extracted package so TypeScript exercises the
  // package's real self-reference exports and production dependency graph.
  const consumerRoot = join(packageRoot, '.declaration-consumer');
  mkdirSync(consumerRoot);
  const productionDeclarationConsumer = join(
    consumerRoot,
    'extracted-production-consumer.ts',
  );
  const outboxDeclarationConsumer = join(consumerRoot, 'extracted-outbox-consumer.ts');
  copyFileSync(productionDeclarationConsumerFixture, productionDeclarationConsumer);
  copyFileSync(outboxDeclarationConsumerFixture, outboxDeclarationConsumer);
  const compiler = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const declarationCompilerOptions = {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2022', 'DOM'],
    types: [],
    typeRoots: [join(packageRoot, 'node_modules', '@types')],
    strict: true,
    skipLibCheck: false,
    noEmit: true,
    ignoreDeprecations: '6.0',
  };
  const productionDeclarationConfig = join(
    temporaryRoot,
    'extracted-production-declarations.json',
  );
  await Bun.write(productionDeclarationConfig, `${JSON.stringify({
    compilerOptions: declarationCompilerOptions,
    files: [productionDeclarationConsumer],
  }, null, 2)}\n`);
  const installedPgTypes = join(packageRoot, 'node_modules', '@types', 'pg');
  const withheldPgTypes = join(temporaryRoot, 'withheld-types-pg');
  renameSync(installedPgTypes, withheldPgTypes);
  let missingPgOutput = '';
  try {
    missingPgOutput = runExpectFailure(['bun', compiler, '-p', productionDeclarationConfig]);
  } finally {
    renameSync(withheldPgTypes, installedPgTypes);
  }
  invariant(
    /(?:Could not find a declaration file for module|Cannot find module) ['\"]pg['\"]/.test(
      missingPgOutput,
    ),
    'strict production declaration negative control did not fail on missing pg types',
  );
  run(['bun', compiler, '-p', productionDeclarationConfig]);

  const installedContracts = join(packageRoot, 'node_modules', '@hasna', 'contracts');
  const withheldContracts = join(temporaryRoot, 'withheld-hasna-contracts');
  renameSync(installedContracts, withheldContracts);
  let missingContractsOutput = '';
  try {
    missingContractsOutput = runExpectFailure(['bun', compiler, '-p', productionDeclarationConfig]);
  } finally {
    renameSync(withheldContracts, installedContracts);
  }
  invariant(
    /Cannot find module ['\"]@hasna\/contracts(?:\/auth)?['\"]/.test(missingContractsOutput),
    'strict production declaration negative control did not fail on missing @hasna/contracts',
  );
  run(['bun', compiler, '-p', productionDeclarationConfig]);

  const installedAi = join(packageRoot, 'node_modules', 'ai');
  const withheldAi = join(temporaryRoot, 'withheld-ai');
  renameSync(installedAi, withheldAi);
  let missingAiOutput = '';
  try {
    missingAiOutput = runExpectFailure(['bun', compiler, '-p', productionDeclarationConfig]);
  } finally {
    renameSync(withheldAi, installedAi);
  }
  invariant(
    /Cannot find module ['"]ai['"]/.test(missingAiOutput),
    'strict production declaration negative control did not fail on missing ai',
  );
  run(['bun', compiler, '-p', productionDeclarationConfig]);

  // Outbox exactness is a separate compatibility proof. Package declarations
  // must resolve without synthetic runtime shims or development-only types.
  const outboxDeclarationConfig = join(temporaryRoot, 'extracted-outbox-declarations.json');
  await Bun.write(outboxDeclarationConfig, `${JSON.stringify({
    compilerOptions: declarationCompilerOptions,
    files: [outboxDeclarationConsumer],
  }, null, 2)}\n`);
  run(['bun', compiler, '-p', outboxDeclarationConfig]);
  const extractedRootDeclaration = readFileSync(join(packageRoot, 'dist', 'index.d.ts'), 'utf8');
  invariant(
    /export type \{ OutboxConsumeOptions, OutboxConsumeResult \} from '\.\/outbox-consume\.js';/.test(extractedRootDeclaration),
    'packed root declaration does not re-export the exact outbox option surface',
  );

  for (const path of listed) {
    const text = readFileSync(join(extractRoot, path), 'utf8');
    if (path.endsWith('.d.ts')) {
      invariant(!/bun:sqlite/.test(text), `Bun-specific declaration dependency was packed in ${path}`);
    }
    invariant(!/createKnowledgeOperatorCapability|branded-operator-capability|operator-web-search|src\/operator-capability/.test(text),
      `operator capability source was packed in ${path}`);
    invariant(!/postgres(?:ql)?:\/\//i.test(text), `raw PostgreSQL DSN text was packed in ${path}`);
  }

  const rootModule = await import(pathToFileURL(join(packageRoot, 'dist', 'index.js')).href);
  const storageModule = await import(pathToFileURL(join(packageRoot, 'dist', 'storage.js')).href);
  const serveModule = await import(pathToFileURL(join(packageRoot, 'dist', 'serve.js')).href);
  assertReflection('root', rootModule);
  assertReflection('storage', storageModule);
  assertReflection('serve', serveModule);
  const hostile = new Proxy({}, {
    get() { throw new Error('packed reflection inspected caller state'); },
    ownKeys() { throw new Error('packed reflection enumerated caller state'); },
    getOwnPropertyDescriptor() { throw new Error('packed reflection inspected caller descriptors'); },
  });
  assertInstanceReflection('root.NoteRepo', new rootModule.NoteRepo(hostile));
  assertInstanceReflection(
    'storage.MigrationLedger',
    new storageModule.MigrationLedger(hostile, hostile),
  );
  invariant(storageModule.KIT_VERSION === instanceFixture.constants['storage.KIT_VERSION'],
    'packed KIT_VERSION differs from the pinned base');

  const syntheticPresence = Object.assign(Object.create(null), {
    HASNA_KNOWLEDGE_DATABASE_URL: 'configured-present',
  });
  invariant(storageModule.resolveDatabaseUrl('knowledge', syntheticPresence) === null,
    'packed resolveDatabaseUrl inspected environment presence');
  invariant(storageModule.getStorageDatabaseUrl(syntheticPresence) === null,
    'packed getStorageDatabaseUrl inspected environment presence');
  invariant(serveModule.normalizeCloudDatabaseUrl(syntheticPresence) === undefined,
    'packed normalizeCloudDatabaseUrl inspected environment presence');
  invariant(isDeepStrictEqual(storageModule.PG_MIGRATIONS, []),
    'packed migration compatibility data is not empty');
  invariant(isDeepStrictEqual(storageModule.defineMigration('opaque-id', 'opaque-body'), {}),
    'packed defineMigration exposes migration contents');

  let executorReads = 0;
  const hostileExecutor = new Proxy({}, {
    get() {
      executorReads += 1;
      throw new Error('executor property touched');
    },
  });
  try {
    storageModule.wrapExecutor(hostileExecutor);
    throw new Error('packed executor compatibility wrapper unexpectedly returned');
  } catch (error) {
    invariant(error?.code === 'KNOWLEDGE_HOSTED_CONTAINED',
      'packed executor compatibility wrapper did not fail closed');
  }
  invariant(executorReads === 0, 'packed compatibility surface inspected a caller executor');

  console.log(`[knowledge] packed extraction verified ${listed.length} files, strict production declarations with three restored dependency controls, and 4 bins`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

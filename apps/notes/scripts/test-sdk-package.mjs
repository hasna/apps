#!/usr/bin/env bun
// Compile only public imports from a fresh npm installation, outside this monorepo.
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { npmPackCommand, packedFilename, runSdkPackageCommand } from './pack-output.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2];
const scratch = destination ? resolve(destination) : mkdtempSync(join(tmpdir(), 'notes-sdk-package-'));
if (destination) mkdirSync(scratch); // Refuse reuse of prior evidence.
const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, SystemRoot: process.env.SystemRoot,
  npm_config_userconfig: join(scratch, 'npmrc'), npm_config_globalconfig: join(scratch, 'global-npmrc'),
  npm_config_cache: join(scratch, 'cache'), npm_config_registry: 'https://registry.npmjs.org',
  npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
writeFileSync(env.npm_config_userconfig, '');
writeFileSync(env.npm_config_globalconfig, '');
const run = (command, cwd, log, expected = 0) =>
  runSdkPackageCommand(command, { cwd, env, log, expected, evidenceDir: scratch });

let passed = false;
try {
  run([process.execPath, 'scripts/sdk-declarations.mjs', '--check'], root, 'generated.log');
  const packed = run(npmPackCommand(scratch), root, 'pack.json');
  const archive = join(scratch, packedFilename(packed));
  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  const dev = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies;
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'notes-sdk-external-consumer', private: true, type: 'module',
    dependencies: { '@hasna/notes': `file:${archive}` }, devDependencies: { typescript: dev.typescript, '@types/node': dev['@types/node'] } }, null, 2));
  run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer, 'install.log');
  run(['npm', 'ls', '--all', '--json'], consumer, 'installed-graph.log');
  const nodeVersion = run(['node', '--version'], consumer, 'node-version.log').trim();
  const npmVersion = run(['npm', '--version'], consumer, 'npm-version.log').trim();
  copyFileSync(join(root, 'test/classic-sdk.types.mts'), join(consumer, 'consumer.mts'));
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    strict: true, skipLibCheck: false, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', types: ['node'],
  }, files: ['consumer.mts'] }, null, 2));
  const tsc = ['node', 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--pretty', 'false'];
  run(tsc, consumer, 'strict-positive-negative.log');
  const source = readFileSync(join(consumer, 'consumer.mts'), 'utf8');
  writeFileSync(join(consumer, 'consumer.mts'), source.replace(/^\s*\/\/ @ts-expect-error.*$/gm, ''));
  const rejected = run(tsc, consumer, 'negative-controls.log', 2);
  if (!rejected.includes('TS2322') || !rejected.includes('TS2345') || !rejected.includes('TS2353') || !rejected.includes('TS2339')) throw new Error('Expected typed rejection diagnostics missing');
  writeFileSync(join(consumer, 'consumer.mts'), source);
  const declaration = join(consumer, 'node_modules/@hasna/notes/sdk/index.d.mts');
  renameSync(declaration, `${declaration}.held`);
  try {
    const missing = run(tsc, consumer, 'missing-declarations.log', 2);
    if (!missing.includes('TS7016')) throw new Error('Missing declarations did not reject public imports');
  } finally { renameSync(`${declaration}.held`, declaration); }
  writeFileSync(join(consumer, 'runtime.mjs'), `import assert from 'node:assert/strict';\nimport * as root from '@hasna/notes';\nimport * as sdk from '@hasna/notes/sdk';\nimport {NotesClient as Browser} from '@hasna/notes/sdk/browser';\nassert.deepEqual(Object.keys(root), Object.keys(sdk));\nfor (const key of Object.keys(root)) assert.equal(root[key],sdk[key]);\nassert.notEqual(root.NotesClient, Browser);\nconsole.log('root/sdk runtime identity and separate browser export verified');\n`);
  run(['node', 'runtime.mjs'], consumer, 'runtime-exports.log');
  const metadata = JSON.parse(readFileSync(join(consumer, 'node_modules/@hasna/notes/package.json'), 'utf8'));
  const producer = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (metadata.name !== producer.name || metadata.version !== producer.version) throw new Error('Installed package identity drift');
  const receipt = { nodeVersion, npmVersion, package: metadata.name, version: metadata.version, archiveSha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
    typescript: dev.typescript, nodeTypes: dev['@types/node'], strict: true, skipLibCheck: false, overrides: false,
    runtimeRootEqualsSdk: true, separateBrowser: true, missingDeclarationRefusal: true, typedNegativeRefusals: true,
    scope: 'Installed declaration checking and module import identity; application requests are not measured' };
  writeFileSync(join(scratch, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
  passed = true;
} finally {
  if (passed && !destination) rmSync(scratch, { recursive: true, force: true });
  else console.log(`SDK package evidence: ${scratch}`);
}

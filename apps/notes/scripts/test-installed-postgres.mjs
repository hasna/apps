#!/usr/bin/env bun
// Full acceptance is Linux-only; no machine Keychain or private test package.
import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync, rmSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { sdkPackageCommand } from './pack-output.mjs';

assert.equal(process.platform, 'linux', 'Installed four-surface PostgreSQL acceptance requires Linux');
const databaseUrl = process.env.NOTES_TEST_DATABASE_URL;
assert(databaseUrl, 'NOTES_TEST_DATABASE_URL is required; PostgreSQL acceptance cannot skip');
const database = new URL(databaseUrl);
assert(['postgres:', 'postgresql:'].includes(database.protocol) && database.hostname === '127.0.0.1'
  && Number(database.port) > 1024 && database.username === 'postgres' && database.pathname === '/notes_installed_ci'
  && !database.password && !database.search && !database.hash, 'Only the owned installed-consumer database is accepted');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert(process.argv[2], 'A new evidence directory is required');
const scratch = resolve(process.argv[2]);
const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR };
const packed = Bun.spawnSync(sdkPackageCommand(scratch), { cwd: root, env, stdout: 'pipe', stderr: 'pipe', timeout: 240000 });
assert.equal(packed.exitCode, 0, 'Strict fresh package preparation failed');
const consumer = join(scratch, 'consumer'), packageDir = realpathSync(join(consumer, 'node_modules/@hasna/notes'));
assert.equal(packageDir, join(consumer, 'node_modules/@hasna/notes'));
const snapshot = () => {
  const files = {};
  function visit(path) {
    const stat = lstatSync(path); assert(!stat.isSymbolicLink(), 'Installed package contains a source link');
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
    else { assert(stat.isFile()); files[relative(packageDir, path)] = createHash('sha256').update(readFileSync(path)).digest('hex'); }
  }
  visit(packageDir); return files;
};
const before = snapshot(), metadata = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
copyFileSync(join(root, 'scripts/installed-pg-consumer.mjs'), join(consumer, 'installed-pg-consumer.mjs'));
let receipt;
try {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-env-file', 'installed-pg-consumer.mjs'], {
      cwd: consumer, env: { ...env, QA_NOTES_DATABASE_URL: databaseUrl, QA_NOTES_VERSION: metadata.version },
      stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    let stdout = '', bytes = 0, boundedFailure = false;
    const kill = () => {
      boundedFailure = true;
      if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') reject(error); }
    };
    const timer = setTimeout(kill, 120000);
    for (const [stream, save] of [[child.stdout, true], [child.stderr, false]]) stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 131072) kill();
      else if (save) stdout += chunk.toString();
    });
    child.once('error', error => { clearTimeout(timer); kill(); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ exitCode: code, stdout, boundedFailure }); });
  });
  // A failed consumer can contain disposable OTPs or reflected keys. Retain
  // failure status only; never publish arbitrary child output as CI evidence.
  if (result.exitCode !== 0) {
    let groups = [];
    try {
      const failed = JSON.parse(result.stdout);
      if (failed.status === 'failed' && Array.isArray(failed.completedGroups)) {
        groups = failed.completedGroups.filter(value => typeof value === 'string' && /^[a-z-]{1,100}$/.test(value));
      }
    } catch { /* Refuse arbitrary child output. */ }
    throw new Error(`Installed PostgreSQL consumer failed after groups: ${groups.join(', ') || 'none'}`);
  }
  assert.equal(result.boundedFailure, false, 'Installed consumer exceeded output/time bound');
  const value = JSON.parse(result.stdout);
  assert.equal(value.status, 'passed'); assert.equal(value.fullFourSurface, true);
  assert.equal(value.groups.length, 6); assert.equal(value.version, metadata.version);
  assert.deepEqual(snapshot(), before);
  receipt = { ...JSON.parse(readFileSync(join(scratch, 'receipt.json'), 'utf8')), installedPostgres: value,
    packageFiles: before, installedFilesUnchanged: true, privateDependencies: false, homeOverride: false };
} finally {
  for (const name of ['installed-pg-consumer.mjs', 'network-guard.mjs', 'owned-state']) rmSync(join(consumer, name), { recursive: true, force: true });
  assert.deepEqual(snapshot(), before);
}
receipt.ownedConsumerStateRemoved = true;
writeFileSync(join(scratch, 'installed-postgres-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(`Installed ${metadata.name}@${metadata.version}: all six PostgreSQL CLI/MCP/SDK/HTTP groups passed`);

#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const generated = [
  join(root, 'src', 'generated'),
  join(root, 'dist'),
  join(root, 'bin'),
  join(root, 'generated-artifacts.json'),
  join(root, 'repository-generated-artifacts.json'),
];

function digest() {
  const hash = createHash('sha256');
  const visit = (path) => {
    const stat = lstatSync(path);
    hash.update(relative(root, path));
    hash.update(String(stat.mode & 0o777));
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry));
    } else {
      hash.update(readFileSync(path));
    }
  };
  for (const path of generated) visit(path);
  return hash.digest('hex');
}

function runWithUmask(mask) {
  const command = `umask ${mask}; exec bun scripts/build.mjs`;
  const result = Bun.spawnSync(['bash', '-lc', command], {
    cwd: root,
    env: { ...process.env, BUN_CONFIG_INSTALL_AUTO: 'disable' },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
  const verify = Bun.spawnSync(['bun', 'scripts/verify-generated-artifacts.mjs'], {
    cwd: root,
    env: { ...process.env, BUN_CONFIG_INSTALL_AUTO: 'disable' },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (verify.exitCode !== 0) process.exit(verify.exitCode ?? 1);
  return digest();
}

if (process.platform === 'win32') {
  console.error('[knowledge] build determinism check requires POSIX umask support');
  process.exit(1);
}

const strict = runWithUmask('077');
const normal = runWithUmask('022');
if (strict !== normal) {
  console.error(`[knowledge] generated output differs by umask: ${strict} != ${normal}`);
  process.exit(1);
}
console.log(`[knowledge] deterministic generated digest ${normal}`);

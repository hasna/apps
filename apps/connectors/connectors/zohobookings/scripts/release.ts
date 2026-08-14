#!/usr/bin/env bun
/**
 * Release script for publishing to npm
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const isDryRun = process.argv.includes('--dry-run');

interface PackageJson {
  name: string;
  version: string;
  [key: string]: unknown;
}

function exec(command: string, silent = false): string {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit',
    });
    return result?.trim() || '';
  } catch (err) {
    if (silent) return '';
    throw err;
  }
}

function bumpPatch(version: string): string {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function main(): Promise<void> {
  const packageJson: PackageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
  const { name, version: localVersion } = packageJson;
  const npmVersion = exec(`npm view ${name} version 2>/dev/null`, true);
  let newVersion = localVersion;
  if (npmVersion && compareVersions(localVersion, npmVersion) <= 0) newVersion = bumpPatch(npmVersion);
  if (newVersion !== localVersion && !isDryRun) {
    packageJson.version = newVersion;
    writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
  }
  exec('bun run typecheck');
  exec('bun run build');
  exec(isDryRun ? 'npm publish --dry-run' : 'npm publish');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

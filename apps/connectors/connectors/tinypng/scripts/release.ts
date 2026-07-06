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
    if (silent) {
      return '';
    }
    throw err;
  }
}

function log(message: string): void {
  console.log(`\x1b[36m▸\x1b[0m ${message}`);
}

function success(message: string): void {
  console.log(`\x1b[32m✓\x1b[0m ${message}`);
}

function warn(message: string): void {
  console.log(`\x1b[33m⚠\x1b[0m ${message}`);
}

function error(message: string): void {
  console.error(`\x1b[31m✗\x1b[0m ${message}`);
}

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const [major, minor, patch] = version.split('.').map(Number);
  return { major, minor, patch };
}

function bumpPatch(version: string): string {
  const { major, minor, patch } = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

async function main(): Promise<void> {
  const packageJsonPath = 'package.json';
  const packageJson: PackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const { name, version: localVersion } = packageJson;

  log(`Package: ${name}`);
  log(`Local version: ${localVersion}`);

  let npmVersion = '';
  try {
    npmVersion = exec(`npm view ${name} version 2>/dev/null`, true);
    log(`npm version: ${npmVersion || 'not published'}`);
  } catch {
    log('npm version: not published yet');
  }

  let newVersion = localVersion;
  if (npmVersion) {
    const localParsed = parseVersion(localVersion);
    const npmParsed = parseVersion(npmVersion);

    if (
      localParsed.major < npmParsed.major ||
      (localParsed.major === npmParsed.major && localParsed.minor < npmParsed.minor) ||
      (localParsed.major === npmParsed.major &&
        localParsed.minor === npmParsed.minor &&
        localParsed.patch <= npmParsed.patch)
    ) {
      newVersion = bumpPatch(npmVersion);
    }
  }

  if (newVersion !== localVersion) {
    log(`Bumping version: ${localVersion} → ${newVersion}`);
    if (!isDryRun) {
      packageJson.version = newVersion;
      writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    }
  } else {
    log(`Version unchanged: ${newVersion}`);
  }

  log('Running typecheck...');
  if (!isDryRun) {
    exec('bun run typecheck');
    success('Typecheck passed');
  }

  log('Building...');
  if (!isDryRun) {
    exec('bun run build');
    success('Build completed');
  }

  const gitStatus = exec('git status --porcelain', true);
  if (gitStatus) {
    log('Staging changes...');
    if (!isDryRun) {
      exec('git add package.json');
      exec(`git commit -m "chore: release v${newVersion}"`);
    }
  }

  const tagName = `v${newVersion}`;
  log(`Creating tag: ${tagName}`);
  if (!isDryRun) {
    try {
      exec(`git tag ${tagName}`);
      success(`Tag ${tagName} created`);
    } catch {
      warn(`Tag ${tagName} already exists`);
    }
  }

  log('Publishing to npm...');
  if (isDryRun) {
    warn('Dry run - skipping publish');
    exec('npm publish --dry-run');
  } else {
    exec('npm publish');
    success(`Published ${name}@${newVersion}`);
  }

  if (!isDryRun) {
    log('Pushing tags...');
    try {
      exec('git push --tags');
      success('Tags pushed');
    } catch {
      warn('Failed to push tags (you may need to push manually)');
    }
  }

  console.log('');
  success(`Release ${isDryRun ? '(dry run) ' : ''}complete: ${name}@${newVersion}`);
}

main().catch((err) => {
  error(String(err));
  process.exit(1);
});

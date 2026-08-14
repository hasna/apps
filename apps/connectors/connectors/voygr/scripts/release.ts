#!/usr/bin/env bun
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

interface PackageJson {
  name: string;
  version: string;
  [key: string]: unknown;
}

const isDryRun = process.argv.includes('--dry-run');
const packageJsonPath = 'package.json';

function exec(command: string, silent = false): string {
  const result = execSync(command, {
    encoding: 'utf-8',
    stdio: silent ? 'pipe' : 'inherit',
  });
  return result?.trim() || '';
}

function findPackageManager(): 'npm' | 'pnpm' {
  for (const command of ['npm', 'pnpm'] as const) {
    try {
      exec(`command -v ${command}`, true);
      return command;
    } catch {
      // Try the next package manager.
    }
  }

  throw new Error('npm or pnpm is required to publish');
}

function log(message: string): void {
  console.log(`[release] ${message}`);
}

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return { major, minor, patch };
}

function bumpPatch(version: string): string {
  const { major, minor, patch } = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

function getPublishedVersion(name: string, packageManager: 'npm' | 'pnpm'): string {
  try {
    return exec(`${packageManager} view ${name} version`, true);
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
  const packageManager = findPackageManager();
  const publishedVersion = getPublishedVersion(packageJson.name, packageManager);
  let nextVersion = packageJson.version;

  log(`package ${packageJson.name}`);
  log(`local version ${packageJson.version}`);
  log(`published version ${publishedVersion || 'not published'}`);

  if (publishedVersion) {
    const local = parseVersion(packageJson.version);
    const published = parseVersion(publishedVersion);
    const localIsBehind =
      local.major < published.major ||
      (local.major === published.major && local.minor < published.minor) ||
      (local.major === published.major &&
        local.minor === published.minor &&
        local.patch <= published.patch);

    if (localIsBehind) {
      nextVersion = bumpPatch(publishedVersion);
    }
  }

  if (nextVersion !== packageJson.version) {
    log(`next version ${nextVersion}`);
    if (!isDryRun) {
      packageJson.version = nextVersion;
      writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    }
  }

  exec('bun run typecheck');
  exec('bun run build');

  if (isDryRun) {
    log(`dry run complete; skipping ${packageManager} publish`);
    return;
  }

  exec(`${packageManager} publish`);
  log(`published ${packageJson.name}@${nextVersion}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

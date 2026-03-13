#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bumpType = args.find(arg => ['patch', 'minor', 'major'].includes(arg)) || 'patch';

const packagePath = join(import.meta.dir, '..', 'package.json');
const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));

// Parse current version
const [major, minor, patch] = pkg.version.split('.').map(Number);

// Bump version
let newVersion: string;
switch (bumpType) {
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case 'patch':
  default:
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
}

console.log(`📦 ${pkg.name}`);
console.log(`   Current version: ${pkg.version}`);
console.log(`   New version: ${newVersion}`);
console.log(`   Bump type: ${bumpType}`);
console.log('');

if (dryRun) {
  console.log('🔍 Dry run - no changes will be made');
  process.exit(0);
}

// Update package.json
pkg.version = newVersion;
writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
console.log('✅ Updated package.json');

// Build
console.log('📦 Building...');
const buildProc = Bun.spawnSync(['bun', 'run', 'build'], {
  cwd: join(import.meta.dir, '..'),
  stdout: 'inherit',
  stderr: 'inherit',
});

if (buildProc.exitCode !== 0) {
  console.error('❌ Build failed');
  process.exit(1);
}
console.log('✅ Build complete');

// Publish
console.log('📤 Publishing...');
const publishProc = Bun.spawnSync(['npm', 'publish'], {
  cwd: join(import.meta.dir, '..'),
  stdout: 'inherit',
  stderr: 'inherit',
});

if (publishProc.exitCode !== 0) {
  console.error('❌ Publish failed');
  process.exit(1);
}

console.log('');
console.log(`✅ Published ${pkg.name}@${newVersion}`);

#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsonOutput = process.argv.includes('--json');

const publicDocs = [
  'docs/architecture/ai-native-knowledge-base.md',
  'docs/architecture/hosted-wrapper-responsibilities.md',
  'docs/architecture/hybrid-semantic-search.md',
  'docs/architecture/machine-sync-schema.md',
  'docs/examples/app-project-wiki-standard.md',
  'docs/examples/company-wiki-workflow.md',
  'docs/migration/global-rules-provenance-import.md',
  'docs/migration/json-to-sqlite.md',
].sort();

const publicScripts = [
  'scripts/apply-cloud-migrations.mjs',
  'scripts/smoke-machine-sync-release.mjs',
  'scripts/smoke-machines-adapter.mjs',
  'scripts/smoke-open-files-installed-boundary.mjs',
  'scripts/strip-generated-trailing-whitespace.mjs',
  'scripts/verify-generated-artifacts.mjs',
].sort();

const forbiddenPackagePaths = [
  'docs/canonical-secrets-bootstrap-2026-06-08.md',
  'scripts/validate-public-package.mjs',
].sort();

function normalizePackagePath(path) {
  return String(path).replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

function readPackageJson() {
  return JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
}

function readPackedFiles() {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // On Windows the npm launcher is npm.cmd, which spawnSync only resolves via a shell.
    shell: process.platform === 'win32',
  });
  if (result.error) {
    throw new Error(`npm pack --dry-run could not be spawned:\n${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`npm pack --dry-run failed:\n${result.stderr || result.stdout || `exit code ${result.status}`}`);
  }
  const packs = JSON.parse(result.stdout);
  if (!Array.isArray(packs) || !packs[0]?.files) {
    throw new Error('npm pack --dry-run returned an unexpected manifest.');
  }
  return {
    filename: packs[0].filename,
    files: packs[0].files.map((file) => normalizePackagePath(file.path)).sort(),
  };
}

const errors = [];
const packageJson = readPackageJson();
const packageFiles = Array.isArray(packageJson.files)
  ? packageJson.files.map(normalizePackagePath)
  : [];

for (const broadDocsEntry of ['docs', 'docs/*', 'docs/**']) {
  if (packageFiles.includes(broadDocsEntry)) {
    errors.push(`package.json files must not include broad docs entry ${broadDocsEntry}.`);
  }
}

for (const broadScriptsEntry of ['scripts', 'scripts/*', 'scripts/**']) {
  if (packageFiles.includes(broadScriptsEntry)) {
    errors.push(`package.json files must not include broad scripts entry ${broadScriptsEntry}.`);
  }
}

for (const doc of publicDocs) {
  if (!packageFiles.includes(doc)) {
    errors.push(`Public docs allowlist is missing ${doc}.`);
  }
}

for (const script of publicScripts) {
  if (!packageFiles.includes(script)) {
    errors.push(`Public scripts allowlist is missing ${script}.`);
  }
}

for (const forbiddenPath of forbiddenPackagePaths) {
  if (packageFiles.includes(forbiddenPath)) {
    errors.push(`Forbidden path is explicitly listed in package files: ${forbiddenPath}.`);
  }
}

let packed = { filename: null, files: [] };
try {
  packed = readPackedFiles();
  const packedFileSet = new Set(packed.files);
  const packedDocs = packed.files.filter((path) => path.startsWith('docs/')).sort();
  const packedScripts = packed.files.filter((path) => path.startsWith('scripts/')).sort();

  for (const forbiddenPath of forbiddenPackagePaths) {
    if (packedFileSet.has(forbiddenPath)) {
      errors.push(`Forbidden path is included in npm pack output: ${forbiddenPath}.`);
    }
  }

  for (const doc of publicDocs) {
    if (!packedFileSet.has(doc)) {
      errors.push(`Public doc is missing from npm pack output: ${doc}.`);
    }
  }

  for (const doc of packedDocs) {
    if (!publicDocs.includes(doc)) {
      errors.push(`Unreviewed docs path is included in npm pack output: ${doc}.`);
    }
  }

  for (const script of publicScripts) {
    if (!packedFileSet.has(script)) {
      errors.push(`Public script is missing from npm pack output: ${script}.`);
    }
  }

  for (const script of packedScripts) {
    if (!publicScripts.includes(script)) {
      errors.push(`Unreviewed scripts path is included in npm pack output: ${script}.`);
    }
  }
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

const summary = {
  ok: errors.length === 0,
  package: packed.filename,
  totalFiles: packed.files.length,
  docsFiles: packed.files.filter((path) => path.startsWith('docs/')).sort(),
  scriptsFiles: packed.files.filter((path) => path.startsWith('scripts/')).sort(),
  publicDocs,
  publicScripts,
  forbiddenPackagePaths,
  errors,
};

if (jsonOutput) {
  console.log(JSON.stringify(summary, null, 2));
} else if (summary.ok) {
  console.log(`Public package validation passed for ${summary.package}.`);
  console.log(`Public docs included: ${summary.docsFiles.length}.`);
  console.log(`Public scripts included: ${summary.scriptsFiles.length}.`);
} else {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
}

if (!summary.ok) {
  process.exitCode = 1;
}

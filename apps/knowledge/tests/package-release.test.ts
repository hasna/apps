/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  files: string[];
};

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

describe('public package release safety', () => {
  test('package files list public docs explicitly', () => {
    expect(packageJson.files).not.toContain('docs');
    expect(packageJson.files).not.toContain('docs/*');
    expect(packageJson.files).not.toContain('docs/**');
    expect(packageJson.files).not.toContain('scripts');
    expect(packageJson.files).not.toContain('scripts/*');
    expect(packageJson.files).not.toContain('scripts/**');

    for (const doc of publicDocs) {
      expect(packageJson.files).toContain(doc);
    }

    for (const script of publicScripts) {
      expect(packageJson.files).toContain(script);
    }

    for (const path of forbiddenPackagePaths) {
      expect(packageJson.files).not.toContain(path);
    }
  });

  test('npm pack dry-run includes only public docs', () => {
    const result = spawnSync('node', ['scripts/validate-public-package.mjs', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });

    if (result.status !== 0) {
      throw new Error(`public package validation failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }

    const summary = JSON.parse(result.stdout) as {
      ok: boolean;
      docsFiles: string[];
      scriptsFiles: string[];
      forbiddenPackagePaths: string[];
    };

    expect(summary.ok).toBe(true);
    expect(summary.docsFiles).toEqual(publicDocs);
    expect(summary.scriptsFiles).toEqual(publicScripts);
    expect(summary.forbiddenPackagePaths).toEqual(forbiddenPackagePaths);
    for (const path of forbiddenPackagePaths) {
      expect(summary.docsFiles).not.toContain(path);
      expect(summary.scriptsFiles).not.toContain(path);
    }
  });
});

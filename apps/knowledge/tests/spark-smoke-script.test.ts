import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');
const script = join(repoRoot, 'scripts', 'smoke-spark-sync-release.mjs');
const openFilesBoundaryScript = join(repoRoot, 'scripts', 'smoke-open-files-installed-boundary.mjs');

describe('spark sync release smoke script', () => {
  test('prints help without requiring ssh or installed packages', () => {
    const result = spawnSync(process.execPath, [script, '--help'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('smoke-spark-sync-release.mjs');
    expect(result.stdout).toContain('sync doctor');
    expect(result.stdout).toContain('@hasna/machines hidden locally');
    expect(result.stdout).toContain('--peer-workspace omitted');
  });

  test('renders dry-run release evidence plan as JSON', () => {
    const result = spawnSync(process.execPath, [
      script,
      '--dry-run',
      '--json',
      '--remote',
      'spark01',
      '--peer',
      'spark01',
      '--knowledge-version',
      '0.0.0-test',
      '--machines-version',
      '0.0.0-machines',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      ok: true,
      dry_run: true,
      remote: 'spark01',
      peer: 'spark01',
      knowledge_version: '0.0.0-test',
      machines_version: '0.0.0-machines',
      no_machines_sync: true,
      no_machines_registry_sync: true,
    });
    expect(output.checks).toContain('run knowledge machines adapter smoke locally and remotely');
    expect(output.checks).toContain('assert artifact manifest modified_at/provenance/raw-source boundary');
    expect(output.checks).toContain('assert final bidirectional dry-run has zero conflicts');
    expect(output.checks).toContain('run isolated installed-package sync with @hasna/machines and machines CLI hidden');
    expect(output.checks).toContain('learn registry fallback then run isolated hidden-machines sync with --peer-workspace omitted');
  });
});

describe('installed open-files boundary smoke script', () => {
  test('prints help without requiring installed files or knowledge commands', () => {
    const result = spawnSync(process.execPath, [openFilesBoundaryScript, '--help'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('smoke-open-files-installed-boundary.mjs');
    expect(result.stdout).toContain('installed open-files to open-knowledge source-boundary smoke');
    expect(result.stdout).toContain('scan both knowledge SQLite stores and artifacts');
  });

  test('renders dry-run installed open-files boundary evidence plan as JSON', () => {
    const result = spawnSync(process.execPath, [
      openFilesBoundaryScript,
      '--dry-run',
      '--json',
      '--files-bin',
      'files-test',
      '--knowledge-bin',
      'knowledge-test',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      ok: true,
      dry_run: true,
      files_bin: 'files-test',
      knowledge_bin: 'knowledge-test',
    });
    expect(output.checks).toContain('run installed files sources/index/manifest/doctor/resolve/extract-text');
    expect(output.checks).toContain('redact raw sentinel before knowledge ingest');
    expect(output.checks).toContain('scan source and peer knowledge SQLite/artifacts for raw sentinel and base64');
  });
});

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');
const script = join(repoRoot, 'scripts', 'smoke-spark-sync-release.mjs');

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
    });
    expect(output.checks).toContain('run knowledge machines adapter smoke locally and remotely');
    expect(output.checks).toContain('assert artifact manifest modified_at/provenance/raw-source boundary');
    expect(output.checks).toContain('assert final bidirectional dry-run has zero conflicts');
    expect(output.checks).toContain('run isolated installed-package sync with @hasna/machines and machines CLI hidden');
  });
});

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import { join } from 'path';

const cliPath = join(import.meta.dir, 'index.ts');

describe('testerarmy CLI', () => {
  test('prints help without credentials', () => {
    const result = spawnSync('bun', [cliPath, '--help'], {
      encoding: 'utf-8',
      cwd: join(import.meta.dir, '..', '..'),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('TesterArmy API connector CLI');
    expect(result.stdout).toContain('projects');
    expect(result.stdout).toContain('raw-request');
  });
});

import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env';

const root = join(import.meta.dir, '..');

test('local package extraction has the exact contained release boundary', () => {
  const result = Bun.spawnSync(['bun', 'scripts/check-package-extraction.mjs'], {
    cwd: root,
    env: sanitizedLocalTestEnv({ BUN_CONFIG_INSTALL_AUTO: 'disable' }),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  expect(result.exitCode, stderr).toBe(0);
  expect(stdout).toContain('[knowledge] packed extraction verified 64 files, strict production declarations with three restored dependency controls, and 4 bins');
}, 30_000);

import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env';

test('pinned source and committed declaration consumers compile', () => {
  const root = join(import.meta.dir, '..');
  const result = Bun.spawnSync(['bun', 'scripts/check-declaration-compatibility.mjs'], {
    cwd: root,
    env: sanitizedLocalTestEnv({ BUN_CONFIG_INSTALL_AUTO: 'disable' }),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  expect(result.exitCode, `${stdout}\n${stderr}`).toBe(0);
  expect(stdout).toContain('source and committed declaration consumers compiled');
}, 15_000);

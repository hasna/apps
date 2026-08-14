import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Tepali profile config permissions', () => {
  test('stores profile credentials in private files and directories', () => {
    const home = mkdtempSync(join(tmpdir(), 'connect-tepali-config-'));

    try {
      const script = `
        import { chmodSync, statSync } from 'fs';
        import { join } from 'path';
        import { createProfile, getConfigDir, saveProfile } from './src/utils/config.ts';

        function mode(path) {
          return statSync(path).mode & 0o777;
        }

        createProfile('clinic', { apiKey: 'secret-key' });
        const configDir = getConfigDir();
        const profilesDir = join(configDir, 'profiles');
        const profilePath = join(profilesDir, 'clinic.json');
        const initial = [mode(configDir), mode(profilesDir), mode(profilePath)];

        chmodSync(profilePath, 0o644);
        saveProfile({ apiKey: 'new-secret' }, 'clinic');
        const rewritten = mode(profilePath);

        console.log(JSON.stringify({ initial, rewritten }));
      `;

      const result = Bun.spawnSync({
        cmd: ['bun', '-e', script],
        cwd: import.meta.dir.replace('/src/utils', ''),
        env: { ...process.env, HOME: home },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).toBe('');
      expect(JSON.parse(result.stdout.toString())).toEqual({
        initial: [0o700, 0o700, 0o600],
        rewritten: 0o600,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

import { describe, expect, test } from 'bun:test';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultKnowledgeConfig } from '../src/workspace';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env';

const root = join(import.meta.dir, '..');

describe('built CLI S3 containment', () => {
  test('local plus canonical example is rejected before config or artifacts', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'knowledge-bin-canonical-contained-'));
    const result = Bun.spawnSync([
      'bun', join(root, 'bin', 'knowledge.js'),
      'setup', '--mode', 'local', '--canonical-example', '--scope', 'project', '--json',
    ], {
      cwd,
      env: sanitizedLocalTestEnv({ BUN_CONFIG_INSTALL_AUTO: 'disable' }),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).toBe(1);
    expect(new TextDecoder().decode(result.stderr)).toContain('KNOWLEDGE_RUNTIME_INTENT_INVALID');
    expect(existsSync(join(cwd, '.hasna'))).toBe(false);
  });

  test('persisted S3 config is contained before AWS client or credential module evaluation', () => {
    const cwd = mkdtempSync(join(root, '.knowledge-bin-s3-tripwire-'));
    const copiedBin = join(cwd, 'bin', 'knowledge.js');
    const marker = join(cwd, 'aws-module-evaluated');
    mkdirSync(join(cwd, 'bin'), { recursive: true });
    cpSync(join(root, 'bin', 'knowledge.js'), copiedBin);

    for (const [name, source] of [
      ['client-s3', `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.KNOWLEDGE_S3_TRIPWIRE, 'client');\nexport class S3Client { constructor() { writeFileSync(process.env.KNOWLEDGE_S3_TRIPWIRE, 'constructed'); } async send() { writeFileSync(process.env.KNOWLEDGE_S3_TRIPWIRE, 'called'); } }\nexport class PutObjectCommand {}\nexport class GetObjectCommand {}\nexport class HeadObjectCommand {}\n`],
      ['credential-providers', `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.KNOWLEDGE_S3_TRIPWIRE, 'credentials');\nexport const fromIni = () => { writeFileSync(process.env.KNOWLEDGE_S3_TRIPWIRE, 'credential-called'); };\n`],
    ] as const) {
      const packageDir = join(cwd, 'node_modules', '@aws-sdk', name);
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
      writeFileSync(join(packageDir, 'index.js'), source);
    }

    const config = defaultKnowledgeConfig();
    config.storage = {
      type: 's3',
      artifacts_root: 'artifacts',
      s3: { bucket: 'synthetic-bucket' },
    };
    const home = join(cwd, '.hasna', 'knowledge');
    mkdirSync(home, { recursive: true });
    const configPath = join(home, 'config.json');
    const original = `${JSON.stringify(config)}\n`;
    writeFileSync(configPath, original);

    try {
      const result = Bun.spawnSync([
        'bun', copiedBin, 'wiki', 'init', '--scope', 'project', '--json',
      ], {
        cwd,
        env: sanitizedLocalTestEnv({
          BUN_CONFIG_INSTALL_AUTO: 'disable',
          KNOWLEDGE_S3_TRIPWIRE: marker,
        }),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(result.exitCode).toBe(1);
      expect(new TextDecoder().decode(result.stderr)).toContain('KNOWLEDGE_CONFIG_INVALID');
      expect(existsSync(marker)).toBe(false);
      expect(readFileSync(configPath, 'utf8')).toBe(original);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

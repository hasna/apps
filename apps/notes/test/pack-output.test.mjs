import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, lstatSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { npmPackCommand, sdkPackageCommand, packedFilename, runSdkPackageCommand } from '../scripts/pack-output.mjs';

describe('exact npm artifact selection', () => {
  test('selects the single npm archive without reconstructing a Bun payload', () => {
    expect(packedFilename(JSON.stringify([{ filename: 'hasna-notes-0.5.0.tgz', files: [] }]))).toBe('hasna-notes-0.5.0.tgz');
  });

  test('rejects malformed, empty, ambiguous, or missing pack metadata', () => {
    for (const output of ['not json', '{}', '[]', '[{}]', '[{"filename":1}]', '[{"filename":"one.tgz"},{"filename":"two.tgz"}]']) {
      expect(() => packedFilename(output)).toThrow();
    }
  });

  test('rejects directories, traversal, absolute paths and non-archives', () => {
    for (const filename of ['', '.', '..', '../outside.tgz', 'nested/file.tgz', '/tmp/outside.tgz', 'C:\\outside.tgz', 'nested\\file.tgz', 'file.json']) {
      expect(() => packedFilename(JSON.stringify([{ filename }]))).toThrow(/artifact filename/);
    }
  });

  test('materializes the inner archive even when an outer npm pack is a dry run', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'notes-npm-dry-run-test-'));
    try {
      const destination = join(fixture, 'archives');
      mkdirSync(destination);
      writeFileSync(join(fixture, 'package.json'), JSON.stringify({
        name: 'notes-npm-dry-run-fixture', version: '1.0.0', files: ['index.js'],
        scripts: { prepack: 'node -e "process.exit(73)"' },
      }));
      writeFileSync(join(fixture, 'index.js'), 'module.exports = true;\n');
      const command = npmPackCommand(destination);
      const options = {
        cwd: fixture, env: { ...process.env, npm_config_dry_run: 'true', NPM_CONFIG_DRY_RUN: 'true' },
        stdout: 'pipe', stderr: 'pipe',
      };
      // Negative control: npm reports success and a filename without a file.
      const dry = Bun.spawnSync(command.filter(arg => arg !== '--dry-run=false'), options);
      expect(dry.exitCode).toBe(0);
      const dryArchive = join(destination, packedFilename(new TextDecoder().decode(dry.stdout)));
      expect(existsSync(dryArchive)).toBe(false);
      // Positive control also proves prepack cannot recursively execute.
      const actual = Bun.spawnSync(command, options);
      expect(actual.exitCode).toBe(0);
      const archive = join(destination, packedFilename(new TextDecoder().decode(actual.stdout)));
      expect(lstatSync(archive).isFile()).toBe(true);
      expect(lstatSync(archive).size).toBeGreaterThan(0);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30000);
});

test('packed consumer keeps npm notice stderr out of machine stdout and retains both streams', () => {
  const root = mkdtempSync(join(tmpdir(), 'notes-pack-streams-'));
  const warning = 'npm notice New major version of npm available!';
  try {
    const stdout = runSdkPackageCommand([process.execPath, '-e',
      `process.stdout.write(JSON.stringify([{filename:'owned.tgz'}]));process.stderr.write(${JSON.stringify(warning)})`],
      { cwd: root, env: {}, evidenceDir: root, log: 'pack.json' });
    expect(packedFilename(stdout)).toBe('owned.tgz');
    expect(readFileSync(join(root, 'pack.json'), 'utf8')).toBe(stdout);
    expect(readFileSync(join(root, 'pack.json.stderr.log'), 'utf8')).toBe(warning);
    expect(stdout).not.toContain('npm notice');
    expect(() => runSdkPackageCommand([process.execPath, '-e',
      `process.stdout.write(JSON.stringify([{filename:'owned.tgz'}]));process.stderr.write(${JSON.stringify(warning)});process.exit(7)`],
      { cwd: root, env: {}, evidenceDir: root, log: 'failed.json' })).toThrow('expected exit 0, got 7');
    const malformed = runSdkPackageCommand([process.execPath, '-e',
      `process.stdout.write('not JSON');process.stderr.write(${JSON.stringify(warning)})`],
      { cwd: root, env: {}, evidenceDir: root, log: 'malformed.json' });
    expect(() => packedFilename(malformed)).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('installed PostgreSQL package preparation refuses producer dotenv reload', () => {
  const root = mkdtempSync(join(tmpdir(), 'notes-pack-dotenv-'));
  try {
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, '.env'), 'QA_NOTES_DOTENV_CANARY=owned-dotenv-canary\n');
    writeFileSync(join(root, 'scripts/test-sdk-package.mjs'), 'console.log(process.env.QA_NOTES_DOTENV_CANARY ?? "absent");');
    const command = sdkPackageCommand(join(root, 'output'));
    const options = { cwd: root, env: {}, stdout: 'pipe', stderr: 'pipe' };
    const poisoned = Bun.spawnSync(command.filter(value => value !== '--no-env-file'), options);
    expect(poisoned.exitCode).toBe(0);
    expect(new TextDecoder().decode(poisoned.stdout).trim()).toBe('owned-dotenv-canary');
    const isolated = Bun.spawnSync(command, options);
    expect(isolated.exitCode).toBe(0);
    expect(new TextDecoder().decode(isolated.stdout).trim()).toBe('absent');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env';

const root = join(import.meta.dir, '..');

function hashOutputs(): string {
  const hash = createHash('sha256');
  const roots = [
    join(root, 'src', 'generated'),
    join(root, 'dist'),
    join(root, 'bin', 'knowledge.js'),
    join(root, 'bin', 'knowledge-mcp.js'),
    join(root, 'bin', 'knowledge-serve.js'),
    join(root, 'bin', 'knowledge-migrate.js'),
    join(root, 'generated-artifacts.json'),
    join(root, 'repository-generated-artifacts.json'),
  ];
  const visit = (path: string) => {
    const stat = lstatSync(path);
    hash.update(relative(root, path));
    hash.update(String(stat.mode & 0o777));
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry));
    } else {
      hash.update(readFileSync(path));
    }
  };
  for (const path of roots) visit(path);
  return hash.digest('hex');
}

describe('Bun-only release and reproducible build contract', () => {
  test('manifest and CI advertise Bun only, with a declared pinned local compiler', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(pkg.engines).toEqual({ bun: '>=1.3.13' });
    expect(pkg.packageManager).toBe('bun@1.3.13');
    expect(pkg.devDependencies.typescript).toMatch(/^\d+\.\d+\.\d+$/);
    expect(ci).not.toMatch(/runtime:\s*\[[^\]]*node/);
    expect(ci).not.toContain('actions/setup-node');
    expect(existsSync(join(root, 'node_modules', 'typescript', 'bin', 'tsc'))).toBe(true);
  });

  test('published runtime commands resolve to included built targets', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.files).toContain('bin');
    expect(pkg.files).toContain('dist');
    expect(pkg.files).not.toContain('src');
    expect(pkg.files).not.toContain('scripts');
    expect(pkg.scripts.serve).toBe('bun bin/knowledge-serve.js');
    expect(pkg.scripts['migrate:cloud']).toBeUndefined();
    for (const script of ['serve']) {
      expect(pkg.scripts[script]).not.toContain('src/');
      const target = pkg.scripts[script].split(/\s+/).at(-1);
      expect(existsSync(join(root, target))).toBe(true);
      expect(readFileSync(join(root, target), 'utf8')).not.toMatch(/from\s+['"]\.\.\/src\//);
    }
  });

  test('build and generated verification are local, failure-safe, and cover every bin', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const build = readFileSync(join(root, 'scripts', 'build.mjs'), 'utf8');
    const verify = readFileSync(join(root, 'scripts', 'verify-generated-artifacts.mjs'), 'utf8');
    expect(pkg.scripts.build).toBeUndefined();
    expect(build).toContain('node_modules/typescript/bin/tsc');
    expect(build).toContain("BUN_CONFIG_INSTALL_AUTO: 'disable'");
    expect(build).not.toContain('rm -rf dist');
    expect(verify).toContain('generated-artifacts.json');
    expect(verify).not.toContain('git diff');
    for (const file of [
      'bin/knowledge.js',
      'bin/knowledge-mcp.js',
      'bin/knowledge-serve.js',
      'bin/knowledge-migrate.js',
    ]) {
      expect(verify).toContain(file);
    }
  });

  test('injected compiler failure leaves source, dist, and bin artifacts byte-for-byte intact', () => {
    const before = hashOutputs();
    const result = Bun.spawnSync(['bun', 'scripts/build.mjs'], {
      cwd: root,
      env: sanitizedLocalTestEnv({
        KNOWLEDGE_BUILD_INJECT_FAILURE: 'typecheck',
        BUN_CONFIG_INSTALL_AUTO: 'disable',
      }),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain('__injected-typecheck-failure.ts');
    expect(new TextDecoder().decode(result.stderr)).toContain('TypeScript declaration build failed');
    expect(hashOutputs()).toBe(before);
  });

  test('injected mid-replacement failure rolls every generated artifact back exactly', () => {
    const before = hashOutputs();
    const result = Bun.spawnSync(['bun', 'scripts/build.mjs'], {
      cwd: root,
      env: sanitizedLocalTestEnv({
        KNOWLEDGE_BUILD_INJECT_FAILURE: 'replace-2',
        BUN_CONFIG_INSTALL_AUTO: 'disable',
      }),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(result.stderr)).toContain(
      'injected transactional replacement failure after 2',
    );
    expect(hashOutputs()).toBe(before);
  });

  test('Bun imports work and any available real Node observes the Bun-only boundary', () => {
    const probe = "import('./dist/index.js').then(() => console.log('ok'))";
    const bun = Bun.spawnSync(['bun', '--eval', probe], {
      cwd: root,
      env: sanitizedLocalTestEnv({ BUN_CONFIG_INSTALL_AUTO: 'disable' }),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(bun.exitCode).toBe(0);
    expect(new TextDecoder().decode(bun.stdout)).toContain('ok');

    const nodePath = Bun.which('node');
    if (!nodePath) return;
    const version = Bun.spawnSync([nodePath, '--version'], {
      env: sanitizedLocalTestEnv(),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    // Bun commonly installs a `node` compatibility symlink. It is still Bun,
    // so only use a runtime that positively identifies itself as Node here.
    if (!/^v\d+\./.test(new TextDecoder().decode(version.stdout).trim())) return;

    const node = Bun.spawnSync([nodePath, '--input-type=module', '--eval', probe], {
      cwd: root,
      env: sanitizedLocalTestEnv(),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(node.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(node.stderr)).toMatch(/bun:sqlite|unsupported|scheme/i);
  });
});

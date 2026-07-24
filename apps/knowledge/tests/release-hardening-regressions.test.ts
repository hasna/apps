import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env';

const root = join(import.meta.dir, '..');

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runGeneratedVerifier(fixture: string) {
  return Bun.spawnSync([
    'bun',
    join(root, 'scripts', 'verify-generated-artifacts.mjs'),
    '--root',
    fixture,
  ], {
    cwd: fixture,
    env: sanitizedLocalTestEnv({ BUN_CONFIG_INSTALL_AUTO: 'disable' }),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

describe('Stage-A release hardening regressions', () => {
  test('lock, exact generator dependency, bins, package files, and runtime scripts are publish-safe', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const packageManifest = JSON.parse(readFileSync(join(root, 'generated-artifacts.json'), 'utf8'));
    const ignore = readFileSync(join(root, '.gitignore'), 'utf8');
    expect(ignore).not.toMatch(/^\*\.lock$/m);
    expect(pkg.dependencies['@hasna/contracts']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies['@hasna/contracts']).toBeUndefined();
    expect(pkg.bin).toEqual({
      knowledge: 'bin/knowledge.js',
      'knowledge-mcp': 'bin/knowledge-mcp.js',
      'knowledge-serve': 'bin/knowledge-serve.js',
      'knowledge-migrate': 'bin/knowledge-migrate.js',
    });
    expect(pkg.files).not.toContain('src');
    expect(pkg.files).not.toContain('scripts');
    expect(pkg.files).not.toContain('repository-generated-artifacts.json');
    expect(packageManifest.exact_roots).toEqual(['dist', 'bin']);
    expect(packageManifest.exact_files).toEqual([]);
    expect(packageManifest.files.every(({ path }: { path: string }) => /^(?:dist|bin)\//.test(path))).toBe(true);
    expect(Object.keys(pkg.scripts).sort()).toEqual(['serve']);
    for (const command of Object.values(pkg.scripts) as string[]) {
      const target = command.split(/\s+/).at(-1)!;
      expect(target).toMatch(/^bin\//);
      expect(pkg.files.some((entry: string) => entry === 'bin' || target.startsWith(`${entry}/`))).toBe(true);
    }
  });

  test('Bun release-age quarantine remains enabled with only supervised Hasna exclusions', () => {
    const bunfig = readFileSync(join(root, 'bunfig.toml'), 'utf8');
    expect(bunfig).toContain('minimumReleaseAge = 259200');
    expect(bunfig).toContain(
      'minimumReleaseAgeExcludes = ["@hasna/contracts", "@hasna/events"]',
    );
    expect(bunfig).not.toMatch(/minimumReleaseAge\s*=\s*0/);
  });

  test('Docker context is strict, pinned, frozen, and cannot overwrite installed platform dependencies', () => {
    const dockerignore = readFileSync(join(root, '.dockerignore'), 'utf8');
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    for (const forbidden of ['.git', 'node_modules', '.env', '.hasna', '.codewith', 'dist', 'bin']) {
      expect(dockerignore).toContain(forbidden);
    }
    expect(dockerignore).toContain('!bun.lock');
    const trustedImage = 'oven/bun:1.3.13-alpine@sha256:4de475389889577f346c636f956b42a5c31501b654664e9ae5726f94d7bb5349';
    const trustedCheckout = 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683';
    const trustedSetupBun = 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6';
    const fromInstructions = [...dockerfile.matchAll(/^\s*FROM\s+(.+?)\s*$/gmi)]
      .map((match) => `FROM ${match[1]}`);
    expect(fromInstructions).toEqual([
      `FROM --platform=linux/arm64 ${trustedImage} AS build`,
      `FROM --platform=linux/arm64 ${trustedImage} AS runtime`,
    ]);
    expect(dockerfile).not.toMatch(/^\s*#\s*syntax\s*=/mi);
    expect(dockerfile).not.toMatch(/^\s*ARG(?:\s|$)/mi);
    expect(dockerfile).not.toMatch(/^\s*FROM\s+.*(?:\$\{|\$[A-Za-z_])/mi);
    const actions = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
    expect(actions).toEqual([
      trustedCheckout,
      trustedSetupBun,
      trustedCheckout,
      trustedSetupBun,
    ]);
    expect(actions.every((action) => action === trustedCheckout || action === trustedSetupBun)).toBe(true);
    expect(workflow).not.toMatch(/^\s*(?:-\s*)?uses:\s*.*(?:\$\{|@(?![0-9a-f]{40}(?:\s|#|$)))/m);
    expect(dockerfile).toContain('bun install --frozen-lockfile');
    expect(dockerfile).not.toMatch(/^COPY\s+\.\s+\./m);
    expect(dockerfile).toContain('COPY package.json bun.lock bunfig.toml ./');
    expect(dockerfile).toContain('COPY --from=build /app/dist ./dist');
    const contextManifest = dockerfile
      .split('\n')
      .filter((line) => /^COPY\s+/.test(line) && !line.includes('--from='))
      .flatMap((line) => line.trim().split(/\s+/).slice(1, -1))
      .sort();
    expect(contextManifest).toEqual([
      'bun.lock',
      'bunfig.toml',
      'package.json',
      'scripts',
      'src',
      'tsconfig.build.json',
      'tsconfig.json',
    ]);
  });

  test('contributor and issue surfaces are Bun-only, README is deduplicated, and MCP HTTP is loopback-only', () => {
    const contributing = readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8');
    const bugTemplate = readFileSync(join(root, '.github', 'ISSUE_TEMPLATE', 'bug_report.yml'), 'utf8');
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    const mcpEntry = readFileSync(join(root, 'src', 'mcp-entry.js'), 'utf8');
    const mcpHttp = readFileSync(join(root, 'src', 'mcp-http.js'), 'utf8');
    expect(contributing).not.toMatch(/Node(?:\.js)?|Node\/Bun/i);
    expect(bugTemplate).not.toMatch(/Node(?:\.js)?/i);
    expect(readme).not.toContain('future future');
    expect(readme).toMatch(/loopback-only/i);
    expect(mcpEntry).not.toContain("flagValue(argv, '--host')");
    expect(mcpHttp).toContain('assertLoopbackHost');
  });

  test('README, CLI, and MCP describe only executable Stage-A authority', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    const security = readFileSync(join(root, 'SECURITY.md'), 'utf8');
    const cli = readFileSync(join(root, 'src', 'cli.ts'), 'utf8');
    const mcp = readFileSync(join(root, 'src', 'mcp.js'), 'utf8');
    const generatedGuidance = readFileSync(join(root, 'src', 'wiki-layout.ts'), 'utf8');
    const migrationGuide = readFileSync(
      join(root, 'docs', 'migration', 'json-to-sqlite.md'),
      'utf8',
    );
    const semanticArchitecture = readFileSync(
      join(root, 'docs', 'architecture', 'hybrid-semantic-search.md'),
      'utf8',
    );
    const aiArchitecture = readFileSync(
      join(root, 'docs', 'architecture', 'ai-native-knowledge-base.md'),
      'utf8',
    );

    expect(readme).toContain('No published migration bin or public');
    expect(readme).toContain('reads anchored `file://` refs only');
    expect(readme).not.toMatch(/operator (?:migration )?(?:target|path) can (?:reach|migrate)/i);
    expect(readme).not.toContain('or already-indexed open-files record');
    expect(readme).toContain('Web-search execution is unavailable during Stage A');
    expect(readme).toContain('`--fake`, and `--file-results` cannot enable it');
    expect(readme).not.toContain('HASNA_KNOWLEDGE_WEB_SEARCH=1 knowledge web search');
    expect(readme).not.toContain('`--fake` returns deterministic offline sources');
    expect(security).toContain('All public and internal web-search execution');
    expect(security).toContain('including fake mode');
    expect(security).toContain('unavailable during Stage A');
    expect(security).not.toContain('Web search is disabled unless explicitly enabled');
    expect(security).not.toContain('HASNA_KNOWLEDGE_WEB_SEARCH=1');
    expect(security).not.toMatch(/web.search.{0,80}(?:opt-in|explicitly enabled)/is);
    expect(cli).toContain('public Postgres sync contained');
    expect(cli).toContain('execution unavailable in Stage A');
    expect(cli).not.toContain('<file|s3://bucket/key>');
    expect(mcp).not.toContain('Push local knowledge.db catalog rows to storage PostgreSQL');
    expect(mcp).not.toContain('Manifest file path or s3:// URI to ingest');
    expect(mcp).toContain('Bounded local manifest file path to ingest');
    expect(migrationGuide).toContain('Execution, including fake mode, always returns typed containment');
    expect(migrationGuide).not.toContain('HASNA_KNOWLEDGE_WEB_SEARCH=1');
    expect(semanticArchitecture).toContain('unavailable during');
    expect(semanticArchitecture).not.toContain('are safety-gated, capture provider');
    expect(aiArchitecture).toContain('Provider configuration, environment settings');
    expect(aiArchitecture).not.toContain('Real network access\nis safety-gated');
    expect(generatedGuidance).toContain('including fake mode, is unavailable during Stage A');
  });

  test('generated verifier accepts an exact manifest and rejects mutation, deletion, extras, and stale text in a temp fixture', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-generated-verifier-'));
    const pinnedDeclaration = readFileSync(
      join(root, 'tests', 'fixtures', 'generated-api-e1eed58.d.ts'),
      'utf8',
    ).replace(/^\/\/ Pinned public declarations[^\n]*\n/, '');
    const files: Record<string, string> = {
      'src/generated/knowledge-api-client.ts': 'function containedClientBoundary() { throw new Error("contained"); }\ncontainedClientBoundary();\n',
      'dist/index.js': 'export const built = "KnowledgeApiClient is a zero-I/O compatibility boundary during Stage A";\n',
      'dist/index.d.ts': 'export declare const built: true;\n',
      'dist/generated/knowledge-api-client.d.ts': pinnedDeclaration,
      'dist/storage.js': 'export const storage = true;\n',
      'dist/storage.d.ts': 'export declare const storage: true;\n',
      'dist/serve.js': 'export const serve = true;\n',
      'dist/serve.d.ts': 'export declare const serve: true;\n',
      'dist/knowledge-db.d.ts': 'export declare const knowledgeDb: true;\n',
      'dist/db/pg-migrations.d.ts': 'export declare const migrations: readonly string[];\n',
      'dist/db/remote-storage.d.ts': 'export declare class RemoteStorage {}\n',
      'dist/db/storage-sync.d.ts': 'export declare function syncStorage(): Promise<void>;\n',
      'dist/generated/storage-kit/index.d.ts': 'export declare const KIT_VERSION = "0.4.0";\n',
      'dist/generated/storage-kit/migrations.d.ts': 'export interface Migration { sql: string; }\n',
      'dist/generated/storage-kit/query.d.ts': 'export interface Query { query<T>(): Promise<T>; }\n',
      'dist/mcp-payload.js': 'export const mcp = true;\n',
      'bin/knowledge.js': '#!/usr/bin/env bun\n',
      'bin/knowledge-mcp.js': '#!/usr/bin/env bun\n',
      'bin/knowledge-serve.js': '#!/usr/bin/env bun\n',
      'bin/knowledge-migrate.js': '#!/usr/bin/env bun\n',
    };
    const storageKitFiles = [
      'README.md',
      'health.ts',
      'index.ts',
      'migrations.ts',
      'mode.ts',
      'pool.ts',
      'query.ts',
      'tls.ts',
    ];
    for (const path of storageKitFiles) {
      files[`src/generated/storage-kit/${path}`] = `contained storage kit fixture: ${path}\n`;
    }
    files['src/generated/storage-kit/.storage-kit-manifest.json'] = `${JSON.stringify({
      generator: '@hasna/knowledge Stage-A compatibility build',
      kitVersion: '0.4.0',
      files: Object.fromEntries(storageKitFiles.map((path) => [
        path,
        `sha256:${sha256(files[`src/generated/storage-kit/${path}`])}`,
      ])),
    }, null, 2)}\n`;
    for (const [path, content] of Object.entries(files)) {
      const target = join(fixture, path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, content);
      chmodSync(target, path.startsWith('bin/') ? 0o755 : 0o644);
    }
    const packageFiles = Object.entries(files).filter(([path]) => path.startsWith('dist/') || path.startsWith('bin/'));
    const manifest = {
      version: 1,
      files: packageFiles.map(([path, content]) => ({
        path,
        sha256: sha256(content),
        mode: path.startsWith('bin/') ? 0o755 : 0o644,
      })),
      exact_roots: ['dist', 'bin'],
      exact_files: [],
    };
    writeFileSync(join(fixture, 'generated-artifacts.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const repositoryFiles = Object.entries(files)
      .filter(([path]) => path.startsWith('src/generated/'));
    writeFileSync(join(fixture, 'repository-generated-artifacts.json'), `${JSON.stringify({
      version: 1,
      files: repositoryFiles.map(([path, content]) => ({
        path,
        sha256: sha256(content),
        mode: 0o644,
      })),
      exact_roots: ['src/generated'],
      exact_files: [],
    }, null, 2)}\n`);

    try {
      expect(runGeneratedVerifier(fixture).exitCode).toBe(0);

      writeFileSync(join(fixture, 'dist', 'index.js'), 'mutated\n');
      expect(runGeneratedVerifier(fixture).exitCode).not.toBe(0);
      writeFileSync(join(fixture, 'dist', 'index.js'), files['dist/index.js']);

      rmSync(join(fixture, 'dist', 'index.d.ts'));
      expect(runGeneratedVerifier(fixture).exitCode).not.toBe(0);
      writeFileSync(join(fixture, 'dist', 'index.d.ts'), files['dist/index.d.ts']);

      writeFileSync(join(fixture, 'dist', 'untracked-generated.d.ts'), 'export {};\n');
      expect(runGeneratedVerifier(fixture).exitCode).not.toBe(0);
      rmSync(join(fixture, 'dist', 'untracked-generated.d.ts'));

      writeFileSync(join(fixture, 'src', 'generated', 'untracked-generated.ts'), 'export {};\n');
      expect(runGeneratedVerifier(fixture).exitCode).not.toBe(0);
      rmSync(join(fixture, 'src', 'generated', 'untracked-generated.ts'));

      writeFileSync(join(fixture, 'src', 'generated', 'storage-kit', 'health.ts'), 'mutated\n');
      expect(runGeneratedVerifier(fixture).exitCode).not.toBe(0);
      writeFileSync(
        join(fixture, 'src', 'generated', 'storage-kit', 'health.ts'),
        files['src/generated/storage-kit/health.ts'],
      );

      const omitted = manifest.files.find((entry) => entry.path === 'dist/serve.d.ts')!;
      manifest.files = manifest.files.filter((entry) => entry !== omitted);
      writeFileSync(join(fixture, 'generated-artifacts.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      expect(runGeneratedVerifier(fixture).exitCode).not.toBe(0);
      manifest.files.push(omitted);

      manifest.files.push({ path: 'dist/missing-extra.d.ts', sha256: sha256('missing'), mode: 0o644 });
      writeFileSync(join(fixture, 'generated-artifacts.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      expect(runGeneratedVerifier(fixture).exitCode).not.toBe(0);
      manifest.files.pop();

      manifest.exact_roots = [];
      writeFileSync(join(fixture, 'generated-artifacts.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      expect(runGeneratedVerifier(fixture).exitCode).not.toBe(0);
      manifest.exact_roots = ['dist', 'bin'];

      manifest.files.find((entry) => entry.path === 'dist/index.js')!.mode = 0o600;
      writeFileSync(join(fixture, 'generated-artifacts.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      expect(runGeneratedVerifier(fixture).exitCode).not.toBe(0);
      manifest.files.find((entry) => entry.path === 'dist/index.js')!.mode = 0o644;

      writeFileSync(join(fixture, 'dist', 'index.js'), 'const path = decodeURIComponent(url.pathname);\n');
      const staleContent = 'const path = decodeURIComponent(url.pathname);\n';
      manifest.files.find((entry) => entry.path === 'dist/index.js')!.sha256 = sha256(staleContent);
      writeFileSync(join(fixture, 'generated-artifacts.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      expect(runGeneratedVerifier(fixture).exitCode).not.toBe(0);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('built MCP launcher contains hosted mode before pg or MCP module evaluation', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-mcp-module-tripwire-'));
    const binDir = join(fixture, 'bin');
    mkdirSync(binDir, { recursive: true });
    cpSync(join(root, 'bin', 'knowledge-mcp.js'), join(binDir, 'knowledge-mcp.js'));
    chmodSync(join(binDir, 'knowledge-mcp.js'), 0o755);
    const tripwires = [
      ['pg', { '.': './tripwire.js' }],
      ['@modelcontextprotocol/sdk', {
        './server/mcp.js': './tripwire.js',
        './server/stdio.js': './tripwire.js',
        './server/streamableHttp.js': './tripwire.js',
      }],
    ] as const;
    for (const [name, exports] of tripwires) {
      const packageDir = join(fixture, 'node_modules', ...name.split('/'));
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ type: 'module', exports }));
      writeFileSync(join(packageDir, 'tripwire.js'), `throw new Error(${JSON.stringify(`${name} module tripwire`)});\n`);
    }
    try {
      const result = Bun.spawnSync(['bun', join(binDir, 'knowledge-mcp.js')], {
        cwd: fixture,
        env: sanitizedLocalTestEnv({
          HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted',
          HOME: join(fixture, 'home'),
          USERPROFILE: join(fixture, 'home'),
          BUN_CONFIG_INSTALL_AUTO: 'disable',
        }),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stderr = new TextDecoder().decode(result.stderr);
      expect(result.exitCode).toBe(1);
      expect(stderr).toContain('KNOWLEDGE_HOSTED_CONTAINED');
      expect(stderr).not.toContain('module tripwire');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('published generated files contain no private operator capability source or minting path', () => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'generated-artifacts.json'), 'utf8'),
    ) as { files: Array<{ path: string }> };
    const forbidden = /src\/operator-capability|createKnowledgeOperatorCapability|branded-operator-capability|knowledge-operator-capability/;
    for (const entry of manifest.files) {
      if (!entry.path.startsWith('dist/') && !entry.path.startsWith('bin/')) continue;
      expect(readFileSync(join(root, entry.path), 'utf8')).not.toMatch(forbidden);
    }
  });
});

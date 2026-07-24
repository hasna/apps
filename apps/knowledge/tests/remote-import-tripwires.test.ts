import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env';

const root = join(import.meta.dir, '..');

function regularFiles(path: string): string[] {
  const output: string[] = [];
  const visit = (current: string): void => {
    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current).sort()) visit(join(current, entry));
    } else if (stat.isFile()) {
      output.push(current);
    }
  };
  visit(path);
  return output;
}

describe('remote-capable dependency import tripwires', () => {
  test('source, dist, MCP payload, and every bin import without evaluating pg or AWS', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-remote-import-tripwire-'));
    const preload = join(fixture, 'preload.mjs');
    writeFileSync(preload, `
import { plugin } from 'bun';
plugin({
  name: 'knowledge-remote-evaluation-tripwire',
  setup(builder) {
    builder.onResolve({ filter: /^(?:pg|@aws-sdk\\/)/ }, ({ path }) => {
      throw new Error('REMOTE_DEPENDENCY_EVALUATED:' + path);
    });
  },
});
`);
    const imports = [
      'src/index.ts',
      'src/storage.ts',
      'src/serve.ts',
      'src/mcp-payload.js',
      'dist/index.js',
      'dist/storage.js',
      'dist/serve.js',
      'dist/mcp-payload.js',
      'bin/knowledge.js',
      'bin/knowledge-mcp.js',
      'bin/knowledge-serve.js',
      'bin/knowledge-migrate.js',
    ].map((path) => pathToFileURL(join(root, path)).href);
    try {
      const result = Bun.spawnSync([
        'bun',
        '--preload',
        preload,
        '--eval',
        `for (const url of ${JSON.stringify(imports)}) await import(url); console.log('IMPORTS_OK'); process.exit(0);`,
      ], {
        cwd: root,
        env: sanitizedLocalTestEnv({ BUN_CONFIG_INSTALL_AUTO: 'disable' }),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);
      expect(stderr).not.toContain('REMOTE_DEPENDENCY_EVALUATED');
      expect(result.exitCode, stderr).toBe(0);
      expect(stdout).toContain('IMPORTS_OK');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('source and committed imports perform zero fetch, client, database, or workspace activity', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-import-zero-activity-'));
    const preload = join(fixture, 'preload.mjs');
    const activityMarker = join(fixture, 'runtime-activity');
    const isolatedHome = join(fixture, 'home');
    writeFileSync(preload, `
import { appendFileSync } from 'node:fs';
import { plugin } from 'bun';
const mark = (kind) => appendFileSync(process.env.KNOWLEDGE_IMPORT_ACTIVITY_TRIPWIRE, kind + '\\n');
globalThis.fetch = () => { mark('fetch'); throw new Error('fetch tripwire'); };
plugin({
  name: 'knowledge-import-zero-activity',
  setup(builder) {
    builder.onResolve({ filter: /^(?:pg|@aws-sdk\\/|@ai-sdk\\/|ai$)/ }, ({ path }) => {
      throw new Error('PROVIDER_CLIENT_EVALUATED:' + path);
    });
    builder.onResolve({ filter: /^bun:sqlite$/ }, () => ({
      path: 'contained-sqlite',
      namespace: 'knowledge-import-tripwire',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'knowledge-import-tripwire' }, () => ({
      loader: 'js',
      contents: \`import { appendFileSync } from 'node:fs';
export class Database {
  constructor() {
    appendFileSync(process.env.KNOWLEDGE_IMPORT_ACTIVITY_TRIPWIRE, 'database\\n');
    throw new Error('database construction tripwire');
  }
}\`,
    }));
  },
});
`);
    const imports = [
      'src/index.ts',
      'src/storage.ts',
      'src/serve.ts',
      'src/mcp-payload.js',
      'dist/index.js',
      'dist/storage.js',
      'dist/serve.js',
      'dist/mcp-payload.js',
    ].map((path) => pathToFileURL(join(root, path)).href);
    try {
      const result = Bun.spawnSync([
        'bun',
        '--preload',
        preload,
        '--eval',
        `for (const url of ${JSON.stringify(imports)}) await import(url); console.log('ZERO_ACTIVITY_IMPORTS_OK');`,
      ], {
        cwd: fixture,
        env: sanitizedLocalTestEnv({
          BUN_CONFIG_INSTALL_AUTO: 'disable',
          HOME: isolatedHome,
          USERPROFILE: isolatedHome,
          KNOWLEDGE_IMPORT_ACTIVITY_TRIPWIRE: activityMarker,
        }),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);
      expect(result.exitCode, stderr).toBe(0);
      expect(stdout).toContain('ZERO_ACTIVITY_IMPORTS_OK');
      expect(stderr).not.toContain('PROVIDER_CLIENT_EVALUATED');
      expect(existsSync(activityMarker)).toBe(false);
      expect(existsSync(join(fixture, '.hasna'))).toBe(false);
      expect(existsSync(join(isolatedHome, '.hasna'))).toBe(false);
      const runtimeCache = join(isolatedHome, '.bun', 'install', 'cache');
      expect(regularFiles(fixture).filter((file) => file !== preload && !file.startsWith(runtimeCache)))
        .toEqual([]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('published bundles contain no runtime remote edges while declarations retain base type-only imports', () => {
    for (const file of regularFiles(join(root, 'dist'))) {
      const text = readFileSync(file, 'utf8');
      if (file.endsWith('.d.ts')) {
        expect(text).not.toMatch(/^import(?!\s+type\b).*['"](?:pg|@aws-sdk\/)/m);
        continue;
      }
      expect(text).not.toMatch(/(?:from\s*|import\s*\()\s*['"](?:pg|@aws-sdk\/)/);
      expect(text).not.toMatch(
        /(?:from\s*|import\s*\()\s*['"][^'"]*(?:db\/(?:pg-migrations|remote-storage|storage-sync)|generated\/storage-kit)/,
      );
    }
    for (const file of regularFiles(join(root, 'bin'))) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/(?:from\s*|import\s*\()\s*['"](?:pg|@aws-sdk\/)/);
    }
  });
});

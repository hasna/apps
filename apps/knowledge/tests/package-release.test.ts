/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as builtPackageRoot from '../dist/index.js';
import { budget } from './support/budget';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  files: string[];
  scripts: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const publicDocs = [
  'docs/architecture/ai-native-knowledge-base.md',
  'docs/architecture/hosted-wrapper-responsibilities.md',
  'docs/architecture/hybrid-semantic-search.md',
  'docs/architecture/machine-sync-schema.md',
  'docs/examples/app-project-wiki-standard.md',
  'docs/examples/company-wiki-workflow.md',
  'docs/migration/global-rules-provenance-import.md',
  'docs/migration/json-to-sqlite.md',
].sort();

const publicScripts = [
  'scripts/apply-postgres-migrations.mjs',
  'scripts/live-private-query.mjs',
  // Imported by scripts/smoke-machine-sync-release.mjs, so it must ship with it or the
  // published script fails to resolve at runtime.
  'scripts/lib/remote-temp-dir.mjs',
  'scripts/smoke-machine-sync-release.mjs',
  'scripts/smoke-machines-adapter.mjs',
  'scripts/smoke-files-installed-boundary.mjs',
  'scripts/strip-generated-trailing-whitespace.mjs',
  'scripts/verify-generated-artifacts.mjs',
].sort();

const forbiddenPackagePaths = [
  'docs/canonical-secrets-bootstrap-2026-06-08.md',
  'scripts/validate-public-package.mjs',
].sort();

const rootRuntimeExports = builtPackageRoot as Record<string, unknown>;

function declarationExportsIdentifier(source: string, identifier: string): boolean {
  return new RegExp(`\\bexport\\s+(?:declare\\s+)?(?:function|const|class|interface|type)\\s+${identifier}\\b`).test(source)
    || new RegExp(`\\bexport\\s*\\{[^}]*\\b${identifier}\\b`, 's').test(source);
}

describe('public package release safety', () => {
  test('declaration generation uses the exact package-local TypeScript compiler', () => {
    const typescriptVersion = packageJson.devDependencies?.typescript;
    expect(typescriptVersion).toMatch(/^\d+\.\d+\.\d+$/);

    const lockfile = readFileSync(join(repoRoot, 'bun.lock'), 'utf8');
    expect(lockfile).toContain(`\"typescript\": \"${typescriptVersion}\"`);
    expect(lockfile).toContain(`typescript@${typescriptVersion}`);

    expect(packageJson.scripts.build).toContain('bun run tsc -p tsconfig.build.json');
    expect(packageJson.scripts.build).not.toContain('bunx tsc');
  });

  // Node's builtin list, hardcoded on purpose. `builtinModules` under `bun test` returns BUN's
  // list, which includes `ws`, `undici` and `bun` - real npm package names that are NOT Node
  // builtins, so using it would bless imports that throw for every node installer.
  const NODE_BUILTINS = new Set([
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
    'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
    'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
    'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls', 'trace_events',
    'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
  ]);

  /** Does the published package ship this repo-relative path? */
  const isShippedPath = (repoRelativePath: string): boolean => {
    // npm always includes package.json regardless of `files`, and a version string read from
    // it is an ordinary thing for a published script to do.
    if (repoRelativePath === 'package.json') return true;
    const shipped = (packageJson as unknown as { files?: string[] }).files ?? [];
    return shipped.some((entry) => {
      const normalized = entry.replace(/\/+$/, '');
      return repoRelativePath === normalized || repoRelativePath.startsWith(`${normalized}/`);
    });
  };

  // Pre-existing breakage, each verified against a packed tarball and tracked in todos.
  // Every entry must be removed by its task; removing one and not the others leaves the
  // published script still throwing, so they are listed individually.
  const knownUnresolvedImports = new Set([
    // task 1eb481d5 - src/ is not in `files`
    // task 104f993d - bun:sqlite throws ERR_UNSUPPORTED_ESM_URL_SCHEME under node
    'scripts/smoke-files-installed-boundary.mjs -> bun:sqlite',
  ]);

  test('package files list public docs explicitly', () => {
    expect(packageJson.files).not.toContain('docs');
    expect(packageJson.files).not.toContain('docs/*');
    expect(packageJson.files).not.toContain('docs/**');
    expect(packageJson.files).not.toContain('scripts');
    expect(packageJson.files).not.toContain('scripts/*');
    expect(packageJson.files).not.toContain('scripts/**');

    for (const doc of publicDocs) {
      expect(packageJson.files).toContain(doc);
    }

    for (const script of publicScripts) {
      expect(packageJson.files).toContain(script);
    }

    for (const path of forbiddenPackagePaths) {
      expect(packageJson.files).not.toContain(path);
    }
  });

  test('guarded private transport declarations match the runtime export contract', () => {
    const rootDeclaration = readFileSync(join(repoRoot, 'dist/index.d.ts'), 'utf8');
    const guardedContractDeclaration = readFileSync(join(repoRoot, 'dist/guarded-write-contract.d.ts'), 'utf8');

    expect(rootRuntimeExports.createKnowledgePrivateInputDescriptor).toBeFunction();
    expect(declarationExportsIdentifier(rootDeclaration, 'createKnowledgePrivateInputDescriptor')).toBe(true);
    expect(declarationExportsIdentifier(guardedContractDeclaration, 'createKnowledgePrivateInputDescriptor')).toBe(true);

    expect(rootRuntimeExports.createKnowledgePrivateTitleLookupDescriptor).toBeFunction();
    expect(declarationExportsIdentifier(rootDeclaration, 'createKnowledgePrivateTitleLookupDescriptor')).toBe(true);
    expect(declarationExportsIdentifier(guardedContractDeclaration, 'createKnowledgePrivateTitleLookupDescriptor')).toBe(true);
    expect(rootRuntimeExports.createKnowledgePrivateQueryDescriptor).toBeFunction();
    expect(declarationExportsIdentifier(rootDeclaration, 'createKnowledgePrivateQueryDescriptor')).toBe(true);
    expect(declarationExportsIdentifier(guardedContractDeclaration, 'createKnowledgePrivateQueryDescriptor')).toBe(true);
    expect(rootRuntimeExports.inspectKnowledgePrivateResult).toBeFunction();
    expect(declarationExportsIdentifier(rootDeclaration, 'inspectKnowledgePrivateResult')).toBe(true);
    expect(declarationExportsIdentifier(guardedContractDeclaration, 'inspectKnowledgePrivateResult')).toBe(true);
    expect(rootRuntimeExports.executeKnowledgeGuardedCliWrite).toBeFunction();
    expect(declarationExportsIdentifier(rootDeclaration, 'executeKnowledgeGuardedCliWrite')).toBe(true);
    expect(rootRuntimeExports.executeKnowledgeGuardedCliQuery).toBeFunction();
    expect(declarationExportsIdentifier(rootDeclaration, 'executeKnowledgeGuardedCliQuery')).toBe(true);
    expect(rootRuntimeExports.executeKnowledgeGuardedCliReadback).toBeFunction();
    expect(declarationExportsIdentifier(rootDeclaration, 'executeKnowledgeGuardedCliReadback')).toBe(true);
    expect(rootRuntimeExports.runKnowledgeGuardedCliDescriptorWorker).toBeUndefined();
    expect(declarationExportsIdentifier(rootDeclaration, 'runKnowledgeGuardedCliDescriptorWorker')).toBe(false);
    expect(rootRuntimeExports.runKnowledgeGuardedCliIpcWorker).toBeUndefined();
    expect(declarationExportsIdentifier(rootDeclaration, 'runKnowledgeGuardedCliIpcWorker')).toBe(false);

    expect(rootRuntimeExports.materializeKnowledgePrivateInput).toBeUndefined();
    expect(declarationExportsIdentifier(rootDeclaration, 'materializeKnowledgePrivateInput')).toBe(false);
    expect(declarationExportsIdentifier(guardedContractDeclaration, 'materializeKnowledgePrivateInput')).toBe(false);
    expect(rootRuntimeExports.materializeKnowledgePrivateTitleLookup).toBeUndefined();
    expect(declarationExportsIdentifier(rootDeclaration, 'materializeKnowledgePrivateTitleLookup')).toBe(false);
    expect(declarationExportsIdentifier(guardedContractDeclaration, 'materializeKnowledgePrivateTitleLookup')).toBe(false);
    expect(rootRuntimeExports.materializeKnowledgePrivateQuery).toBeUndefined();
    expect(declarationExportsIdentifier(rootDeclaration, 'materializeKnowledgePrivateQuery')).toBe(false);
    expect(declarationExportsIdentifier(guardedContractDeclaration, 'materializeKnowledgePrivateQuery')).toBe(false);
    expect(rootRuntimeExports.createKnowledgePrivateResultDescriptor).toBeUndefined();
    expect(declarationExportsIdentifier(rootDeclaration, 'createKnowledgePrivateResultDescriptor')).toBe(false);
    expect(declarationExportsIdentifier(guardedContractDeclaration, 'createKnowledgePrivateResultDescriptor')).toBe(false);
  });

  /**
   * Imports of a published script that would NOT resolve for someone who installed the
   * package. Returns the offending specifiers, so both the enforcement test and the tests
   * that pin it call THIS function - if it stops reporting, both fail.
   *
   * That structure is the point. Three previous versions of this check could each be replaced
   * with something that reports nothing while the whole suite stayed green, because the tests
   * that were supposed to pin them exercised a private copy of the logic instead of the logic
   * itself. Silent-green was the defect; moving the implementation never fixed it.
   *
   * Scope limit, stated rather than implied by the name: the transpiler reports `import`,
   * `import()` and `export … from`. It does NOT report `require()`, `import.meta.resolve()`,
   * or `new URL('./x', import.meta.url)`. No published script uses those today, and the last
   * is the plausible one to appear, since it is how you reference a sibling that must be in
   * `files`. A file the transpiler cannot parse throws, so that path is loud, not silent.
   *
   * Imports are extracted with the real transpiler, NOT by stripping comments and matching a
   * regex. Two hand-written strippers were tried and both had the same defect: a `/*` inside
   * an ordinary string opened a phantom comment and silently deleted real imports. The second
   * only moved the trigger - a regex literal containing a quote (`/['"]/`) shifted it into
   * string state and everything after it vanished. Extracting imports is a parsing problem;
   * anything short of a parser is a guess that fails silently.
   */
  function unresolvableImportsIn(script: string, source: string): string[] {
    const transpiler = new Bun.Transpiler({ loader: 'ts' });
    const runtimeDeps = new Set(Object.keys(
      (packageJson as unknown as { dependencies?: Record<string, string> }).dependencies ?? {},
    ));

    /**
     * Only `node:`-prefixed builtins are unconditionally resolvable.
     *
     * Deliberately NOT allowed, each verified against this repo rather than assumed:
     *  - unprefixed builtins. `builtinModules` under `bun test` is BUN's list, which contains
     *    `ws`, `undici` and `bun` - real npm package names that are NOT Node builtins, so a
     *    published script importing `ws` would pass here and throw for every node installer.
     *  - the package's own name. No published script imports it; that allowance existed only
     *    to mask a phantom the old regex stripper invented from a template literal, which a
     *    real parser does not report at all.
     *  - `#`-prefixed subpaths. package.json has no `imports` map, so every one is guaranteed
     *    to fail with ERR_PACKAGE_IMPORT_NOT_DEFINED.
     *  - `bun:` builtins. They resolve under Bun and throw ERR_UNSUPPORTED_ESM_URL_SCHEME
     *    under node, so they are exempted by name below, never blessed as a class.
     */
    // `node:`-prefixed builtins, unprefixed NODE builtins, and self-reference through the
    // package's own `exports` map all resolve from a real install - each verified against an
    // extracted tarball under node, not assumed. Deleting these outright was a false positive:
    // `import { sep } from 'path'` and `@hasna/knowledge/storage` both resolve.
    //
    // Still NOT allowed, also verified: `@hasna/knowledge/<undeclared>`
    // (ERR_PACKAGE_PATH_NOT_EXPORTED), `#`-prefixed (ERR_PACKAGE_IMPORT_NOT_DEFINED, no
    // `imports` map), and `ws`/`undici`/`bun` (ERR_MODULE_NOT_FOUND - they are in BUN's
    // builtinModules, not Node's, which is why NODE_BUILTINS is hardcoded).
    const exportsMap = (packageJson as unknown as { exports?: Record<string, unknown> }).exports ?? {};
    const ownName = (packageJson as unknown as { name?: string }).name ?? '';
    const exportedSubpaths = new Set(
      Object.keys(exportsMap).map((key) => (key === '.' ? ownName : `${ownName}/${key.replace(/^\.\//, '')}`)),
    );

    const isAlwaysResolvable = (specifier: string): boolean => {
      if (specifier.startsWith('node:')) return true;
      if (NODE_BUILTINS.has(specifier)) return true;
      return ownName !== '' && exportedSubpaths.has(specifier);
    };

    const unresolvable: string[] = [];
    for (const { path: specifier } of transpiler.scan(source).imports) {
      if (knownUnresolvedImports.has(`${script} -> ${specifier}`)) continue;
      if (isAlwaysResolvable(specifier)) continue;

      if (specifier.startsWith('.')) {
        const resolved = posix.normalize(posix.join(posix.dirname(script), specifier));
        // Checked against everything the package SHIPS, not just the scripts allowlist:
        // `../package.json` and `../dist/index.js` are published and resolve from a real
        // install, and both were reported as breakage by the scripts-only check.
        if (!isShippedPath(resolved)) unresolvable.push(specifier);
        continue;
      }

      const pkg = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      if (!runtimeDeps.has(pkg)) unresolvable.push(specifier);
    }
    return unresolvable;
  }

  /**
   * A published script that imports something the package does not ship resolves fine in the
   * repo and throws ERR_MODULE_NOT_FOUND for everyone who installs it. The allowlists above
   * only catch the opposite mistake (shipping something unreviewed), so this closes the gap.
   */
  test('every import in a published script resolves from the published package', () => {
    for (const script of publicScripts) {
      const source = readFileSync(join(repoRoot, script), 'utf8');
      expect(unresolvableImportsIn(script, source), `unresolvable imports in ${script}`).toEqual([]);
    }
  });

  /**
   * Pins the function above against the mutation that kept slipping through: every previous
   * version could be replaced with something that reports nothing while the suite stayed
   * green. Each case below drives the REAL function, so disabling the extractor, widening the
   * exemptions, or making everything "always resolvable" fails here.
   */
  test('the published-import check reports real breakage, in every shape', () => {
    const check = (source: string) => unresolvableImportsIn('scripts/probe.mjs', source);

    // The two shapes that defeated both hand-written strippers.
    expect(check(`const g = '**/*.ts';\nimport bad from 'ghost-a';`)).toContain('ghost-a');
    expect(check(`const q = /['"]/g;\nconst g = '**/*.json';\nconst m = import('ghost-b');`)).toContain('ghost-b');
    expect(check(`const re = /[a\\/*]/;\nimport bad from 'ghost-c';`)).toContain('ghost-c');
    // Every import form the check claims to cover.
    expect(check(`import './not-shipped.mjs';`)).toContain('./not-shipped.mjs');
    expect(check(`export { a } from './not-shipped2.mjs';`)).toContain('./not-shipped2.mjs');
    expect(check(`export * from './not-shipped3.mjs';`)).toContain('./not-shipped3.mjs');
    expect(check(`const m = await import('ghost-d');`)).toContain('ghost-d');
    // The allowances are exactly as narrow as documented.
    expect(check(`import x from 'ws';`)).toContain('ws');
    expect(check(`import x from 'undici';`)).toContain('undici');
    expect(check(`import x from '#internal/x.js';`)).toContain('#internal/x.js');
    expect(check(`import x from '@hasna/knowledge/not-in-exports';`)).toContain('@hasna/knowledge/not-in-exports');
    expect(check(`import { Database } from 'bun:sqlite';`)).toContain('bun:sqlite');

    // ...and legitimate code is not reported, or the check false-positives and gets widened.
    // Every entry below was verified to RESOLVE from an extracted tarball under node.
    expect(check(`import { readFileSync } from 'node:fs';`)).toEqual([]);
    expect(check(`import { z } from 'zod';`)).toEqual([]);
    // Unprefixed Node builtins resolve; nothing in this repo forces the node: prefix.
    expect(check(`import { sep } from 'path';`)).toEqual([]);
    expect(check(`import { readFileSync as r } from 'fs';`)).toEqual([]);
    expect(check(`import { spawnSync } from 'child_process';`)).toEqual([]);
    // Self-reference resolves for subpaths the exports map declares - and only those.
    expect(check(`import x from '@hasna/knowledge';`)).toEqual([]);
    expect(check(`import x from '@hasna/knowledge/storage';`)).toEqual([]);
    // Shipped non-script files are published and resolve.
    expect(check(`import pkg from '../package.json' with { type: 'json' };`)).toEqual([]);
    expect(check(`// import dead from 'ghost-e';`)).toEqual([]);
    expect(check(`/* import dead from 'ghost-f'; */`)).toEqual([]);
    expect(check(`const s = "import x from 'ghost-g'";`)).toEqual([]);
    // A child script emitted as a template literal is data, not an import of this file.
    expect(check("const child = `import { k } from '@hasna/knowledge';`;")).toEqual([]);
  });

  test('the exemptions stay narrow, and each names real breakage', () => {
    const transpiler = new Bun.Transpiler({ loader: 'ts' });
    const importsOf = (script: string) =>
      transpiler.scan(readFileSync(join(repoRoot, script), 'utf8')).imports.map((i) => i.path);

    // Each exempted import must still exist; a stale exemption invites the next one to be
    // added without evidence. The migrate script composes the migration program through
    // the shared builder in dist/serve.js; @hasna/contracts/auth is imported at runtime by
    // the BUILT bundle (the build keeps @hasna/contracts external), so the dependency
    // assertion below checks the bundle rather than the script.
    expect(importsOf('scripts/apply-postgres-migrations.mjs')).toContain('../dist/serve.js');
    expect(readFileSync(join(repoRoot, 'dist/serve.js'), 'utf8')).toContain('@hasna/contracts/auth');
    expect(importsOf('scripts/smoke-files-installed-boundary.mjs')).toContain('bun:sqlite');

    // ...and each is genuinely unresolvable, not merely unfamiliar.
    expect(packageJson.files).not.toContain('src');
    const deps = (packageJson as unknown as { dependencies?: Record<string, string> }).dependencies ?? {};
    // The published scripts import @hasna/contracts/auth at runtime (serve/migrations),
    // so it must be a declared runtime dependency, never a dev-only exemption.
    expect(Object.keys(deps)).toContain('@hasna/contracts');

    // Derived from the Set, never restated. A hardcoded copy meant ADDING an exemption was
    // pinned by nothing: a genuinely broken import plus a matching entry left the file green.
    expect(knownUnresolvedImports.size).toBeGreaterThan(0);
    for (const key of [...knownUnresolvedImports]) {
      const separator = key.indexOf(' -> ');
      const script = key.slice(0, separator);
      const specifier = key.slice(separator + 4);
      // Every exemption must name a script that is actually published...
      expect(publicScripts, `exemption names an unpublished script: ${key}`).toContain(script);
      knownUnresolvedImports.delete(key);
      try {
        expect(unresolvableImportsIn(script, readFileSync(join(repoRoot, script), 'utf8')))
          .toContain(specifier);
      } finally {
        knownUnresolvedImports.add(key);
      }
    }
  });

  test('the published serve entry imports under Node', () => {
    const result = spawnSync(
      'node',
      ['--input-type=module', '--eval', "await import('./dist/serve.js')"],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      },
    );

    expect(
      {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      },
    ).toEqual({
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
    });
  });

  test('npm pack dry-run includes only public docs', () => {
    const result = spawnSync('node', ['scripts/validate-public-package.mjs', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });

    if (result.status !== 0) {
      throw new Error(`public package validation failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }

    const summary = JSON.parse(result.stdout) as {
      ok: boolean;
      docsFiles: string[];
      scriptsFiles: string[];
      forbiddenPackagePaths: string[];
    };

    expect(summary.ok).toBe(true);
    expect(summary.docsFiles).toEqual(publicDocs);
    expect(summary.scriptsFiles).toEqual(publicScripts);
    expect(summary.forbiddenPackagePaths).toEqual(forbiddenPackagePaths);
    for (const path of forbiddenPackagePaths) {
      expect(summary.docsFiles).not.toContain(path);
      expect(summary.scriptsFiles).not.toContain(path);
    }
  }, budget(15_000));
});

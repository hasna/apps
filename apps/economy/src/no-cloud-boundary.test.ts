import { describe, test, expect } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Regression guard for the `no_cloud_guard` contract rule.
 *
 * `@hasna/cloud` is retired and unsupported (owner ruling 2026-07-26): the repo is
 * deleted and will not be restored, so any dependency on it is a broken build
 * waiting to happen as well as a contract breach. In economy it was previously
 * wired into the SQLite adapter (`src/db/sqlite-adapter.ts` now owns that), the
 * SQLite->Postgres translator (`src/db/dialect.ts`), the PG migration runner
 * (`src/db/pg-migrate.ts`), and three sync MCP tools that were deleted outright.
 *
 * The scan deliberately covers BUILT OUTPUT as well as source. `bun build` runs
 * with `--packages external`, so an unremoved import survives into `dist/` as a
 * live module specifier — a compiled artifact can carry the edge even when
 * tracked source looks clean.
 */
const FORBIDDEN_PACKAGE = '@hasna/cloud'

/**
 * Matches the package as a module specifier in every import form —
 * `from "x"`, `import "x"`, `import("x")`, `require("x")` — including deep imports
 * like `x/dist/adapter.js`. Matching specifiers rather than bare mentions means
 * prose explaining the removal (and the frozen roadmap in
 * `src/cli/commands/todos.ts`) does not trip the guard.
 */
const FORBIDDEN_IMPORT = new RegExp(
  String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)` +
    String.raw`["']${FORBIDDEN_PACKAGE}(?:/[^"']*)?["']`,
)

/** Every package.json field that can pull a package into an install. */
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'bundleDependencies',
  'bundledDependencies',
  'overrides',
  'resolutions',
  'trustedDependencies',
]

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const selfPath = fileURLToPath(import.meta.url)

/** Only ever skipped: never our own code, and enormous. */
const SKIP_DIRS = new Set(['node_modules', '.git'])
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/

/**
 * Roots to scan: everything `package.json` ships (so `dist/` is covered whenever a
 * build has run), plus the source and tooling trees that produce it. Driven off
 * `files` so adding a shipped directory extends this guard automatically instead
 * of silently escaping it.
 */
function scanRoots(): string[] {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { files?: string[] }
  const roots = new Set<string>([...(pkg.files ?? []), 'src', 'scripts', 'sdk'])
  return [...roots]
    .map((entry) => join(repoRoot, entry.replace(/\/+$/, '')))
    .filter((path) => existsSync(path) && statSync(path).isDirectory())
}

function walk(dir: string, match: (name: string) => boolean, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, match, out)
    } else if (match(entry.name) && fullPath !== selfPath) {
      out.push(fullPath)
    }
  }
  return out
}

function collect(match: (name: string) => boolean): string[] {
  const seen = new Set<string>()
  for (const root of scanRoots()) {
    for (const file of walk(root, match, [])) seen.add(file)
  }
  return [...seen]
}

describe('no_cloud_guard boundary', () => {
  test('no package.json in the shipped tree depends on the retired package', () => {
    const manifests = [join(repoRoot, 'package.json'), ...collect((name) => name === 'package.json')]

    const offenders = manifests.flatMap((file) => {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      return DEPENDENCY_SECTIONS.filter((section) => {
        const value = pkg[section]
        // Most sections are objects keyed by package name; bundleDependencies is an array.
        if (Array.isArray(value)) return value.includes(FORBIDDEN_PACKAGE)
        return typeof value === 'object' && value !== null && FORBIDDEN_PACKAGE in value
      }).map((section) => `${relative(repoRoot, file)}:${section}`)
    })

    expect(offenders).toEqual([])
  })

  test('no shipped source or built file imports the retired package', () => {
    const offenders = collect((name) => SOURCE_EXTENSIONS.test(name))
      .filter((file) => FORBIDDEN_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repoRoot, file))

    expect(offenders).toEqual([])
  })

  test('the lockfile does not resolve the retired package, directly or transitively', () => {
    const lockfile = join(repoRoot, 'bun.lock')
    if (!existsSync(lockfile)) return

    expect(readFileSync(lockfile, 'utf8')).not.toContain(FORBIDDEN_PACKAGE)
  })

  test('the CLI and MCP server register no retired cloud-sync surface', () => {
    // Deliberately NOT "PgAdapter": economy's own worker-backed `SyncPgAdapter`
    // contains that substring and is the live self-hosted Postgres client.
    const forbiddenSymbols = [
      'registerCloudTools',
      'registerCloudCommands',
      'incrementalSyncPush',
      'incrementalSyncPull',
      'registerSyncSchedule',
    ]
    const checkedFiles = ['src/cli/index.ts', 'src/mcp/server.ts']

    const offenders = checkedFiles.flatMap((file) => {
      const content = readFileSync(join(repoRoot, file), 'utf8')
      return forbiddenSymbols.filter((symbol) => content.includes(symbol)).map((symbol) => `${file}:${symbol}`)
    })

    expect(offenders).toEqual([])
  })
})

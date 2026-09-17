import { describe, test, expect } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Ratchet for the fail-closed ruling (owner directive 2026-09-04, hasna/apps#1720,
 * fleet-alignment ruling d 2026-09-11): the CLIENT bundles must not carry the
 * on-box SQLite lane at all.
 *
 * `economy` (dist/cli), `economy-mcp` (dist/mcp) and the `./sdk` entry
 * (dist/index.js) reach `bun:sqlite` only through a gated dynamic import, which
 * `--splitting` emits into `dist/chunks/`. A hosted station therefore cannot
 * load a SQLite engine to serve data, and a reviewer can verify it with one
 * grep. `economy-serve` and `economy-otel` are the server-side bins that own
 * the on-box backend and are deliberately NOT covered.
 *
 * Two sides:
 *  1. SOURCE — only the three designated leaf modules may import `bun:sqlite`
 *     as a value. Anything else re-introduces it into whichever bundle imports
 *     it statically.
 *  2. BUILT OUTPUT — when `dist/` exists (CI builds before it tests), the
 *     client bundles are grepped directly.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const selfPath = fileURLToPath(import.meta.url)

/** The only modules allowed to name `bun:sqlite` in a value import. */
const SQLITE_LEAF_MODULES = [
  'src/db/sqlite-adapter.ts',
  'src/db/third-party-sqlite.ts',
  'src/mcp/agent-registry-store.ts',
]

/**
 * Does this file import `bun:sqlite` as a VALUE?
 *
 * `import type` is erased by the bundler and does not count; comment lines
 * (which document the rule in several collectors) do not count either.
 */
function importsBunSqliteAsValue(source: string): boolean {
  return source.split('\n').some((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false
    if (!/["']bun:sqlite["']/.test(trimmed)) return false
    return !/\bimport\s+type\b/.test(trimmed)
  })
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      sourceFiles(full, out)
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') && full !== selfPath) {
      out.push(full)
    }
  }
  return out
}

describe('bun:sqlite never reaches the client bundles', () => {
  test('only the designated leaf modules import bun:sqlite as a value', () => {
    const offenders = sourceFiles(join(repoRoot, 'src'))
      .filter((file) => importsBunSqliteAsValue(readFileSync(file, 'utf8')))
      .map((file) => relative(repoRoot, file))
      .sort()

    expect(offenders).toEqual(SQLITE_LEAF_MODULES.slice().sort())
  })

  test('the built CLI, MCP and sdk bundles carry no bun:sqlite reference', () => {
    const bundles = ['dist/cli/index.js', 'dist/mcp/index.js', 'dist/index.js']
      .map((rel) => join(repoRoot, rel))
      .filter((path) => existsSync(path))
    if (bundles.length === 0) return // not built in this working tree

    const offenders = bundles
      .filter((path) => readFileSync(path, 'utf8').includes('bun:sqlite'))
      .map((path) => relative(repoRoot, path))

    expect(offenders).toEqual([])
  })

  test('the SQLite code is emitted outside dist/cli and dist/mcp', () => {
    const cliDir = join(repoRoot, 'dist', 'cli')
    if (!existsSync(cliDir)) return // not built in this working tree

    const offenders: string[] = []
    for (const dir of [cliDir, join(repoRoot, 'dist', 'mcp')]) {
      if (!existsSync(dir)) continue
      for (const file of sourceJs(dir)) {
        if (readFileSync(file, 'utf8').includes('bun:sqlite')) offenders.push(relative(repoRoot, file))
      }
    }
    expect(offenders).toEqual([])
  })
})

function sourceJs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceJs(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

/**
 * Regression for the publish-guard TS2307 class (todos 029ceb00): the
 * economy prepack build's tsc step type-checks src/lib/open-projects.ts,
 * whose dynamic import of the OPTIONAL @hasna/projects SDK must resolve
 * without the workspace member's built dist existing. In a fresh checkout
 * apps/projects/dist is gitignored and absent — and the publish-guard packs
 * members by readdir order, so economy can be packed before projects — a
 * literal `import('@hasna/projects')` specifier fails tsc with TS2307 at
 * every PR head and on main itself, blocking the whole merge queue.
 *
 * The module is an optional runtime integration (loaded dynamically, its
 * value cast to the local OpenProject shape), so the import is expressed
 * with a non-literal specifier that TypeScript resolves at runtime only.
 * This test runs tsc on exactly the failing module with the member's
 * tsconfig compiler options and asserts exit 0.
 *
 * Two-sided: whenever apps/projects/dist is absent (the fresh-checkout gate
 * context, and the condition under which the defect was red), the literal
 * specifier fails this check with TS2307 and the non-literal specifier
 * passes. Runtime behavior of the registry sync is covered by
 * src/lib/open-projects.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ECONOMY_ROOT = path.resolve(import.meta.dir, '..', '..')

const TSC_ENTRY = path.join(ECONOMY_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

function runTscOnOpenProjects(): { rc: number; out: string } {
  if (!fs.existsSync(TSC_ENTRY)) {
    throw new Error(`typescript not installed in apps/economy: ${TSC_ENTRY}`)
  }
  // Mirror apps/economy/tsconfig.json compilerOptions (the prepack tsc
  // resolution context), single-file scope so the check is fast and names
  // exactly the module under regression.
  const args = [
    TSC_ENTRY,
    '--noEmit',
    '--target', 'ES2022',
    '--module', 'ES2022',
    '--moduleResolution', 'bundler',
    '--strict',
    '--esModuleInterop',
    '--skipLibCheck',
    '--forceConsistentCasingInFileNames',
    '--resolveJsonModule',
    '--isolatedModules',
    '--noUncheckedIndexedAccess',
    '--noUnusedLocals',
    '--noUnusedParameters',
    '--types', 'bun-types',
    'src/lib/open-projects.ts',
  ]
  try {
    const out = execFileSync(process.execPath, args, {
      cwd: ECONOMY_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { rc: 0, out }
  } catch (e: any) {
    const out = String(e?.stdout ?? '') + String(e?.stderr ?? '')
    return { rc: typeof e?.status === 'number' ? e.status : 1, out }
  }
}

describe('open-projects prepack typecheck (publish-guard regression, 029ceb00)', () => {
  test('open-projects.ts type-checks with @hasna/projects as an optional runtime module', () => {
    const { rc, out } = runTscOnOpenProjects()
    expect(rc, `tsc on src/lib/open-projects.ts failed (rc=${rc}):\n${out}`).toBe(0)
  })
})

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Regression guard for the published-artifact gate wiring.
 *
 * The `prepack` hook runs on every `bun pack` / `npm publish`, so a malformed
 * script is a broken publish path, not a broken test path. The gate was first
 * wired as `"artifact-scan": "contracts artifact-scan"` with no target; the
 * contract CLI requires a target argument and exits rc=1 without one, so the
 * very gate meant to protect the publish would have hard-failed every publish.
 * This test locks the wiring to the form that actually runs: a target for the
 * scan and a build before it, so the scanned directory exists.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function packageJson(): { scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
}

describe('published artifact gate', () => {
  test('prepack runs the artifact scan after a build', () => {
    const prepack = packageJson().scripts?.['prepack'] ?? ''
    expect(prepack).toContain('bun run build')
    expect(prepack).toContain('bun run artifact-scan')
  })

  test('artifact-scan names a target directory', () => {
    const scan = packageJson().scripts?.['artifact-scan'] ?? ''
    expect(scan).toMatch(/artifact-scan\s+\S+/)
  })
})

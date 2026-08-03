import { describe, test, expect } from 'bun:test'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Regression guard for the `hasna.contract.json` storage declaration.
 *
 * `@hasna/contracts` 0.9.0 REMOVED the `storage.mode` enum (`local` | `cloud`)
 * and replaced it with a required `storage.backend` (`sqlite` | `postgresql`),
 * per the owner directive that deleted deployment modes. The storage object is
 * `additionalProperties: false`, so a manifest that still declares `mode` is not
 * merely stale — it is INVALID on arrival and every consumer of the manifest
 * rejects it.
 *
 * Nothing else in this repo reads `hasna.contract.json`: no test, no build step,
 * and no CI job. That is precisely why the declaration was free to drift out of
 * sync with the pinned contract kit. This test closes that gap.
 *
 * Scope is deliberately narrow — it asserts that the manifest raises NO
 * storage-scoped validation issue, rather than that the whole manifest is valid.
 * The manifest currently carries one unrelated, PRE-EXISTING failure: the bin
 * `economy-otel` is outside the allowlist that `@hasna/contracts` hardcodes
 * (`<name>`, `-cli`, `-mcp`, `-serve`, `-worker`, `-runner`, `-daemon`,
 * `-migrate`, `-doctor`). That failure reproduces identically against contract
 * kit 0.4.2, so it predates the 0.9.0 migration and is not this guard's to
 * enforce — resolving it needs either a rename of a published binary or a
 * widening of the allowlist upstream. Asserting whole-manifest validity here
 * would be a check that cannot pass, which is worth no more than one that cannot
 * fail.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const MANIFEST_PATH = join(REPO_ROOT, 'hasna.contract.json')

type Manifest = {
  kitVersion?: unknown
  storage?: Record<string, unknown>
}

async function readManifest(): Promise<Manifest> {
  return (await Bun.file(MANIFEST_PATH).json()) as Manifest
}

describe('hasna.contract.json storage declaration', () => {
  test('declares a backend from the contract kit enum', async () => {
    const manifest = await readManifest()
    expect(manifest.storage).toBeDefined()
    expect(['sqlite', 'postgresql']).toContain(manifest.storage?.backend)
  })

  test('does not declare the removed storage.mode enum', async () => {
    const manifest = await readManifest()
    // `mode` was removed in contract kit 0.9.0. Because the storage object is
    // additionalProperties:false, leaving it in place fails validation outright.
    expect(Object.keys(manifest.storage ?? {})).not.toContain('mode')
  })

  test('raises no storage-scoped issue against the installed contract kit', async () => {
    const { validateServiceContractManifest } = await import('@hasna/contracts/service-contract')
    const manifest = await readManifest()

    const result = validateServiceContractManifest(manifest)
    const issues = result.success ? [] : (result.error?.issues ?? [])
    const storageIssues = issues.filter((issue) => issue.path?.[0] === 'storage')

    expect(storageIssues).toEqual([])
  })

  test('kitVersion tracks the installed @hasna/contracts version', async () => {
    const manifest = await readManifest()
    const installed = (await Bun.file(
      join(REPO_ROOT, 'node_modules', '@hasna', 'contracts', 'package.json'),
    ).json()) as { version: string }

    // A manifest that claims to track an older kit than the one resolved at
    // build time is how the storage declaration silently went stale.
    expect(manifest.kitVersion).toBe(installed.version)
  })
})

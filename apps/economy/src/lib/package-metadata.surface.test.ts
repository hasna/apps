import { describe, test, expect, beforeAll } from 'bun:test'
import { spawnSync } from 'bun'

// Regression for the release-review P1 (economy 0.3.27): the root barrel
// (dist/index.js) ships one level SHALLOWER than the bin bundles
// (dist/cli, dist/mcp, dist/server, dist/otel), so the old loader's
// `readFileSync(new URL('../../package.json', import.meta.url))` — correct at
// src/lib depth and at bin-bundle depth — resolved one level too far from the
// barrel and threw ENOENT at import time. The `./sdk` and root imports of the
// installed package were unusable. The loader now embeds package.json at
// build time (JSON import, inlined into every bundle), which cannot drift with
// bundle depth.
describe('package-metadata bundle surface', () => {
  beforeAll(() => {
    const appRoot = new URL('../../', import.meta.url).pathname
    const res = spawnSync(['bun', 'run', 'build:lib'], { cwd: appRoot })
    expect(res.exitCode, `build:lib failed: ${res.stderr?.toString()}`).toBe(0)
  })

  test('the built root barrel imports without a package.json resolution error', async () => {
    // This import is the failure point: on the old loader it threw
    // ENOENT .../apps/package.json (one level above the package root).
    const mod = await import('../../dist/index.js')
    expect(mod.getStore).toBeTypeOf('function')
  })
})

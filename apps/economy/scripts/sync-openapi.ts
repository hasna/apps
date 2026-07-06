#!/usr/bin/env bun
// Regenerate src/openapi.ts from the canonical openapi/economy.json so the serve
// (and the SDK generated from it) stay in lock-step with the published contract.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const json = readFileSync(resolve(root, 'openapi/economy.json'), 'utf8').trimEnd()
const out = `// @generated mirror of openapi/economy.json — the serve OpenAPI (SDK source).
// Edit openapi/economy.json, then regenerate:  bun scripts/sync-openapi.ts
export const openApiSpec: Record<string, unknown> = ${json}
export default openApiSpec
`
writeFileSync(resolve(root, 'src/openapi.ts'), out)
console.log('synced src/openapi.ts from openapi/economy.json')

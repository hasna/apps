import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function files(path: string): string[] {
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry)
    return statSync(child).isDirectory() ? files(child) : [child]
  })
}

describe('publish and artifact contract', () => {
  it('is restricted/internal, UNLICENSED, and intentionally publishable', () => {
    expect(packageJson).toMatchObject({
      name: '@hasna/cli',
      version: '0.2.0',
      license: 'UNLICENSED',
      engines: { node: '>=20' },
      bin: { hasna: './dist/cli.js' },
      publishConfig: { access: 'restricted', tag: 'internal' },
    })
    expect(packageJson.private).toBeUndefined()
  })

  it('builds a Node ESM artifact with no Bun globals', () => {
    execFileSync('bun', ['run', 'build'], { cwd: root })
    const artifact = files(join(root, 'dist'))
      .filter((path) => path.endsWith('.js'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    expect(artifact).not.toMatch(/\bBun\s*\./)
    expect(readFileSync(join(root, 'dist', 'cli.js'), 'utf8')).toMatch(/^#!\/usr\/bin\/env node/)
  })

  it('pins workflow actions and does not claim public Sigstore provenance', () => {
    const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
    for (const match of workflow.matchAll(/uses:\s+[^@\s]+@([^\s]+)/g))
      expect(match[1]).toMatch(/^[0-9a-f]{40}$/)
    expect(workflow).not.toContain('npm publish')
    expect(workflow).not.toContain('provenance: true')
    expect(readFileSync(join(root, 'docs/release.md'), 'utf8')).toContain(
      'not a public transparency-log attestation',
    )
  })
})

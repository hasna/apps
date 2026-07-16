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
      repository: 'https://github.com/hasna/cli',
      publishConfig: {
        access: 'restricted',
        tag: 'internal',
        registry: 'https://npm.pkg.github.com',
      },
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

  it('publishes privately only through a guarded manual GitHub Packages workflow', () => {
    const workflow = readFileSync(join(root, '.github/workflows/private-release.yml'), 'utf8')
    for (const match of workflow.matchAll(/uses:\s+[^@\s]+@([^\s]+)/g))
      expect(match[1]).toMatch(/^[0-9a-f]{40}$/)

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toMatch(/^\s+push:/m)
    expect(workflow).not.toMatch(/^\s+pull_request:/m)
    expect(workflow).toMatch(/permissions:\s*\n\s+contents:\s+read\s*\n\s+packages:\s+write/)
    expect(workflow).toContain('environment: private-release')
    expect(workflow).toContain('runs-on: ubuntu-24.04')
    expect(workflow).toContain('https://npm.pkg.github.com')
    expect(workflow).toContain('registry=https://registry.npmjs.org/')
    expect(workflow).toContain('@hasna:registry=https://npm.pkg.github.com')
    expect(workflow).toContain('Verify scoped registry routing and local tarball install')
    expect(workflow).toContain('--userconfig="$SCOPED_CONFIG" "$TARBALL"')
    expect(workflow).toContain('--userconfig="$SCOPED_CONFIG" "${PACKAGE_NAME}@${VERSION}"')
    expect(workflow).not.toContain(
      '--registry="$REGISTRY_URL" "${PACKAGE_NAME}@${VERSION}"',
    )
    expect(workflow).toContain('--access restricted')
    expect(workflow).toContain('--tag internal')
    expect(workflow).toContain('npm publish "$TARBALL"')
    expect(workflow).toContain('refs/heads/main')
    expect(workflow).toContain('existing package version query did not fail with E404')
    expect(workflow).toContain("metadata.visibility !== 'private'")
    expect(workflow).toContain("metadata.repository?.full_name !== 'hasna/cli'")
    expect(workflow).toContain('minimumReleaseAgeExcludes = ["@hasna/cli"]')
  })

  it('pins an exact regular-file artifact manifest and expanded leak checks', () => {
    const verifier = readFileSync(join(root, 'scripts/verify-package-artifact.mjs'), 'utf8')
    const manifest = readFileSync(join(root, 'scripts/package-artifact-manifest.txt'), 'utf8')
      .trim()
      .split('\n')
    expect(new Set(manifest).size).toBe(manifest.length)
    expect(manifest).toContain('package/package.json')
    expect(manifest).toContain('package/dist/cli.js')
    expect(manifest).not.toContain('package/src/cli.ts')
    expect(verifier).toContain("['-tvzf', tarball, '--numeric-owner']")
    expect(verifier).toContain('non-regular archive entry')
    expect(verifier).toContain('github_pat_')
    expect(verifier).toContain('Windows absolute user path')
    expect(verifier).toContain('package-artifact-manifest.txt')
  })

  it('documents GitHub Packages authentication and the separate deprecated npmjs package', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8')
    const release = readFileSync(join(root, 'docs/release.md'), 'utf8')
    for (const document of [readme, release]) {
      expect(document).toContain('https://npm.pkg.github.com')
      expect(document).toContain('NODE_AUTH_TOKEN')
      expect(document).toContain('npmjs')
      expect(document).toContain('0.1.0')
    }
    expect(release).toContain('Anonymous denial is not proof of private visibility')
    expect(release).toContain('required human reviewer')
    expect(release).toContain('restrict deployment branches to `main`')
  })
})

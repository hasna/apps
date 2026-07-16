import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const [tarballArg, outputArg = 'artifacts/build-evidence.json'] = process.argv.slice(2)
if (!tarballArg) throw new Error('usage: node scripts/build-evidence.mjs <tarball> [output]')

const tarball = resolve(tarballArg)
const output = resolve(outputArg)
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const bytes = await readFile(tarball)
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const commit = process.env.GITHUB_SHA || git('rev-parse', 'HEAD')
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('source commit must be a full SHA')
const dirty = git('status', '--porcelain').length > 0
const evidence = {
  schema: 'hasna.private_build_evidence.v1',
  package: { name: packageJson.name, version: packageJson.version },
  source: { repository: process.env.GITHUB_REPOSITORY || 'hasna/cli', commit, dirty },
  artifact: {
    filename: tarball.split('/').at(-1),
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  },
  tools: { node: process.version, bun: process.env.BUN_VERSION || null },
  claim: 'private-github-build-evidence-not-public-sigstore-provenance',
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`)
process.stdout.write(`${output}\n`)

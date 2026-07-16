import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [tarballArgument] = process.argv.slice(2)
if (!tarballArgument) throw new Error('usage: node scripts/verify-package-artifact.mjs <tarball>')

const tarball = resolve(tarballArgument)
const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean)

const allowedFiles = new Set([
  'package/LICENSE',
  'package/README.md',
  'package/SECURITY.md',
  'package/package.json',
])
for (const entry of entries) {
  const allowed =
    allowedFiles.has(entry) || entry.startsWith('package/dist/') || entry.startsWith('package/docs/')
  if (!allowed) throw new Error(`unexpected package entry: ${entry}`)
}
if (entries.some((entry) => entry.startsWith('package/src/') || entry.startsWith('package/test/')))
  throw new Error('source or test files must not be published')

const packageJson = JSON.parse(
  execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }),
)
if (packageJson.name !== '@hasna/cli' || packageJson.version !== '0.2.0')
  throw new Error('tarball package identity mismatch')
const repository =
  typeof packageJson.repository === 'string' ? packageJson.repository : packageJson.repository?.url
if (repository !== 'https://github.com/hasna/cli')
  throw new Error('tarball repository link mismatch')
if (
  packageJson.publishConfig?.registry !== 'https://npm.pkg.github.com' ||
  packageJson.publishConfig?.access !== 'restricted' ||
  packageJson.publishConfig?.tag !== 'internal'
)
  throw new Error('tarball private publish configuration mismatch')

const credentialPatterns = [
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bnpm_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
]
for (const entry of entries.filter((candidate) => !candidate.endsWith('/'))) {
  const content = execFileSync('tar', ['-xOzf', tarball, entry])
  const text = content.toString('utf8')
  for (const pattern of credentialPatterns) {
    if (pattern.test(text)) throw new Error(`credential-like content in ${entry}`)
  }
  if (/\/(?:home|Users)\/[^/\s]+\//.test(text))
    throw new Error(`absolute user path in ${entry}`)
  if (entry.endsWith('.map')) {
    const sourceMap = JSON.parse(text)
    if ('sourcesContent' in sourceMap) throw new Error(`embedded source content in ${entry}`)
  }
}

const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
if (packageSource.includes('registry.npmjs.org'))
  throw new Error('package metadata must not target npmjs')

process.stdout.write(`${tarball}\n`)

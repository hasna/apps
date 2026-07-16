import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const temporary = await mkdtemp(join(tmpdir(), 'hasna-cli-smoke-'))
try {
  execFileSync('bun', ['run', 'clean'], { cwd: root, stdio: 'inherit' })
  execFileSync('bun', ['run', 'build'], { cwd: root, stdio: 'inherit' })
  const packed = execFileSync('npm', ['pack', '--json'], { cwd: root, encoding: 'utf8' })
  const [{ filename }] = JSON.parse(packed)
  const tarball = join(root, filename)
  execFileSync('npm', ['init', '-y'], { cwd: temporary, stdio: 'ignore' })
  execFileSync('npm', ['install', '--ignore-scripts', tarball], { cwd: temporary, stdio: 'inherit' })
  const cli = join(temporary, 'node_modules', '.bin', 'hasna')
  const result = JSON.parse(execFileSync(cli, ['--json', 'version'], { encoding: 'utf8' }))
  if (result.schema !== 'hasna.cli_result.v1' || result.data?.version !== '0.2.0')
    throw new Error('installed tarball smoke returned an invalid result')
  execFileSync(process.execPath, ['scripts/build-evidence.mjs', tarball], { cwd: root, stdio: 'inherit' })
  process.stdout.write(`${tarball}\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}

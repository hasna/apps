import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const repoRoot = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')

describe('economy-serve build artifact', () => {
  test('preserves the bun shebang in the built entrypoint', async () => {
    const outdir = mkdtempSync(join(tmpdir(), 'economy-serve-build-'))

    try {
      const proc = Bun.spawn(
        [
          process.execPath,
          'build',
          'src/server/index.ts',
          '--outdir',
          outdir,
          '--target',
          'bun',
          '--packages',
          'external',
        ],
        {
          cwd: repoRoot,
          stdout: 'ignore',
          stderr: 'ignore',
        },
      )

      expect(await proc.exited).toBe(0)

      const built = readFileSync(join(outdir, 'index.js'), 'utf8')
      expect(built.startsWith('#!/usr/bin/env bun\n')).toBe(true)
    } finally {
      rmSync(outdir, { recursive: true, force: true })
    }
  })
})

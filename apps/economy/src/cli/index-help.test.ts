import { describe, expect, test } from 'bun:test'

const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')

describe('economy CLI help', () => {
  test('documents Gemini as a billing sync provider', async () => {
    const proc = Bun.spawn(['bun', 'run', 'src/cli/index.ts', 'billing', 'sync', '--help'], {
      cwd: root,
      env: { ...process.env, ECONOMY_DB: ':memory:' },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Sync actual billing from Anthropic, OpenAI, and Gemini billing sources')
    expect(stdout).toContain('--anthropic')
    expect(stdout).toContain('--openai')
    expect(stdout).toContain('--gemini')
    expect(stderr).toBe('')
  })
})

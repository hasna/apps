import { describe, expect, test } from 'bun:test'

describe('economy-otel entrypoint', () => {
  test('documents its port, bind controls, and endpoints', async () => {
    const proc = Bun.spawn(['bun', 'run', 'src/otel/index.ts', '--help'], {
      cwd: new URL('../../', import.meta.url).pathname.replace(/\/$/, ''),
      env: { ...process.env, ECONOMY_DB: ':memory:' },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Usage: economy-otel [options]')
    expect(stdout).toContain('-p, --port <port>')
    expect(stdout).toContain('ECONOMY_OTEL_PORT')
    expect(stdout).toContain('ECONOMY_OTEL_BIND')
    expect(stdout).toContain('POST /v1/metrics')
    expect(stdout).toContain('POST /ingest')
    expect(stderr).toBe('')
  })
})

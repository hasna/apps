import { describe, test, expect } from 'bun:test'

describe('economy-serve entrypoint', () => {
  test('prints help and exits without binding a port', async () => {
    const proc = Bun.spawn(['bun', 'run', 'src/server/index.ts', '--help'], {
      cwd: new URL('../../', import.meta.url).pathname.replace(/\/$/, ''),
      env: { ...process.env, ECONOMY_DB: ':memory:' },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Usage: economy-serve [options]')
    expect(stdout).toContain('REST API server for @hasna/economy')
    expect(stderr).toBe('')
  })

  test('prints version and exits', async () => {
    const proc = Bun.spawn(['bun', 'run', 'src/server/index.ts', '--version'], {
      cwd: new URL('../../', import.meta.url).pathname.replace(/\/$/, ''),
      env: { ...process.env, ECONOMY_DB: ':memory:' },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = (await new Response(proc.stdout).text()).trim()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/^\d+\.\d+\.\d+$/)
    expect(stderr).toBe('')
  })

  test('rejects invalid ports before binding', async () => {
    const cases: Array<{ args: string[]; env?: Record<string, string>; message: string }> = [
      { args: ['--port', '70000'], message: 'Invalid port: 70000' },
      { args: ['--port', '1.5'], message: 'Invalid port: 1.5' },
      { args: [], env: { ECONOMY_PORT: 'not-a-port' }, message: 'Invalid ECONOMY_PORT: not-a-port' },
    ]

    for (const c of cases) {
      const proc = Bun.spawn(['bun', 'run', 'src/server/index.ts', ...c.args], {
        cwd: new URL('../../', import.meta.url).pathname.replace(/\/$/, ''),
        env: { ...process.env, ECONOMY_DB: ':memory:', ...c.env },
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited

      expect(exitCode).toBe(1)
      expect(stdout).toBe('')
      expect(stderr).toContain(c.message)
    }
  })

  test('rejects startup without an API token before binding', async () => {
    const env = { ...process.env, ECONOMY_DB: ':memory:' }
    delete env['ECONOMY_API_TOKEN']
    delete env['HASNA_ECONOMY_API_TOKEN']
    const proc = Bun.spawn(['bun', 'run', 'src/server/index.ts', '--port', '3456'], {
      cwd: new URL('../../', import.meta.url).pathname.replace(/\/$/, ''),
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('ECONOMY_API_TOKEN or HASNA_ECONOMY_API_TOKEN is required')
  })
})

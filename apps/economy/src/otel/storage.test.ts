import { afterEach, describe, expect, test } from 'bun:test'
import type { Subprocess } from 'bun'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { hermeticFleetEnv, sqliteFilesUnder } from '../lib/test-hermetic-fleet-env.js'

/**
 * economy-otel follows the storage seam (hasna/apps#1720):
 *
 *   - no credential and no opt-in  -> fails closed BEFORE binding: exit 1, the
 *                                     resolver's diagnostic, no SQLite file;
 *   - a resolved credential        -> every accepted payload is FORWARDED to
 *                                     the shared API's /v1/ingest, and nothing
 *                                     is written under the app home;
 *   - HASNA_ECONOMY_LOCAL=1        -> the on-box store, announced on stderr.
 *
 * Every run spawns the real bin with `--port 0` and reads the port it
 * announces, so no two runs can collide. The credential is a fixture string.
 */
const OTEL_ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const tempRoots: string[] = []
const children: Array<Subprocess<'pipe', 'pipe', 'pipe'>> = []
const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(async () => {
  for (const child of children.splice(0)) {
    try { child.kill() } catch { /* already gone */ }
    await child.exited
  }
  for (const server of servers.splice(0)) server.stop(true)
  for (const root of tempRoots.splice(0)) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

function tempRoot(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `economy-otel-${label}-`))
  tempRoots.push(dir)
  return dir
}

function spawnOtel(env: Record<string, string>): Subprocess<'pipe', 'pipe', 'pipe'> {
  const proc = Bun.spawn([process.execPath, 'run', 'src/otel/index.ts', '--port', '0'], {
    cwd: OTEL_ROOT,
    env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  proc.stdin.end()
  children.push(proc)
  return proc
}

/** Wait for the sidecar's `listening on <url>` line, or fail with what it printed. */
async function readListeningUrl(proc: Subprocess<'pipe', 'pipe', 'pipe'>, timeoutMs = 10_000): Promise<string> {
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const next = await Promise.race([
        reader.read(),
        Bun.sleep(Math.max(1, deadline - Date.now())).then(
          () => ({ done: true, value: undefined }) as ReadableStreamReadResult<Uint8Array>,
        ),
      ])
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      const match = buffer.match(/listening on (http:\/\/\S+)/)
      if (match) return match[1]!
    }
  } finally {
    try { reader.releaseLock() } catch { /* a read may still be pending */ }
  }
  throw new Error(`economy-otel announced no listener; stdout so far: ${JSON.stringify(buffer.slice(0, 300))}`)
}

/** Resolve the exit code, or kill the child when it outlives the budget. */
async function exitedWithin(proc: Subprocess<'pipe', 'pipe', 'pipe'>, ms: number): Promise<number | null> {
  const timer = Bun.sleep(ms).then(() => {
    try { proc.kill() } catch { /* already gone */ }
    return null
  })
  return Promise.race([proc.exited.then((code) => code as number), timer])
}

const SIMPLE_EVENT = {
  source: 'app',
  cost_center: 'fixture',
  cost_center_kind: 'app',
  project_path: '/workspace/fixture',
  model: 'gpt-5-mini',
  cost_usd: 0.12,
  input_tokens: 1200,
  output_tokens: 300,
}

async function postIngest(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(SIMPLE_EVENT),
  })
}

describe('economy-otel storage lanes (hasna/apps#1720)', () => {
  test('fails closed before binding when no credential resolves and no opt-in is set', async () => {
    const home = tempRoot('fail-closed')
    const proc = spawnOtel(hermeticFleetEnv(home))
    const stdoutPromise = new Response(proc.stdout).text()
    const stderrPromise = new Response(proc.stderr).text()
    const exitCode = await exitedWithin(proc, 10_000)
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])

    expect(exitCode).toBe(1)
    expect(stdout).not.toContain('listening on http')
    expect(stderr).toStartWith('economy-otel: ')
    expect(stderr).toMatch(/fail\w*\s*closed/i)
    expect(stderr).toContain('HASNA_ECONOMY_API_KEY')
    expect(stderr).toContain('HASNA_ECONOMY_LOCAL')
    expect(stderr).not.toContain('local-fallback')
    expect(sqliteFilesUnder(home)).toEqual([])
  }, 15_000)

  test('forwards ingested rows to the hosted /v1/ingest and writes nothing under the app home', async () => {
    const received: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = []
    const api = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        const url = new URL(req.url)
        const body = await req.json().catch(() => null) as Record<string, unknown> | null
        received.push({ method: req.method, path: url.pathname, body })
        return Response.json({ data: { ingested: { requests: 1, sessions: 1 }, total: 2 } })
      },
    })
    servers.push(api)

    const home = tempRoot('hosted')
    const proc = spawnOtel(hermeticFleetEnv(home, {
      HASNA_ECONOMY_API_URL: `http://127.0.0.1:${api.port}`,
      HASNA_ECONOMY_API_KEY: 'fixture-hosted-key',
    }))
    const stderrPromise = new Response(proc.stderr).text()
    const baseUrl = await readListeningUrl(proc)

    const res = await postIngest(baseUrl)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ingested: 1, sessions: 1, forwarded: 2 })

    const ingest = received.find((call) => call.method === 'POST' && call.path === '/v1/ingest')
    expect(ingest).toBeTruthy()
    const requests = ingest!.body!['requests'] as Array<Record<string, unknown>>
    const sessions = ingest!.body!['sessions'] as Array<Record<string, unknown>>
    expect(requests).toHaveLength(1)
    expect(requests[0]!['model']).toBe('gpt-5-mini')
    expect(Number(requests[0]!['cost_usd'])).toBeCloseTo(0.12)
    expect(sessions).toHaveLength(1)

    proc.kill()
    await proc.exited
    const stderr = await stderrPromise
    expect(stderr).not.toContain('local mode')
    // Hosted: no SQLite anywhere under the run's HOME — not the app home, not
    // the store path, not a scratch file.
    expect(sqliteFilesUnder(home)).toEqual([])
    expect(existsSync(join(home, 'economy-home', 'economy.db'))).toBe(false)
  }, 20_000)

  test('the explicit local opt-in serves the on-box store and says so', async () => {
    const home = tempRoot('local')
    const proc = spawnOtel(hermeticFleetEnv(home, { HASNA_ECONOMY_LOCAL: '1' }))
    const stderrPromise = new Response(proc.stderr).text()
    const baseUrl = await readListeningUrl(proc)

    const res = await postIngest(baseUrl)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ingested: 1, sessions: 1 })

    proc.kill()
    await proc.exited
    const stderr = await stderrPromise
    expect(stderr).toContain('economy: local mode')
    expect(existsSync(join(home, 'economy-home', 'economy.db'))).toBe(true)
  }, 20_000)
})

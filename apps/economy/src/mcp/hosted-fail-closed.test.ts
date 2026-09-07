import { afterEach, describe, expect, it } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { hermeticFleetEnv, sqliteFilesUnder } from '../lib/test-hermetic-fleet-env.js'

/**
 * The MCP surface under two hosted-mode acceptance arms of hasna/apps#1720:
 *
 *   (c) hosted with NO credential fails loud — non-zero exit, the fail-closed
 *       message (naming the Keychain item, the credentials file and
 *       HASNA_ECONOMY_API_KEY) as the FIRST stderr line, no SQLite file;
 *   (f) a hosted-mode MCP session creates no *.db under the app home — the
 *       agent-lifecycle registry used to be opened eagerly by buildServer()
 *       and left agent-registry.db (+ -wal/-shm) behind before any tool ran.
 *
 * Both spawn the real bin (`bun run src/mcp/index.ts`) in the hermetic fleet
 * env: the Keychain tier IS consulted (live process env) and finds nothing,
 * so the credential — when one is given — comes from the env tier. The value
 * is a fixture string; nothing here prints it.
 */
const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const tempRoots: string[] = []

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true })
  }
})

function tempRoot(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `economy-mcp-${label}-`))
  tempRoots.push(dir)
  return dir
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0]
  return first?.type === 'text' ? (first.text ?? '') : ''
}

describe('economy-mcp in hosted mode (hasna/apps#1720)', () => {
  it('serves the agent-lifecycle tools without creating any SQLite file under the app home', async () => {
    const home = tempRoot('hosted')
    const stderrChunks: string[] = []
    const client = new Client({ name: 'economy-mcp-hosted-test', version: '1.0.0' }, { capabilities: {} })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['run', 'src/mcp/index.ts'],
      cwd: root,
      env: hermeticFleetEnv(home, {
        // A closed loopback port: the tools exercised here never make a
        // request, and an authority that cannot answer proves it.
        HASNA_ECONOMY_API_URL: 'http://127.0.0.1:9',
        HASNA_ECONOMY_API_KEY: 'fixture-hosted-key',
      }),
      stderr: 'pipe',
    })

    try {
      await client.connect(transport, { timeout: 10_000 })
      transport.stderr?.on('data', (chunk) => stderrChunks.push(String(chunk)))

      const tools = await client.listTools(undefined, { timeout: 10_000 })
      const names = new Set(tools.tools.map((tool) => tool.name))
      for (const expected of ['register_agent', 'heartbeat', 'set_focus', 'list_agents', 'get_cost_summary']) {
        expect(names.has(expected)).toBe(true)
      }

      const registered = await client.callTool(
        { name: 'register_agent', arguments: { name: 'fixture-agent' } },
        undefined,
        { timeout: 10_000 },
      )
      expect(JSON.parse(textOf(registered as { content: Array<{ type: string; text?: string }> }))).toMatchObject({
        name: 'fixture-agent',
        status: 'active',
      })

      const listed = await client.callTool({ name: 'list_agents', arguments: {} }, undefined, { timeout: 10_000 })
      const agents = JSON.parse(textOf(listed as { content: Array<{ type: string; text?: string }> })) as Array<{ name: string }>
      expect(agents.map((agent) => agent.name)).toContain('fixture-agent')
    } finally {
      await client.close()
    }

    // The registry lived in memory: nothing matching *.db (or a WAL/SHM
    // sidecar) exists anywhere under the run's HOME, app home included.
    expect(sqliteFilesUnder(home)).toEqual([])
    expect(existsSync(join(home, 'economy-home', 'agent-registry.db'))).toBe(false)
    expect(stderrChunks.join('')).not.toContain('local mode')
  })

  it('fails closed with the resolver diagnostic as the first stderr line when no credential resolves', async () => {
    const home = tempRoot('fail-closed')
    const proc = Bun.spawn([process.execPath, 'run', 'src/mcp/index.ts'], {
      cwd: root,
      env: hermeticFleetEnv(home),
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    proc.stdin.end()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    expect(exitCode).not.toBe(0)
    const firstLine = stderr.split('\n')[0] ?? ''
    expect(firstLine).toStartWith('MCP server error:')
    expect(firstLine).toMatch(/fail\w*\s*closed/i)
    expect(firstLine).toContain('hasna.credentials.economy.api-key')
    expect(firstLine).toContain('config/credentials')
    expect(firstLine).toContain('HASNA_ECONOMY_API_KEY')
    // Not Bun's code frame (`NNNN | }`) — the diagnostic itself leads.
    expect(firstLine).not.toMatch(/^MCP server error:\s*\d+\s*\|/)
    expect(stderr).not.toContain('local-fallback')
    expect(sqliteFilesUnder(home)).toEqual([])
  })
})

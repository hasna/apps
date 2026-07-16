import { describe, expect, it } from 'vitest'
import { runCli } from '../src/runner.js'
import { RESULT_SCHEMA } from '../src/result.js'
import { EXIT_CODES } from '../src/errors.js'
import { fixture, profileConfig } from './helpers.js'

describe('stable CLI contract', () => {
  it('emits the versioned JSON envelope and documented usage exit', async () => {
    const ok = fixture()
    const success = await runCli(['--json', 'version'], ok.runtime)
    expect(success.exitCode).toBe(0)
    expect(JSON.parse(ok.stdout.value)).toMatchObject({ schema: RESULT_SCHEMA, ok: true, data: { version: '0.2.0' } })

    const bad = fixture()
    const failed = await runCli(['--json', 'unknown'], bad.runtime)
    expect(failed.exitCode).toBe(EXIT_CODES.USAGE)
    expect(JSON.parse(bad.stdout.value)).toMatchObject({ schema: RESULT_SCHEMA, ok: false, error: { code: 'USAGE' } })
  })

  it('provides every documented exit code without collisions', () => {
    expect(Object.values(EXIT_CODES).sort((a, b) => a - b)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 70])
  })

  it('creates and selects profiles without plaintext credentials', async () => {
    const f = fixture()
    expect(
      (await runCli(['--json', 'profiles', 'add', 'prod', '--api-url', 'https://hasna.com', '--org', 'hasna', '--credential-env', 'HASNA_TOKEN'], f.runtime)).exitCode,
    ).toBe(0)
    expect(f.config.value.profiles.prod?.credential).toBe('env:HASNA_TOKEN')
    expect(JSON.stringify(f.config.value)).not.toContain('secret-value')
    await runCli(['--json', 'profiles', 'use', 'prod'], f.runtime)
    expect(f.config.value.currentProfile).toBe('prod')
  })

  it('rejects non-TLS remote API URLs', async () => {
    const f = fixture()
    const result = await runCli(['--json', 'profiles', 'add', 'bad', '--api-url', 'http://example.com'], f.runtime)
    expect(result.exitCode).toBe(EXIT_CODES.VALIDATION)
  })

  it('discovers only the built-in no-execution cweb provider', async () => {
    const f = fixture()
    await runCli(['--json', 'apps', 'list'], f.runtime)
    const apps = JSON.parse(f.stdout.value).data
    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({ id: 'cweb', provider: 'builtin:cweb', execution: 'none' })
  })

  it('requires a matching plan digest and --yes for app installation', async () => {
    const planRun = fixture()
    await runCli(['--json', 'apps', 'install', 'cweb'], planRun.runtime)
    const plan = JSON.parse(planRun.stdout.value).data
    expect(plan.digest).toMatch(/^sha256:[0-9a-f]{64}$/)

    const applyRun = fixture()
    const rejected = await runCli(['--json', 'apps', 'install', 'cweb', '--apply', plan.digest], applyRun.runtime)
    expect(rejected.exitCode).toBe(EXIT_CODES.VALIDATION)
    const accepted = await runCli(
      ['--json', 'apps', 'install', 'cweb', '--apply', plan.digest, '--yes'],
      applyRun.runtime,
    )
    expect(accepted.exitCode).toBe(0)
    expect(applyRun.config.value.apps.cweb?.provider).toBe('builtin:cweb')
  })

  it('reports typed account capability unsupported', async () => {
    const f = fixture({ config: profileConfig() })
    const result = await runCli(['--json', 'accounts', 'provision', '--app', 'cweb'], f.runtime)
    expect(result.exitCode).toBe(EXIT_CODES.UNSUPPORTED)
    expect(JSON.parse(f.stdout.value).error).toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
  })

  it('reports cweb capabilities through the OpenAPI-backed manifest, not a fake endpoint', async () => {
    const f = fixture()
    await runCli(['--json', 'app', 'cweb', 'capabilities'], f.runtime)
    expect(JSON.parse(f.stdout.value).data.api).toEqual({ openApiPath: '/api/v1/openapi.json', minimumVersion: '1.1.0' })
    expect(f.transport.requests).toHaveLength(0)
  })
})

import { Readable, Writable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { defaultConfig, type Config, type ConfigStore, type PendingPlanRecordStatus, type Profile } from '../src/config.js'
import type { ApiTransport, HttpRequestOptions, HttpResponse } from '../src/http.js'
import type { Runtime } from '../src/runtime.js'

export class MemoryConfig implements ConfigStore {
  readonly path = '/memory/config.json'
  value: Config
  constructor(value: Config = defaultConfig()) {
    this.value = structuredClone(value)
  }
  async load() {
    return structuredClone(this.value)
  }
  async save(config: Config) {
    this.value = structuredClone(config)
  }
  async update(change: (config: Config) => void | Promise<void>) {
    const config = structuredClone(this.value)
    await change(config)
    this.value = structuredClone(config)
    return structuredClone(config)
  }
  async recordPendingPlan(digest: string, entry: NonNullable<Config['pendingPlans']>[string], now: number): Promise<PendingPlanRecordStatus> {
    this.value.pendingPlans ??= {}
    this.value.pendingPlans = Object.fromEntries(Object.entries(this.value.pendingPlans).filter(([, item]) => {
      return item.state === 'in-flight' || Date.parse(item.expiresAt) > now
    }))
    const existing = this.value.pendingPlans[digest]
    if (existing) return existing.state === 'in-flight' ? 'in-flight' : 'reused'
    this.value.pendingPlans[digest] = structuredClone(entry)
    return 'created'
  }
  async reservePendingPlan(digest: string, operation: string, target: string, now: number, reservationId: string) {
    const pending = this.value.pendingPlans?.[digest]
    if (!pending || (pending.state ?? 'pending') !== 'pending' || Date.parse(pending.expiresAt) <= now || pending.operation !== operation || pending.target !== target) return false
    this.value.pendingPlans![digest] = { ...pending, state: 'in-flight', reservationId, reservedAt: new Date(now).toISOString() }
    return true
  }
  async settlePendingPlan(digest: string, reservationId: string, outcome: 'consume' | 'release') {
    const pending = this.value.pendingPlans?.[digest]
    if (!pending || pending.state !== 'in-flight' || pending.reservationId !== reservationId) return false
    if (outcome === 'consume') delete this.value.pendingPlans?.[digest]
    else this.value.pendingPlans![digest] = { operation: pending.operation, target: pending.target, expiresAt: pending.expiresAt, state: 'pending' }
    return true
  }
}

export class MemoryCredentials {
  values = new Map<string, string>()
  async resolve(profile: Profile) {
    const value = this.values.get(profile.name)
    if (!value) throw new Error('missing')
    return value
  }
  async store(profile: Profile, value: string) {
    this.values.set(profile.name, value)
    return { ...profile, credentialStore: 'keychain' as const, credential: `keychain:${profile.name}` as const }
  }
  async delete(profile: Profile) {
    this.values.delete(profile.name)
  }
}

export class FakeTransport implements ApiTransport {
  requests: HttpRequestOptions[] = []
  responses: HttpResponse[] = []
  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    this.requests.push(structuredClone(options))
    return (
      this.responses.shift() ?? {
        status: 200,
        headers: {},
        body: { ok: true, data: { accepted: true } },
        text: '',
        requestId: 'request-test',
      }
    )
  }
}

class Capture extends Writable {
  value = ''
  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.value += String(chunk)
    callback()
  }
}

export function fixture(options: { input?: string; config?: Config } = {}) {
  const stdout = new Capture()
  const stderr = new Capture()
  const config = new MemoryConfig(options.config)
  const credentials = new MemoryCredentials()
  const transport = new FakeTransport()
  const runtime: Runtime = {
    config,
    credentials,
    transport: () => transport,
    stdin: Readable.from(options.input ?? ''),
    stdout,
    stderr,
    now: () => new Date('2026-07-16T12:00:00.000Z'),
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    env: {},
    readPassword: async () => 'password-from-safe-input',
  }
  return { runtime, config, credentials, transport, stdout, stderr }
}

export function profileConfig(): Config {
  return {
    schema: 'hasna.cli_config.v1',
    currentProfile: 'prod',
    profiles: {
      prod: { name: 'prod', apiUrl: 'https://hasna.com', orgSlug: 'hasna' },
    },
    apps: {},
  }
}

export function jsonResponse(data: unknown, headers: Record<string, string> = {}): HttpResponse {
  return {
    status: 200,
    headers,
    body: { ok: true, data },
    text: JSON.stringify({ ok: true, data }),
    requestId: randomUUID(),
  }
}

export function cwebSpecResponse(version = '1.1.0'): HttpResponse {
  const paths: Record<string, Record<string, object>> = {}
  for (const [path, method] of ([
    ['/api/v1/auth/login', 'post'], ['/api/v1/auth/whoami', 'get'],
    ['/api/v1/auth/logout', 'post'],
    ['/api/v1/orgs/{orgSlug}/auth/tokens', 'get'], ['/api/v1/orgs/{orgSlug}/auth/tokens', 'post'],
    ['/api/v1/orgs/{orgSlug}/auth/tokens/{id}', 'delete'], ['/api/v1/orgs/{orgSlug}/auth/tokens/{id}/rotate', 'post'],
    ['/api/v1/orgs/{orgSlug}/auth/tokens/revoke-all', 'post'],
    ['/api/v1/orgs/{orgSlug}/careers/jobs', 'get'], ['/api/v1/orgs/{orgSlug}/careers/jobs', 'post'],
    ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}', 'get'], ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}', 'patch'], ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}', 'delete'],
    ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}/publish', 'post'], ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}/close', 'post'],
    ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}/applications', 'get'], ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}/applications', 'post'],
    ['/api/v1/orgs/{orgSlug}/careers/applications', 'get'],
    ['/api/v1/orgs/{orgSlug}/careers/applications/export', 'get'],
    ['/api/v1/orgs/{orgSlug}/careers/applications/{id}', 'get'], ['/api/v1/orgs/{orgSlug}/careers/applications/{id}', 'patch'],
    ['/api/v1/orgs/{orgSlug}/careers/applications/{id}/anonymize', 'post'],
  ] as Array<[string, string]>)) (paths[path] ??= {})[method] = {}
  const body = { openapi: '3.0.0', info: { title: 'Hasna CWeb CLI API', version }, paths }
  return { status: 200, headers: {}, body, text: JSON.stringify(body), requestId: 'spec-request' }
}

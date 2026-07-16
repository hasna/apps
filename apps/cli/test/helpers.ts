import { Readable, Writable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { defaultConfig, type Config, type ConfigStore, type Profile } from '../src/config.js'
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

import type { ConfigStore, Profile } from './config.js'
import type { CredentialManager } from './credentials.js'
import type { ApiTransport } from './http.js'

export type Runtime = {
  config: ConfigStore
  credentials: Pick<CredentialManager, 'resolve' | 'store' | 'delete'>
  transport(profile: Profile): ApiTransport
  stdin: NodeJS.ReadableStream
  stdout: NodeJS.WritableStream
  stderr: NodeJS.WritableStream
  now(): Date
  randomUUID(): string
  readPassword(stdin: boolean): Promise<string>
}

export type CommandOutput = {
  data: unknown
  human?: string
  requestId?: string
  idempotencyKey?: string
}

import type { ApiTransport } from '../http.js'

export type ProviderCapability =
  | 'auth'
  | 'apps.lifecycle'
  | 'accounts.read'
  | 'accounts.provision'
  | 'careers.jobs'
  | 'careers.applications'

export type AppManifest = {
  schema: 'hasna.app_manifest.v1'
  id: string
  name: string
  version: string
  provider: string
  description: string
  capabilities: ProviderCapability[]
  api: { openApiPath: string; minimumVersion: string }
  execution: 'none'
}

export type ProviderPackageDescriptor = {
  packageName: string
  version: string
  integrity: `sha512-${string}`
  signature: { algorithm: 'ed25519'; keyId: string; value: string }
}

export interface ProviderContext {
  api: ApiTransport
  token?: string
  orgSlug?: string
}

export interface AccountProvider {
  list(context: ProviderContext): Promise<unknown>
  show(context: ProviderContext, id: string): Promise<unknown>
  provision?(context: ProviderContext, input: unknown): Promise<unknown>
  deprovision?(context: ProviderContext, id: string): Promise<unknown>
}

export interface HasnaProvider {
  readonly id: string
  readonly manifest: AppManifest
  readonly accounts?: AccountProvider
}

export interface ProviderVerifier {
  verify(descriptor: ProviderPackageDescriptor, packageBytes: Uint8Array): Promise<boolean>
}

export function assertNoRemoteProviderExecution(): never {
  throw new Error('External provider packages are disabled in @hasna/cli 0.2.0')
}

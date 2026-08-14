import { VaultClient } from './client';
import type { VaultConfig } from '../types';

export { VaultClient } from './client';

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Vault: ${label} is required`);
  return value.trim();
}

export class Vault {
  private readonly client: VaultClient;

  constructor(config: VaultConfig) {
    this.client = new VaultClient(config);
  }

  static fromEnv(): Vault {
    const baseUrl = process.env.VAULT_BASE_URL;
    const token = process.env.VAULT_TOKEN;
    if (!baseUrl) throw new Error('VAULT_BASE_URL is required');
    if (!token) throw new Error('VAULT_TOKEN is required');
    return new Vault({
      baseUrl,
      token,
      namespace: process.env.VAULT_NAMESPACE,
    });
  }

  async getHealth(): Promise<unknown> {
    return this.client.request('GET', '/v1/sys/health', {
      okStatuses: [200, 429, 472, 473, 474, 501, 503, 530],
    });
  }

  async getSealStatus(): Promise<unknown> {
    return this.client.request('GET', '/v1/sys/seal-status');
  }

  async unseal(options: { key: string; reset?: boolean }): Promise<unknown> {
    return this.client.request('POST', '/v1/sys/unseal', {
      body: { key: requireString(options.key, 'key'), reset: options.reset },
    });
  }

  async seal(): Promise<unknown> {
    return this.client.request('POST', '/v1/sys/seal');
  }

  async lookupSelfToken(): Promise<unknown> {
    return this.client.request('GET', '/v1/auth/token/lookup-self');
  }

  async createToken(options: {
    policies?: string[];
    ttl?: string;
    explicitMaxTtl?: string;
    displayName?: string;
    numUses?: number;
    renewable?: boolean;
    type?: 'service' | 'batch';
    entityAlias?: string;
    meta?: Record<string, string>;
  }): Promise<unknown> {
    return this.client.request('POST', '/v1/auth/token/create', {
      body: {
        policies: options.policies,
        ttl: options.ttl,
        explicit_max_ttl: options.explicitMaxTtl,
        display_name: options.displayName,
        num_uses: options.numUses,
        renewable: options.renewable,
        type: options.type,
        entity_alias: options.entityAlias,
        meta: options.meta,
      },
    });
  }

  async revokeToken(options: { token: string; orphan?: boolean }): Promise<unknown> {
    const suffix = options.orphan ? '-orphan' : '';
    return this.client.request('POST', `/v1/auth/token/revoke${suffix}`, {
      body: { token: requireString(options.token, 'token') },
    });
  }

  async renewToken(options: { token: string; increment?: string }): Promise<unknown> {
    return this.client.request('POST', '/v1/auth/token/renew', {
      body: { token: requireString(options.token, 'token'), increment: options.increment },
    });
  }

  async listMounts(): Promise<unknown> {
    return this.client.request('GET', '/v1/sys/mounts');
  }

  async enableMount(options: {
    path: string;
    type: string;
    description?: string;
    config?: Record<string, unknown>;
    options?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.client.request('POST', `/v1/sys/mounts/${encodeURIComponent(requireString(options.path, 'path'))}`, {
      body: {
        type: requireString(options.type, 'type'),
        description: options.description,
        config: options.config,
        options: options.options,
      },
    });
  }

  async disableMount(options: { path: string }): Promise<unknown> {
    return this.client.request('DELETE', `/v1/sys/mounts/${encodeURIComponent(requireString(options.path, 'path'))}`);
  }

  async listAuthMethods(): Promise<unknown> {
    return this.client.request('GET', '/v1/sys/auth');
  }

  async enableAuthMethod(options: {
    path: string;
    type: string;
    description?: string;
    config?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.client.request('POST', `/v1/sys/auth/${encodeURIComponent(requireString(options.path, 'path'))}`, {
      body: {
        type: requireString(options.type, 'type'),
        description: options.description,
        config: options.config,
      },
    });
  }

  async disableAuthMethod(options: { path: string }): Promise<unknown> {
    return this.client.request('DELETE', `/v1/sys/auth/${encodeURIComponent(requireString(options.path, 'path'))}`);
  }

  async listPolicies(): Promise<unknown> {
    return this.client.request('GET', '/v1/sys/policies/acl');
  }

  async getPolicy(options: { name: string }): Promise<unknown> {
    return this.client.request('GET', `/v1/sys/policies/acl/${encodeURIComponent(requireString(options.name, 'name'))}`);
  }

  async createPolicy(options: { name: string; policy: string }): Promise<unknown> {
    return this.client.request('PUT', `/v1/sys/policies/acl/${encodeURIComponent(requireString(options.name, 'name'))}`, {
      body: { policy: requireString(options.policy, 'policy') },
    });
  }

  async deletePolicy(options: { name: string }): Promise<unknown> {
    return this.client.request('DELETE', `/v1/sys/policies/acl/${encodeURIComponent(requireString(options.name, 'name'))}`);
  }

  async readKvSecret(options: { mount?: string; path: string; version?: number }): Promise<unknown> {
    const mount = options.mount ?? 'secret';
    return this.client.request('GET', `/v1/${encodeURIComponent(mount)}/data/${requireString(options.path, 'path')}`, {
      query: { version: options.version },
    });
  }

  async writeKvSecret(options: {
    mount?: string;
    path: string;
    data: Record<string, unknown>;
    cas?: number;
  }): Promise<unknown> {
    const mount = options.mount ?? 'secret';
    return this.client.request('POST', `/v1/${encodeURIComponent(mount)}/data/${requireString(options.path, 'path')}`, {
      body: {
        data: options.data,
        options: options.cas !== undefined ? { cas: options.cas } : undefined,
      },
    });
  }

  async deleteKvSecret(options: { mount?: string; path: string }): Promise<unknown> {
    const mount = options.mount ?? 'secret';
    return this.client.request('DELETE', `/v1/${encodeURIComponent(mount)}/data/${requireString(options.path, 'path')}`);
  }

  async destroyKvSecretVersions(options: { mount?: string; path: string; versions: number[] }): Promise<unknown> {
    const mount = options.mount ?? 'secret';
    return this.client.request('PUT', `/v1/${encodeURIComponent(mount)}/destroy/${requireString(options.path, 'path')}`, {
      body: { versions: options.versions },
    });
  }

  async getKvMetadata(options: { mount?: string; path: string }): Promise<unknown> {
    const mount = options.mount ?? 'secret';
    return this.client.request('GET', `/v1/${encodeURIComponent(mount)}/metadata/${requireString(options.path, 'path')}`);
  }

  async listKvSecrets(options: { mount?: string; path: string }): Promise<unknown> {
    const mount = options.mount ?? 'secret';
    return this.client.request('LIST', `/v1/${encodeURIComponent(mount)}/metadata/${requireString(options.path, 'path')}`);
  }

  async encrypt(options: {
    mount?: string;
    key: string;
    plaintext: string;
    context?: string;
    type?: string;
  }): Promise<unknown> {
    const mount = options.mount ?? 'transit';
    return this.client.request('POST', `/v1/${encodeURIComponent(mount)}/encrypt/${requireString(options.key, 'key')}`, {
      body: {
        plaintext: requireString(options.plaintext, 'plaintext'),
        context: options.context,
        type: options.type,
      },
    });
  }

  async decrypt(options: {
    mount?: string;
    key: string;
    ciphertext: string;
    context?: string;
  }): Promise<unknown> {
    const mount = options.mount ?? 'transit';
    return this.client.request('POST', `/v1/${encodeURIComponent(mount)}/decrypt/${requireString(options.key, 'key')}`, {
      body: {
        ciphertext: requireString(options.ciphertext, 'ciphertext'),
        context: options.context,
      },
    });
  }

  async signData(options: {
    mount?: string;
    key: string;
    input: string;
    hashAlgorithm?: string;
    context?: string;
  }): Promise<unknown> {
    const mount = options.mount ?? 'transit';
    return this.client.request('POST', `/v1/${encodeURIComponent(mount)}/sign/${requireString(options.key, 'key')}`, {
      body: {
        input: requireString(options.input, 'input'),
        hash_algorithm: options.hashAlgorithm,
        context: options.context,
      },
    });
  }

  async verifyData(options: {
    mount?: string;
    key: string;
    input: string;
    signature: string;
    hashAlgorithm?: string;
    context?: string;
  }): Promise<unknown> {
    const mount = options.mount ?? 'transit';
    return this.client.request('POST', `/v1/${encodeURIComponent(mount)}/verify/${requireString(options.key, 'key')}`, {
      body: {
        input: requireString(options.input, 'input'),
        signature: requireString(options.signature, 'signature'),
        hash_algorithm: options.hashAlgorithm,
        context: options.context,
      },
    });
  }

  async listLeases(options: { prefix: string }): Promise<unknown> {
    return this.client.request('LIST', `/v1/sys/leases/lookup/${requireString(options.prefix, 'prefix')}`);
  }

  async revokeLease(options: { leaseId: string }): Promise<unknown> {
    return this.client.request('POST', '/v1/sys/leases/revoke', {
      body: { lease_id: requireString(options.leaseId, 'leaseId') },
    });
  }

  async renewLease(options: { leaseId: string; increment?: number }): Promise<unknown> {
    return this.client.request('POST', '/v1/sys/leases/renew', {
      body: { lease_id: requireString(options.leaseId, 'leaseId'), increment: options.increment },
    });
  }

  async listEntities(): Promise<unknown> {
    return this.client.request('LIST', '/v1/identity/entity/id');
  }

  async createEntity(options: {
    name: string;
    policies?: string[];
    metadata?: Record<string, string>;
    disabled?: boolean;
  }): Promise<unknown> {
    return this.client.request('POST', '/v1/identity/entity', {
      body: {
        name: requireString(options.name, 'name'),
        policies: options.policies,
        metadata: options.metadata,
        disabled: options.disabled,
      },
    });
  }

  async getEntity(options: { id: string }): Promise<unknown> {
    return this.client.request('GET', `/v1/identity/entity/id/${encodeURIComponent(requireString(options.id, 'id'))}`);
  }

  async wrap(options: { data: Record<string, unknown>; ttl?: string }): Promise<unknown> {
    return this.client.request('POST', '/v1/sys/wrapping/wrap', {
      body: options.data,
      wrapTtl: options.ttl,
    });
  }

  async unwrap(options: { token?: string }): Promise<unknown> {
    return this.client.request('POST', '/v1/sys/wrapping/unwrap', {
      body: options.token ? { token: options.token } : undefined,
    });
  }

  async listAuditDevices(): Promise<unknown> {
    return this.client.request('GET', '/v1/sys/audit');
  }

  async enableAuditDevice(options: {
    path: string;
    type: string;
    description?: string;
    options?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.client.request('POST', `/v1/sys/audit/${encodeURIComponent(requireString(options.path, 'path'))}`, {
      body: {
        type: requireString(options.type, 'type'),
        description: options.description,
        options: options.options,
      },
    });
  }

  getClient(): VaultClient {
    return this.client;
  }
}

/**
 * @hasna/knowledge — self-hosted registry descriptor.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * This is a pure, server-side descriptor: it declares the surface the knowledge
 * HTTP API (src/serve) ACTUALLY serves so a client can discover it from
 * `GET /v1/registry`. It performs no I/O and holds no transport — the sanctioned
 * client transport is the @hasna/contracts storage client wrapped by
 * `src/cloud-store` (the ApiStore). There is no second, raw-fetch client.
 *
 * The endpoints listed here MUST match what src/serve implements. Do not add
 * endpoints the server does not route — a lying registry is worse than none.
 */

export const KNOWLEDGE_REGISTRY_CONTRACT_VERSION = 2 as const;

export interface KnowledgeSourceContract {
  owner: 'open-files';
  preferred_ref: 'open-files';
  allowed_schemes: string[];
  raw_source_bytes_stored_in_open_knowledge: false;
}

export interface KnowledgeArtifactContract {
  storage_type: 'local' | 's3' | 'managed';
  uri_prefix: string | null;
  generated_only: true;
}

export interface KnowledgeRegistryContract {
  contract_version: typeof KNOWLEDGE_REGISTRY_CONTRACT_VERSION;
  service: 'open-knowledge';
  mode: 'local' | 'hosted';
  /** Capabilities the self-hosted HTTP API actually serves. */
  capabilities: string[];
  /** Endpoints the server actually implements under the API origin. */
  endpoints: {
    registry: string;
    notes: string;
    note: string;
    health: string;
    version: string;
    ready: string;
    openapi: string;
  };
  source_contract: KnowledgeSourceContract;
  artifact_contract: KnowledgeArtifactContract;
}

export function knowledgeRegistryContract(input: {
  mode: 'local' | 'hosted';
  sourceSchemes: string[];
  storageType: 'local' | 's3' | 'managed';
  artifactUriPrefix: string | null;
}): KnowledgeRegistryContract {
  return {
    contract_version: KNOWLEDGE_REGISTRY_CONTRACT_VERSION,
    service: 'open-knowledge',
    mode: input.mode,
    capabilities: [
      'registry',
      'notes-read',
      'notes-write',
      'open-files-source-refs',
      's3-generated-artifacts',
    ],
    endpoints: {
      registry: '/v1/registry',
      notes: '/v1/notes',
      note: '/v1/notes/{id}',
      health: '/health',
      version: '/version',
      ready: '/ready',
      openapi: '/openapi.json',
    },
    source_contract: {
      owner: 'open-files',
      preferred_ref: 'open-files',
      allowed_schemes: input.sourceSchemes,
      raw_source_bytes_stored_in_open_knowledge: false,
    },
    artifact_contract: {
      storage_type: input.storageType,
      uri_prefix: input.artifactUriPrefix,
      generated_only: true,
    },
  };
}

import type { ConnectorClient } from './client';
import type { Build, BuildListResult, BuildResult } from '../types';

// ============================================
// Stub Data Generators
// ============================================

function stubBuilds(): Build[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'build_stub_001',
      spec_id: 'spec_stub_001',
      status: 'succeeded',
      pull_request_url: 'https://github.com/example/repo/pull/42',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'build_stub_002',
      spec_id: 'spec_stub_002',
      status: 'running',
      created_at: now,
      updated_at: now,
    },
  ];
}

function stubBuild(id: string, specId = 'spec_stub_001'): Build {
  const now = new Date().toISOString();
  return {
    id,
    spec_id: specId,
    status: 'queued',
    created_at: now,
    updated_at: now,
  };
}

/**
 * Syntropy Builds API
 * Endpoints: GET /builds, GET /builds/:id, POST /builds
 */
export class BuildsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List all builds for the authenticated account.
   */
  async list(): Promise<BuildListResult> {
    const result = await this.client.request<{ builds: Build[] }>('/builds');
    if (result.stub) {
      return { builds: stubBuilds(), stub: true };
    }
    return { builds: result.data?.builds ?? [], stub: false };
  }

  /**
   * Get a single build by ID.
   */
  async get(buildId: string): Promise<BuildResult> {
    const result = await this.client.request<{ build: Build } | Build>(
      `/builds/${encodeURIComponent(buildId)}`
    );
    if (result.stub) {
      return { build: stubBuild(buildId), stub: true };
    }
    const data = result.data as { build?: Build } & Partial<Build>;
    return { build: (data.build ?? (data as Build)), stub: false };
  }

  /**
   * Start a build for a given spec.
   */
  async start(specId: string): Promise<BuildResult> {
    const result = await this.client.request<{ build: Build } | Build>('/builds', {
      method: 'POST',
      body: { spec_id: specId },
    });
    if (result.stub) {
      return { build: stubBuild('build_stub_new', specId), stub: true };
    }
    const data = result.data as { build?: Build } & Partial<Build>;
    return { build: (data.build ?? (data as Build)), stub: false };
  }
}

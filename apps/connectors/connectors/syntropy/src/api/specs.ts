import type { ConnectorClient } from './client';
import type { Spec, SpecListResult, SpecResult, CreateSpecInput } from '../types';

// ============================================
// Stub Data Generators
// ============================================

function stubSpecs(): Spec[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'spec_stub_001',
      title: 'Add OAuth login flow',
      status: 'ready',
      description: 'Spec-driven build for adding an OAuth login flow.',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'spec_stub_002',
      title: 'Refactor billing service',
      status: 'draft',
      description: 'Discovery in progress for the billing refactor.',
      created_at: now,
      updated_at: now,
    },
  ];
}

function stubSpec(id: string): Spec {
  const now = new Date().toISOString();
  return {
    id,
    title: 'Spec-driven build',
    status: 'ready',
    description: 'Placeholder spec returned while the API is unreachable.',
    created_at: now,
    updated_at: now,
  };
}

/**
 * Syntropy Specs API
 * Endpoints: GET /specs, GET /specs/:id, POST /specs
 */
export class SpecsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List all specs for the authenticated account.
   */
  async list(): Promise<SpecListResult> {
    const result = await this.client.request<{ specs: Spec[] }>('/specs');
    if (result.stub) {
      return { specs: stubSpecs(), stub: true };
    }
    return { specs: result.data?.specs ?? [], stub: false };
  }

  /**
   * Get a single spec by ID.
   */
  async get(specId: string): Promise<SpecResult> {
    const result = await this.client.request<{ spec: Spec } | Spec>(
      `/specs/${encodeURIComponent(specId)}`
    );
    if (result.stub) {
      return { spec: stubSpec(specId), stub: true };
    }
    const data = result.data as { spec?: Spec } & Partial<Spec>;
    return { spec: (data.spec ?? (data as Spec)), stub: false };
  }

  /**
   * Create a new spec (starts the structured discovery loop).
   */
  async create(input: CreateSpecInput): Promise<SpecResult> {
    const result = await this.client.request<{ spec: Spec } | Spec>('/specs', {
      method: 'POST',
      body: input,
    });
    if (result.stub) {
      return { spec: { ...stubSpec('spec_stub_new'), title: input.title }, stub: true };
    }
    const data = result.data as { spec?: Spec } & Partial<Spec>;
    return { spec: (data.spec ?? (data as Spec)), stub: false };
  }
}

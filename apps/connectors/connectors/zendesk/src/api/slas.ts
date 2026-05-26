import type { ZendeskClient } from './client';
import type {
  ZendeskSlaPolicy,
  ZendeskSlaPolicyResponse,
  ZendeskSlaPoliciesResponse,
  CreateSlaPolicyRequest,
  UpdateSlaPolicyRequest,
  SlaListParams,
} from '../types';

/**
 * Zendesk SLA Policies API
 * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/sla_policies/
 */
export class SlaPoliciesApi {
  constructor(private readonly client: ZendeskClient) {}

  /**
   * List all SLA policies
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/sla_policies/#list-sla-policies
   */
  async list(params?: SlaListParams): Promise<ZendeskSlaPolicy[]> {
    const response = await this.client.get<ZendeskSlaPoliciesResponse>('/slas/policies.json', {
      page: params?.page,
      per_page: params?.per_page,
    });
    return response.sla_policies;
  }

  /**
   * Get an SLA policy by ID
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/sla_policies/#show-sla-policy
   */
  async get(slaPolicyId: number): Promise<ZendeskSlaPolicy> {
    const response = await this.client.get<ZendeskSlaPolicyResponse>(`/slas/policies/${slaPolicyId}.json`);
    return response.sla_policy;
  }

  /**
   * Create a new SLA policy
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/sla_policies/#create-sla-policy
   */
  async create(data: CreateSlaPolicyRequest): Promise<ZendeskSlaPolicy> {
    const response = await this.client.post<ZendeskSlaPolicyResponse>('/slas/policies.json', data);
    return response.sla_policy;
  }

  /**
   * Update an SLA policy
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/sla_policies/#update-sla-policy
   */
  async update(slaPolicyId: number, data: UpdateSlaPolicyRequest): Promise<ZendeskSlaPolicy> {
    const response = await this.client.put<ZendeskSlaPolicyResponse>(`/slas/policies/${slaPolicyId}.json`, data);
    return response.sla_policy;
  }

  /**
   * Delete an SLA policy
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/sla_policies/#delete-sla-policy
   */
  async delete(slaPolicyId: number): Promise<void> {
    await this.client.delete(`/slas/policies/${slaPolicyId}.json`);
  }

  /**
   * Reorder SLA policies
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/sla_policies/#reorder-sla-policies
   */
  async reorder(slaPolicyIds: number[]): Promise<void> {
    await this.client.put('/slas/policies/reorder.json', { sla_policy_ids: slaPolicyIds });
  }

  /**
   * Get SLA policy filter definitions
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/sla_policies/#retrieve-supported-filter-definition-items
   */
  async getFilterDefinitions(): Promise<{ definitions: { conditions_all: unknown[]; conditions_any: unknown[] } }> {
    return this.client.get('/slas/policies/definitions.json');
  }
}

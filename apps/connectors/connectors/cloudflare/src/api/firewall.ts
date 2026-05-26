import type { CloudflareClient } from './client';
import type { FirewallRule, CreateFirewallRuleParams, FirewallFilter, WAFRule, CloudflareResponse } from '../types';

export class FirewallApi {
  constructor(private client: CloudflareClient) {}

  // ============================================
  // Firewall Rules
  // ============================================

  /**
   * List firewall rules for a zone
   */
  async listRules(
    zoneId: string,
    params?: {
      page?: number;
      per_page?: number;
      id?: string;
      description?: string;
      action?: string;
      paused?: boolean;
    }
  ): Promise<CloudflareResponse<FirewallRule[]>> {
    return this.client.get<FirewallRule[]>(`/zones/${zoneId}/firewall/rules`, params);
  }

  /**
   * Get a specific firewall rule
   */
  async getRule(zoneId: string, ruleId: string): Promise<FirewallRule> {
    const response = await this.client.get<FirewallRule>(`/zones/${zoneId}/firewall/rules/${ruleId}`);
    return response.result;
  }

  /**
   * Create firewall rules
   */
  async createRules(zoneId: string, rules: CreateFirewallRuleParams[]): Promise<FirewallRule[]> {
    const response = await this.client.post<FirewallRule[]>(
      `/zones/${zoneId}/firewall/rules`,
      rules as unknown as Record<string, unknown>
    );
    return response.result;
  }

  /**
   * Create a single firewall rule
   */
  async createRule(zoneId: string, rule: CreateFirewallRuleParams): Promise<FirewallRule> {
    const rules = await this.createRules(zoneId, [rule]);
    return rules[0]!;
  }

  /**
   * Update a firewall rule
   */
  async updateRule(zoneId: string, ruleId: string, rule: Partial<CreateFirewallRuleParams>): Promise<FirewallRule> {
    const response = await this.client.put<FirewallRule>(
      `/zones/${zoneId}/firewall/rules/${ruleId}`,
      { id: ruleId, ...rule } as Record<string, unknown>
    );
    return response.result;
  }

  /**
   * Delete a firewall rule
   */
  async deleteRule(zoneId: string, ruleId: string): Promise<void> {
    await this.client.delete(`/zones/${zoneId}/firewall/rules/${ruleId}`);
  }

  /**
   * Delete firewall rules by filter ID
   */
  async deleteRulesByFilter(zoneId: string, filterId: string): Promise<void> {
    await this.client.delete(`/zones/${zoneId}/firewall/rules`, { id: filterId });
  }

  // ============================================
  // Filters
  // ============================================

  /**
   * List filters for a zone
   */
  async listFilters(
    zoneId: string,
    params?: {
      page?: number;
      per_page?: number;
      id?: string;
      expression?: string;
      description?: string;
      paused?: boolean;
      ref?: string;
    }
  ): Promise<CloudflareResponse<FirewallFilter[]>> {
    return this.client.get<FirewallFilter[]>(`/zones/${zoneId}/filters`, params);
  }

  /**
   * Get a specific filter
   */
  async getFilter(zoneId: string, filterId: string): Promise<FirewallFilter> {
    const response = await this.client.get<FirewallFilter>(`/zones/${zoneId}/filters/${filterId}`);
    return response.result;
  }

  /**
   * Create filters
   */
  async createFilters(
    zoneId: string,
    filters: Array<{ expression: string; description?: string; paused?: boolean; ref?: string }>
  ): Promise<FirewallFilter[]> {
    const response = await this.client.post<FirewallFilter[]>(
      `/zones/${zoneId}/filters`,
      filters as unknown as Record<string, unknown>
    );
    return response.result;
  }

  /**
   * Create a single filter
   */
  async createFilter(
    zoneId: string,
    filter: { expression: string; description?: string; paused?: boolean; ref?: string }
  ): Promise<FirewallFilter> {
    const filters = await this.createFilters(zoneId, [filter]);
    return filters[0]!;
  }

  /**
   * Update a filter
   */
  async updateFilter(
    zoneId: string,
    filterId: string,
    filter: { expression?: string; description?: string; paused?: boolean; ref?: string }
  ): Promise<FirewallFilter> {
    const response = await this.client.put<FirewallFilter>(
      `/zones/${zoneId}/filters/${filterId}`,
      { id: filterId, ...filter }
    );
    return response.result;
  }

  /**
   * Delete a filter
   */
  async deleteFilter(zoneId: string, filterId: string): Promise<void> {
    await this.client.delete(`/zones/${zoneId}/filters/${filterId}`);
  }

  // ============================================
  // WAF Rules
  // ============================================

  /**
   * List WAF packages for a zone
   */
  async listWafPackages(
    zoneId: string,
    params?: {
      page?: number;
      per_page?: number;
      order?: 'name';
      direction?: 'asc' | 'desc';
      match?: 'any' | 'all';
      name?: string;
    }
  ): Promise<CloudflareResponse<Array<{
    id: string;
    name: string;
    description: string;
    zone_id: string;
    detection_mode: string;
    sensitivity: string;
    action_mode: string;
  }>>> {
    return this.client.get<Array<{
      id: string;
      name: string;
      description: string;
      zone_id: string;
      detection_mode: string;
      sensitivity: string;
      action_mode: string;
    }>>(`/zones/${zoneId}/firewall/waf/packages`, params);
  }

  /**
   * List WAF rule groups in a package
   */
  async listWafGroups(
    zoneId: string,
    packageId: string,
    params?: {
      page?: number;
      per_page?: number;
      order?: 'mode' | 'rules_count';
      direction?: 'asc' | 'desc';
      match?: 'any' | 'all';
      name?: string;
      mode?: string;
    }
  ): Promise<CloudflareResponse<Array<{
    id: string;
    name: string;
    description: string;
    rules_count: number;
    modified_rules_count: number;
    package_id: string;
    mode: string;
    allowed_modes: string[];
  }>>> {
    return this.client.get<Array<{
      id: string;
      name: string;
      description: string;
      rules_count: number;
      modified_rules_count: number;
      package_id: string;
      mode: string;
      allowed_modes: string[];
    }>>(`/zones/${zoneId}/firewall/waf/packages/${packageId}/groups`, params);
  }

  /**
   * List WAF rules in a package
   */
  async listWafRules(
    zoneId: string,
    packageId: string,
    params?: {
      page?: number;
      per_page?: number;
      order?: 'priority' | 'group_id' | 'description';
      direction?: 'asc' | 'desc';
      match?: 'any' | 'all';
      mode?: string;
      priority?: string;
      group_id?: string;
      description?: string;
    }
  ): Promise<CloudflareResponse<WAFRule[]>> {
    return this.client.get<WAFRule[]>(
      `/zones/${zoneId}/firewall/waf/packages/${packageId}/rules`,
      params
    );
  }

  /**
   * Get a specific WAF rule
   */
  async getWafRule(zoneId: string, packageId: string, ruleId: string): Promise<WAFRule> {
    const response = await this.client.get<WAFRule>(
      `/zones/${zoneId}/firewall/waf/packages/${packageId}/rules/${ruleId}`
    );
    return response.result;
  }

  /**
   * Update a WAF rule mode
   */
  async updateWafRuleMode(
    zoneId: string,
    packageId: string,
    ruleId: string,
    mode: string
  ): Promise<WAFRule> {
    const response = await this.client.patch<WAFRule>(
      `/zones/${zoneId}/firewall/waf/packages/${packageId}/rules/${ruleId}`,
      { mode }
    );
    return response.result;
  }

  // ============================================
  // Access Rules (IP Access Rules)
  // ============================================

  /**
   * List access rules for a zone
   */
  async listAccessRules(
    zoneId: string,
    params?: {
      page?: number;
      per_page?: number;
      mode?: 'block' | 'challenge' | 'whitelist' | 'js_challenge' | 'managed_challenge';
      notes?: string;
      match?: 'any' | 'all';
      order?: 'configuration.target' | 'configuration.value' | 'mode';
      direction?: 'asc' | 'desc';
    }
  ): Promise<CloudflareResponse<Array<{
    id: string;
    paused: boolean;
    mode: string;
    configuration: {
      target: string;
      value: string;
    };
    notes: string;
    allowed_modes: string[];
    created_on: string;
    modified_on: string;
    scope: {
      id: string;
      name: string;
      type: string;
    };
  }>>> {
    return this.client.get<Array<{
      id: string;
      paused: boolean;
      mode: string;
      configuration: {
        target: string;
        value: string;
      };
      notes: string;
      allowed_modes: string[];
      created_on: string;
      modified_on: string;
      scope: {
        id: string;
        name: string;
        type: string;
      };
    }>>(`/zones/${zoneId}/firewall/access_rules/rules`, params);
  }

  /**
   * Create an access rule
   */
  async createAccessRule(
    zoneId: string,
    rule: {
      mode: 'block' | 'challenge' | 'whitelist' | 'js_challenge' | 'managed_challenge';
      configuration: {
        target: 'ip' | 'ip_range' | 'asn' | 'country';
        value: string;
      };
      notes?: string;
    }
  ): Promise<{
    id: string;
    paused: boolean;
    mode: string;
    configuration: {
      target: string;
      value: string;
    };
    notes: string;
  }> {
    const response = await this.client.post<{
      id: string;
      paused: boolean;
      mode: string;
      configuration: {
        target: string;
        value: string;
      };
      notes: string;
    }>(`/zones/${zoneId}/firewall/access_rules/rules`, rule);
    return response.result;
  }

  /**
   * Update an access rule
   */
  async updateAccessRule(
    zoneId: string,
    ruleId: string,
    rule: {
      mode?: 'block' | 'challenge' | 'whitelist' | 'js_challenge' | 'managed_challenge';
      notes?: string;
    }
  ): Promise<{
    id: string;
    mode: string;
    notes: string;
  }> {
    const response = await this.client.patch<{
      id: string;
      mode: string;
      notes: string;
    }>(`/zones/${zoneId}/firewall/access_rules/rules/${ruleId}`, rule);
    return response.result;
  }

  /**
   * Delete an access rule
   */
  async deleteAccessRule(zoneId: string, ruleId: string): Promise<{ id: string }> {
    const response = await this.client.delete<{ id: string }>(
      `/zones/${zoneId}/firewall/access_rules/rules/${ruleId}`
    );
    return response.result;
  }
}

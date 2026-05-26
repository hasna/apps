import { NetlifyClient } from './client';
import type {
  NetlifyConfig,
  User,
  Account,
  Site,
  SiteCreateParams,
  Deploy,
  Form,
  FormSubmission,
  DnsZone,
  DnsRecord,
  DnsRecordCreateParams,
  Build,
  Hook,
  HookCreateParams,
  DeployKey,
  EnvVar,
  EnvVarCreateParams,
  NetlifyFunction,
  Snippet,
  SplitTest,
} from '../types';

export { NetlifyClient };

/**
 * Netlify API wrapper
 */
export class Netlify {
  private client: NetlifyClient;

  constructor(config: NetlifyConfig) {
    this.client = new NetlifyClient(config);
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): NetlifyClient {
    return this.client;
  }

  // ============================================
  // User Methods
  // ============================================

  /**
   * Get the current user
   */
  async getCurrentUser(): Promise<User> {
    return this.client.get<User>('/user');
  }

  // ============================================
  // Account Methods
  // ============================================

  /**
   * List accounts
   */
  async listAccounts(): Promise<Account[]> {
    return this.client.get<Account[]>('/accounts');
  }

  /**
   * Get an account
   */
  async getAccount(accountId: string): Promise<Account> {
    return this.client.get<Account>(`/accounts/${accountId}`);
  }

  // ============================================
  // Site Methods
  // ============================================

  /**
   * List sites
   */
  async listSites(params?: {
    filter?: 'all' | 'owner' | 'guest';
    page?: number;
    per_page?: number;
  }): Promise<Site[]> {
    return this.client.get<Site[]>('/sites', params);
  }

  /**
   * Get a site by ID
   */
  async getSite(siteId: string): Promise<Site> {
    return this.client.get<Site>(`/sites/${siteId}`);
  }

  /**
   * Create a site
   */
  async createSite(params: SiteCreateParams): Promise<Site> {
    const queryParams = params.account_slug ? { account_slug: params.account_slug } : undefined;
    const { account_slug, ...body } = params;
    return this.client.post<Site>('/sites', body, queryParams);
  }

  /**
   * Update a site
   */
  async updateSite(siteId: string, params: Partial<SiteCreateParams>): Promise<Site> {
    return this.client.patch<Site>(`/sites/${siteId}`, params);
  }

  /**
   * Delete a site
   */
  async deleteSite(siteId: string): Promise<void> {
    await this.client.delete(`/sites/${siteId}`);
  }

  // ============================================
  // Deploy Methods
  // ============================================

  /**
   * List deploys for a site
   */
  async listDeploys(siteId: string, params?: {
    page?: number;
    per_page?: number;
    state?: string;
    branch?: string;
  }): Promise<Deploy[]> {
    return this.client.get<Deploy[]>(`/sites/${siteId}/deploys`, params);
  }

  /**
   * Get a deploy
   */
  async getDeploy(deployId: string): Promise<Deploy> {
    return this.client.get<Deploy>(`/deploys/${deployId}`);
  }

  /**
   * Create a new deploy for a site
   */
  async createDeploy(siteId: string, params?: {
    title?: string;
    branch?: string;
    draft?: boolean;
  }): Promise<Deploy> {
    return this.client.post<Deploy>(`/sites/${siteId}/deploys`, params);
  }

  /**
   * Lock a deploy (prevent auto-publishing)
   */
  async lockDeploy(deployId: string): Promise<Deploy> {
    return this.client.post<Deploy>(`/deploys/${deployId}/lock`, {});
  }

  /**
   * Unlock a deploy
   */
  async unlockDeploy(deployId: string): Promise<Deploy> {
    return this.client.post<Deploy>(`/deploys/${deployId}/unlock`, {});
  }

  /**
   * Publish a deploy (make it the production deploy)
   */
  async publishDeploy(siteId: string, deployId: string): Promise<Deploy> {
    return this.client.post<Deploy>(`/sites/${siteId}/deploys/${deployId}/restore`, {});
  }

  /**
   * Cancel a deploy
   */
  async cancelDeploy(deployId: string): Promise<Deploy> {
    return this.client.post<Deploy>(`/deploys/${deployId}/cancel`, {});
  }

  // ============================================
  // Build Methods
  // ============================================

  /**
   * List builds for a site
   */
  async listBuilds(siteId: string, params?: {
    page?: number;
    per_page?: number;
  }): Promise<Build[]> {
    return this.client.get<Build[]>(`/sites/${siteId}/builds`, params);
  }

  /**
   * Get a build
   */
  async getBuild(buildId: string): Promise<Build> {
    return this.client.get<Build>(`/builds/${buildId}`);
  }

  /**
   * Trigger a new build
   */
  async triggerBuild(siteId: string, params?: {
    clear_cache?: boolean;
  }): Promise<Build> {
    return this.client.post<Build>(`/sites/${siteId}/builds`, params);
  }

  // ============================================
  // Form Methods
  // ============================================

  /**
   * List forms for a site
   */
  async listForms(siteId: string): Promise<Form[]> {
    return this.client.get<Form[]>(`/sites/${siteId}/forms`);
  }

  /**
   * Delete a form
   */
  async deleteForm(siteId: string, formId: string): Promise<void> {
    await this.client.delete(`/sites/${siteId}/forms/${formId}`);
  }

  /**
   * List form submissions
   */
  async listFormSubmissions(formId: string, params?: {
    page?: number;
    per_page?: number;
  }): Promise<FormSubmission[]> {
    return this.client.get<FormSubmission[]>(`/forms/${formId}/submissions`, params);
  }

  /**
   * List all submissions for a site
   */
  async listSiteSubmissions(siteId: string, params?: {
    page?: number;
    per_page?: number;
  }): Promise<FormSubmission[]> {
    return this.client.get<FormSubmission[]>(`/sites/${siteId}/submissions`, params);
  }

  /**
   * Delete a submission
   */
  async deleteSubmission(submissionId: string): Promise<void> {
    await this.client.delete(`/submissions/${submissionId}`);
  }

  // ============================================
  // DNS Zone Methods
  // ============================================

  /**
   * List DNS zones
   */
  async listDnsZones(params?: {
    account_slug?: string;
  }): Promise<DnsZone[]> {
    return this.client.get<DnsZone[]>('/dns_zones', params);
  }

  /**
   * Get a DNS zone
   */
  async getDnsZone(zoneId: string): Promise<DnsZone> {
    return this.client.get<DnsZone>(`/dns_zones/${zoneId}`);
  }

  /**
   * Create a DNS zone
   */
  async createDnsZone(params: {
    name: string;
    account_slug?: string;
    site_id?: string;
  }): Promise<DnsZone> {
    return this.client.post<DnsZone>('/dns_zones', params);
  }

  /**
   * Delete a DNS zone
   */
  async deleteDnsZone(zoneId: string): Promise<void> {
    await this.client.delete(`/dns_zones/${zoneId}`);
  }

  /**
   * List DNS records for a zone
   */
  async listDnsRecords(zoneId: string): Promise<DnsRecord[]> {
    return this.client.get<DnsRecord[]>(`/dns_zones/${zoneId}/dns_records`);
  }

  /**
   * Get a DNS record
   */
  async getDnsRecord(zoneId: string, recordId: string): Promise<DnsRecord> {
    return this.client.get<DnsRecord>(`/dns_zones/${zoneId}/dns_records/${recordId}`);
  }

  /**
   * Create a DNS record
   */
  async createDnsRecord(zoneId: string, params: DnsRecordCreateParams): Promise<DnsRecord> {
    return this.client.post<DnsRecord>(`/dns_zones/${zoneId}/dns_records`, params);
  }

  /**
   * Delete a DNS record
   */
  async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    await this.client.delete(`/dns_zones/${zoneId}/dns_records/${recordId}`);
  }

  // ============================================
  // Environment Variable Methods
  // ============================================

  /**
   * List environment variables for a site
   */
  async listEnvVars(accountId: string, siteId: string): Promise<EnvVar[]> {
    return this.client.get<EnvVar[]>(`/accounts/${accountId}/env`, { site_id: siteId });
  }

  /**
   * Get an environment variable
   */
  async getEnvVar(accountId: string, key: string, siteId?: string): Promise<EnvVar> {
    const params = siteId ? { site_id: siteId } : undefined;
    return this.client.get<EnvVar>(`/accounts/${accountId}/env/${key}`, params);
  }

  /**
   * Create or update an environment variable
   */
  async setEnvVar(accountId: string, params: EnvVarCreateParams, siteId?: string): Promise<EnvVar> {
    const queryParams = siteId ? { site_id: siteId } : undefined;
    return this.client.post<EnvVar>(`/accounts/${accountId}/env`, [params], queryParams);
  }

  /**
   * Delete an environment variable
   */
  async deleteEnvVar(accountId: string, key: string, siteId?: string): Promise<void> {
    const params = siteId ? { site_id: siteId } : undefined;
    await this.client.delete(`/accounts/${accountId}/env/${key}`, params);
  }

  // ============================================
  // Hook Methods
  // ============================================

  /**
   * List hooks for a site
   */
  async listHooks(siteId: string): Promise<Hook[]> {
    return this.client.get<Hook[]>(`/sites/${siteId}/hooks`);
  }

  /**
   * Get a hook
   */
  async getHook(hookId: string): Promise<Hook> {
    return this.client.get<Hook>(`/hooks/${hookId}`);
  }

  /**
   * Create a hook
   */
  async createHook(siteId: string, params: Omit<HookCreateParams, 'site_id'>): Promise<Hook> {
    return this.client.post<Hook>(`/sites/${siteId}/hooks`, params);
  }

  /**
   * Update a hook
   */
  async updateHook(hookId: string, params: Partial<HookCreateParams>): Promise<Hook> {
    return this.client.put<Hook>(`/hooks/${hookId}`, params);
  }

  /**
   * Delete a hook
   */
  async deleteHook(hookId: string): Promise<void> {
    await this.client.delete(`/hooks/${hookId}`);
  }

  /**
   * Enable a hook
   */
  async enableHook(hookId: string): Promise<Hook> {
    return this.client.post<Hook>(`/hooks/${hookId}/enable`, {});
  }

  // ============================================
  // Deploy Key Methods
  // ============================================

  /**
   * List deploy keys
   */
  async listDeployKeys(): Promise<DeployKey[]> {
    return this.client.get<DeployKey[]>('/deploy_keys');
  }

  /**
   * Get a deploy key
   */
  async getDeployKey(keyId: string): Promise<DeployKey> {
    return this.client.get<DeployKey>(`/deploy_keys/${keyId}`);
  }

  /**
   * Create a deploy key
   */
  async createDeployKey(): Promise<DeployKey> {
    return this.client.post<DeployKey>('/deploy_keys', {});
  }

  /**
   * Delete a deploy key
   */
  async deleteDeployKey(keyId: string): Promise<void> {
    await this.client.delete(`/deploy_keys/${keyId}`);
  }

  // ============================================
  // Function Methods
  // ============================================

  /**
   * List functions for a site
   */
  async listFunctions(siteId: string): Promise<NetlifyFunction[]> {
    return this.client.get<NetlifyFunction[]>(`/sites/${siteId}/functions`);
  }

  // ============================================
  // Snippet Methods
  // ============================================

  /**
   * List snippets for a site
   */
  async listSnippets(siteId: string): Promise<Snippet[]> {
    return this.client.get<Snippet[]>(`/sites/${siteId}/snippets`);
  }

  /**
   * Get a snippet
   */
  async getSnippet(siteId: string, snippetId: number): Promise<Snippet> {
    return this.client.get<Snippet>(`/sites/${siteId}/snippets/${snippetId}`);
  }

  /**
   * Create a snippet
   */
  async createSnippet(siteId: string, params: Omit<Snippet, 'id' | 'site_id'>): Promise<Snippet> {
    return this.client.post<Snippet>(`/sites/${siteId}/snippets`, params);
  }

  /**
   * Update a snippet
   */
  async updateSnippet(siteId: string, snippetId: number, params: Partial<Snippet>): Promise<Snippet> {
    return this.client.put<Snippet>(`/sites/${siteId}/snippets/${snippetId}`, params);
  }

  /**
   * Delete a snippet
   */
  async deleteSnippet(siteId: string, snippetId: number): Promise<void> {
    await this.client.delete(`/sites/${siteId}/snippets/${snippetId}`);
  }

  // ============================================
  // Split Test Methods
  // ============================================

  /**
   * List split tests for a site
   */
  async listSplitTests(siteId: string): Promise<SplitTest[]> {
    return this.client.get<SplitTest[]>(`/sites/${siteId}/traffic_splits`);
  }

  /**
   * Get a split test
   */
  async getSplitTest(siteId: string, splitTestId: string): Promise<SplitTest> {
    return this.client.get<SplitTest>(`/sites/${siteId}/traffic_splits/${splitTestId}`);
  }

  /**
   * Create a split test
   */
  async createSplitTest(siteId: string, params: {
    branch_tests: Record<string, number>;
  }): Promise<SplitTest> {
    return this.client.post<SplitTest>(`/sites/${siteId}/traffic_splits`, params);
  }

  /**
   * Update a split test
   */
  async updateSplitTest(siteId: string, splitTestId: string, params: {
    branch_tests: Record<string, number>;
  }): Promise<SplitTest> {
    return this.client.put<SplitTest>(`/sites/${siteId}/traffic_splits/${splitTestId}`, params);
  }

  /**
   * Enable a split test
   */
  async enableSplitTest(siteId: string, splitTestId: string): Promise<void> {
    await this.client.post(`/sites/${siteId}/traffic_splits/${splitTestId}/publish`, {});
  }

  /**
   * Disable a split test
   */
  async disableSplitTest(siteId: string, splitTestId: string): Promise<void> {
    await this.client.post(`/sites/${siteId}/traffic_splits/${splitTestId}/unpublish`, {});
  }
}

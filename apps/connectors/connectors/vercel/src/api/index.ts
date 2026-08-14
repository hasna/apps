import { VercelClient } from './client';
import type {
  VercelConfig,
  User,
  Team,
  TeamListResponse,
  Project,
  ProjectListResponse,
  ProjectCreateParams,
  Deployment,
  DeploymentListResponse,
  Domain,
  DomainListResponse,
  DomainConfig,
  EnvironmentVariable,
  EnvListResponse,
  EnvCreateParams,
  Secret,
  SecretListResponse,
  Alias,
  AliasListResponse,
  LogEntry,
} from '../types';

export { VercelClient };

/**
 * Vercel API wrapper
 */
export class Vercel {
  private client: VercelClient;

  constructor(config: VercelConfig) {
    this.client = new VercelClient(config);
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): VercelClient {
    return this.client;
  }

  // ============================================
  // User Methods
  // ============================================

  /**
   * Get the authenticated user
   */
  async getUser(): Promise<{ user: User }> {
    return this.client.get<{ user: User }>('/v2/user');
  }

  // ============================================
  // Team Methods
  // ============================================

  /**
   * List teams
   */
  async listTeams(params?: {
    limit?: number;
    since?: number;
    until?: number;
  }): Promise<TeamListResponse> {
    return this.client.get<TeamListResponse>('/v2/teams', params);
  }

  /**
   * Get a team by ID
   */
  async getTeam(teamId: string): Promise<Team> {
    return this.client.get<Team>(`/v2/teams/${teamId}`);
  }

  // ============================================
  // Project Methods
  // ============================================

  /**
   * List projects
   */
  async listProjects(params?: {
    limit?: number;
    from?: number;
    search?: string;
    gitForkProtection?: boolean;
  }): Promise<ProjectListResponse> {
    return this.client.get<ProjectListResponse>('/v9/projects', params);
  }

  /**
   * Get a project by ID or name
   */
  async getProject(idOrName: string): Promise<Project> {
    return this.client.get<Project>(`/v9/projects/${idOrName}`);
  }

  /**
   * Create a project
   */
  async createProject(params: ProjectCreateParams): Promise<Project> {
    return this.client.post<Project>('/v9/projects', params);
  }

  /**
   * Update a project
   */
  async updateProject(idOrName: string, params: Partial<ProjectCreateParams>): Promise<Project> {
    return this.client.patch<Project>(`/v9/projects/${idOrName}`, params);
  }

  /**
   * Delete a project
   */
  async deleteProject(idOrName: string): Promise<void> {
    await this.client.delete(`/v9/projects/${idOrName}`);
  }

  // ============================================
  // Deployment Methods
  // ============================================

  /**
   * List deployments
   */
  async listDeployments(params?: {
    app?: string;
    projectId?: string;
    limit?: number;
    from?: number;
    since?: number;
    until?: number;
    state?: string;
    target?: 'production' | 'staging';
  }): Promise<DeploymentListResponse> {
    return this.client.get<DeploymentListResponse>('/v6/deployments', params);
  }

  /**
   * Get a deployment by ID or URL
   */
  async getDeployment(idOrUrl: string): Promise<Deployment> {
    return this.client.get<Deployment>(`/v13/deployments/${idOrUrl}`);
  }

  /**
   * Create a deployment
   */
  async createDeployment(params: {
    name: string;
    project?: string;
    target?: 'production' | 'staging';
    gitSource?: {
      type: 'github' | 'gitlab' | 'bitbucket';
      ref: string;
      repoId: string | number;
    };
  }): Promise<Deployment> {
    return this.client.post<Deployment>('/v13/deployments', params);
  }

  /**
   * Cancel a deployment
   */
  async cancelDeployment(deploymentId: string): Promise<Deployment> {
    return this.client.patch<Deployment>(`/v12/deployments/${deploymentId}/cancel`, {});
  }

  /**
   * Delete a deployment
   */
  async deleteDeployment(deploymentId: string): Promise<void> {
    await this.client.delete(`/v13/deployments/${deploymentId}`);
  }

  /**
   * Get deployment events/logs
   */
  async getDeploymentEvents(deploymentId: string, params?: {
    limit?: number;
    since?: number;
    until?: number;
    follow?: boolean;
    direction?: 'forward' | 'backward';
  }): Promise<LogEntry[]> {
    return this.client.get<LogEntry[]>(`/v2/deployments/${deploymentId}/events`, params);
  }

  // ============================================
  // Domain Methods
  // ============================================

  /**
   * List domains for a project
   */
  async listProjectDomains(projectId: string, params?: {
    limit?: number;
    since?: number;
    until?: number;
    production?: boolean;
    target?: string;
  }): Promise<DomainListResponse> {
    return this.client.get<DomainListResponse>(`/v9/projects/${projectId}/domains`, params);
  }

  /**
   * Add a domain to a project
   */
  async addProjectDomain(projectId: string, domain: string, params?: {
    gitBranch?: string;
    redirect?: string;
    redirectStatusCode?: 301 | 302 | 307 | 308;
  }): Promise<Domain> {
    return this.client.post<Domain>(`/v9/projects/${projectId}/domains`, {
      name: domain,
      ...params,
    });
  }

  /**
   * Get a domain configuration
   */
  async getDomainConfig(domain: string): Promise<DomainConfig> {
    return this.client.get<DomainConfig>(`/v6/domains/${domain}/config`);
  }

  /**
   * Remove a domain from a project
   */
  async removeProjectDomain(projectId: string, domain: string): Promise<void> {
    await this.client.delete(`/v9/projects/${projectId}/domains/${domain}`);
  }

  /**
   * Verify a project domain
   */
  async verifyProjectDomain(projectId: string, domain: string): Promise<Domain> {
    return this.client.post<Domain>(`/v9/projects/${projectId}/domains/${domain}/verify`, {});
  }

  /**
   * List all domains
   */
  async listDomains(params?: {
    limit?: number;
    since?: number;
    until?: number;
  }): Promise<DomainListResponse> {
    return this.client.get<DomainListResponse>('/v5/domains', params);
  }

  /**
   * Get a domain
   */
  async getDomain(domain: string): Promise<Domain> {
    return this.client.get<Domain>(`/v5/domains/${domain}`);
  }

  /**
   * Register a domain
   */
  async registerDomain(name: string): Promise<Domain> {
    return this.client.post<Domain>('/v5/domains', { name });
  }

  /**
   * Remove a domain
   */
  async removeDomain(domain: string): Promise<void> {
    await this.client.delete(`/v6/domains/${domain}`);
  }

  // ============================================
  // Environment Variable Methods
  // ============================================

  /**
   * List environment variables for a project
   */
  async listEnvVars(projectId: string): Promise<EnvListResponse> {
    return this.client.get<EnvListResponse>(`/v9/projects/${projectId}/env`);
  }

  /**
   * Get an environment variable
   */
  async getEnvVar(projectId: string, envId: string): Promise<EnvironmentVariable> {
    return this.client.get<EnvironmentVariable>(`/v9/projects/${projectId}/env/${envId}`);
  }

  /**
   * Create an environment variable
   */
  async createEnvVar(projectId: string, params: EnvCreateParams): Promise<EnvironmentVariable> {
    return this.client.post<EnvironmentVariable>(`/v10/projects/${projectId}/env`, params);
  }

  /**
   * Update an environment variable
   */
  async updateEnvVar(projectId: string, envId: string, params: Partial<EnvCreateParams>): Promise<EnvironmentVariable> {
    return this.client.patch<EnvironmentVariable>(`/v9/projects/${projectId}/env/${envId}`, params);
  }

  /**
   * Delete an environment variable
   */
  async deleteEnvVar(projectId: string, envId: string): Promise<void> {
    await this.client.delete(`/v9/projects/${projectId}/env/${envId}`);
  }

  // ============================================
  // Secret Methods (Legacy)
  // ============================================

  /**
   * List secrets
   */
  async listSecrets(params?: {
    limit?: number;
  }): Promise<SecretListResponse> {
    return this.client.get<SecretListResponse>('/v3/secrets', params);
  }

  /**
   * Get a secret by name or ID
   */
  async getSecret(nameOrId: string): Promise<Secret> {
    return this.client.get<Secret>(`/v3/secrets/${nameOrId}`);
  }

  /**
   * Create a secret
   */
  async createSecret(name: string, value: string): Promise<Secret> {
    return this.client.post<Secret>('/v2/secrets', { name, value });
  }

  /**
   * Delete a secret
   */
  async deleteSecret(nameOrId: string): Promise<void> {
    await this.client.delete(`/v2/secrets/${nameOrId}`);
  }

  // ============================================
  // Alias Methods
  // ============================================

  /**
   * List aliases
   */
  async listAliases(params?: {
    projectId?: string;
    limit?: number;
    since?: number;
    until?: number;
  }): Promise<AliasListResponse> {
    return this.client.get<AliasListResponse>('/v4/aliases', params);
  }

  /**
   * Get an alias
   */
  async getAlias(aliasId: string): Promise<Alias> {
    return this.client.get<Alias>(`/v4/aliases/${aliasId}`);
  }

  /**
   * Assign an alias to a deployment
   */
  async assignAlias(deploymentId: string, alias: string): Promise<Alias> {
    return this.client.post<Alias>(`/v2/deployments/${deploymentId}/aliases`, { alias });
  }

  /**
   * Delete an alias
   */
  async deleteAlias(aliasId: string): Promise<void> {
    await this.client.delete(`/v2/aliases/${aliasId}`);
  }
}

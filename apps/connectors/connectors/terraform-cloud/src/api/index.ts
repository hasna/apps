import { TerraformCloudClient } from './client';
import type {
  TerraformCloudConfig,
  JsonApiDocument,
  OrganizationAttributes,
  WorkspaceAttributes,
  RunAttributes,
  VariableAttributes,
  StateVersionAttributes,
  ConfigurationVersionAttributes,
  TeamAttributes,
  ProjectAttributes,
  PolicySetAttributes,
  JsonApiResourceIdentifier,
} from '../types';

export { TerraformCloudClient };

function jsonApiBody(
  type: string,
  attributes?: Record<string, unknown>,
  relationships?: Record<string, { data: JsonApiResourceIdentifier | JsonApiResourceIdentifier[] | null }>,
  id?: string,
) {
  return {
    data: {
      type,
      ...(id ? { id } : {}),
      ...(attributes ? { attributes } : {}),
      ...(relationships ? { relationships } : {}),
    },
  };
}

function workspaceRelationship(workspaceId: string) {
  return {
    workspace: {
      data: { type: 'workspaces', id: workspaceId },
    },
  };
}

function runActionBody(comment?: string) {
  return comment ? { comment } : undefined;
}

/**
 * Terraform Cloud JSON:API v2 wrapper
 */
export class TerraformCloud {
  private client: TerraformCloudClient;

  constructor(config: TerraformCloudConfig) {
    this.client = new TerraformCloudClient(config);
  }

  getClient(): TerraformCloudClient {
    return this.client;
  }

  // ============================================
  // Organizations
  // ============================================

  listOrganizations(params?: { 'page[number]'?: number; 'page[size]'?: number }) {
    return this.client.get<JsonApiDocument<'organizations', OrganizationAttributes>>('/organizations', params);
  }

  getOrganization(organizationName: string) {
    return this.client.get<JsonApiDocument<'organizations', OrganizationAttributes>>(`/organizations/${organizationName}`);
  }

  getOrganizationEntitlements(organizationName: string) {
    return this.client.get<JsonApiDocument>(`/organizations/${organizationName}/entitlement-set`);
  }

  // ============================================
  // Workspaces
  // ============================================

  listWorkspaces(
    organizationName: string,
    params?: Record<string, string | number | boolean | undefined>,
  ) {
    return this.client.get<JsonApiDocument<'workspaces', WorkspaceAttributes>>(
      `/organizations/${organizationName}/workspaces`,
      params,
    );
  }

  getWorkspace(organizationName: string, workspaceName: string) {
    return this.client.get<JsonApiDocument<'workspaces', WorkspaceAttributes>>(
      `/organizations/${organizationName}/workspaces/${workspaceName}`,
    );
  }

  getWorkspaceById(workspaceId: string) {
    return this.client.get<JsonApiDocument<'workspaces', WorkspaceAttributes>>(`/workspaces/${workspaceId}`);
  }

  createWorkspace(organizationName: string, attributes: WorkspaceAttributes) {
    return this.client.post<JsonApiDocument<'workspaces', WorkspaceAttributes>>(
      `/organizations/${organizationName}/workspaces`,
      jsonApiBody('workspaces', attributes as unknown as Record<string, unknown>),
    );
  }

  updateWorkspace(organizationName: string, workspaceName: string, attributes: Partial<WorkspaceAttributes>) {
    return this.client.patch<JsonApiDocument<'workspaces', WorkspaceAttributes>>(
      `/organizations/${organizationName}/workspaces/${workspaceName}`,
      jsonApiBody('workspaces', attributes as unknown as Record<string, unknown>),
    );
  }

  deleteWorkspace(organizationName: string, workspaceName: string) {
    return this.client.delete(`/organizations/${organizationName}/workspaces/${workspaceName}`);
  }

  // ============================================
  // Runs
  // ============================================

  listWorkspaceRuns(workspaceId: string, params?: Record<string, string | number | boolean | undefined>) {
    return this.client.get<JsonApiDocument<'runs', RunAttributes>>(`/workspaces/${workspaceId}/runs`, params);
  }

  listOrganizationRuns(organizationName: string, params?: Record<string, string | number | boolean | undefined>) {
    return this.client.get<JsonApiDocument<'runs', RunAttributes>>(`/organizations/${organizationName}/runs`, params);
  }

  getRun(runId: string) {
    return this.client.get<JsonApiDocument<'runs', RunAttributes>>(`/runs/${runId}`);
  }

  createRun(workspaceId: string, attributes: RunAttributes = {}) {
    return this.client.post<JsonApiDocument<'runs', RunAttributes>>(
      '/runs',
      jsonApiBody('runs', attributes as unknown as Record<string, unknown>, workspaceRelationship(workspaceId)),
    );
  }

  applyRun(runId: string, comment?: string) {
    return this.client.post(`/runs/${runId}/actions/apply`, runActionBody(comment));
  }

  cancelRun(runId: string, comment?: string) {
    return this.client.post(`/runs/${runId}/actions/cancel`, runActionBody(comment));
  }

  discardRun(runId: string, comment?: string) {
    return this.client.post(`/runs/${runId}/actions/discard`, runActionBody(comment));
  }

  // ============================================
  // Variables
  // ============================================

  listWorkspaceVars(workspaceId: string, params?: Record<string, string | number | boolean | undefined>) {
    return this.client.get<JsonApiDocument<'vars', VariableAttributes>>(`/workspaces/${workspaceId}/vars`, params);
  }

  createWorkspaceVar(workspaceId: string, attributes: VariableAttributes) {
    return this.client.post<JsonApiDocument<'vars', VariableAttributes>>(
      `/workspaces/${workspaceId}/vars`,
      jsonApiBody('vars', attributes as unknown as Record<string, unknown>),
    );
  }

  updateVar(workspaceId: string, varId: string, attributes: Partial<VariableAttributes>) {
    return this.client.patch<JsonApiDocument<'vars', VariableAttributes>>(
      `/workspaces/${workspaceId}/vars/${varId}`,
      jsonApiBody('vars', attributes as unknown as Record<string, unknown>, undefined, varId),
    );
  }

  deleteVar(workspaceId: string, varId: string) {
    return this.client.delete(`/workspaces/${workspaceId}/vars/${varId}`);
  }

  // ============================================
  // State Versions
  // ============================================

  listStateVersions(workspaceId: string, params?: Record<string, string | number | boolean | undefined>) {
    return this.client.get<JsonApiDocument<'state-versions', StateVersionAttributes>>(
      `/workspaces/${workspaceId}/state-versions`,
      params,
    );
  }

  getStateVersion(stateVersionId: string) {
    return this.client.get<JsonApiDocument<'state-versions', StateVersionAttributes>>(`/state-versions/${stateVersionId}`);
  }

  createStateVersion(workspaceId: string, attributes?: Partial<StateVersionAttributes>) {
    return this.client.post<JsonApiDocument<'state-versions', StateVersionAttributes>>(
      '/state-versions',
      jsonApiBody(
        'state-versions',
        attributes as unknown as Record<string, unknown>,
        workspaceRelationship(workspaceId),
      ),
    );
  }

  // ============================================
  // Configuration Versions
  // ============================================

  listConfigurationVersions(workspaceId: string, params?: Record<string, string | number | boolean | undefined>) {
    return this.client.get<JsonApiDocument<'configuration-versions', ConfigurationVersionAttributes>>(
      `/workspaces/${workspaceId}/configuration-versions`,
      params,
    );
  }

  getConfigurationVersion(configVersionId: string) {
    return this.client.get<JsonApiDocument<'configuration-versions', ConfigurationVersionAttributes>>(
      `/configuration-versions/${configVersionId}`,
    );
  }

  createConfigurationVersion(workspaceId: string, attributes: Partial<ConfigurationVersionAttributes> = {}) {
    return this.client.post<JsonApiDocument<'configuration-versions', ConfigurationVersionAttributes>>(
      `/workspaces/${workspaceId}/configuration-versions`,
      jsonApiBody(
        'configuration-versions',
        attributes as unknown as Record<string, unknown>,
      ),
    );
  }

  // ============================================
  // Teams
  // ============================================

  listTeams(organizationName: string, params?: Record<string, string | number | boolean | undefined>) {
    return this.client.get<JsonApiDocument<'teams', TeamAttributes>>(
      `/organizations/${organizationName}/teams`,
      params,
    );
  }

  getTeam(teamId: string) {
    return this.client.get<JsonApiDocument<'teams', TeamAttributes>>(`/teams/${teamId}`);
  }

  createTeam(organizationName: string, attributes: TeamAttributes) {
    return this.client.post<JsonApiDocument<'teams', TeamAttributes>>(
      `/organizations/${organizationName}/teams`,
      jsonApiBody('teams', attributes as unknown as Record<string, unknown>),
    );
  }

  updateTeam(teamId: string, attributes: Partial<TeamAttributes>) {
    return this.client.patch<JsonApiDocument<'teams', TeamAttributes>>(
      `/teams/${teamId}`,
      jsonApiBody('teams', attributes as unknown as Record<string, unknown>, undefined, teamId),
    );
  }

  deleteTeam(teamId: string) {
    return this.client.delete(`/teams/${teamId}`);
  }

  // ============================================
  // Projects
  // ============================================

  listProjects(organizationName: string, params?: Record<string, string | number | boolean | undefined>) {
    return this.client.get<JsonApiDocument<'projects', ProjectAttributes>>(
      `/organizations/${organizationName}/projects`,
      params,
    );
  }

  getProject(projectId: string) {
    return this.client.get<JsonApiDocument<'projects', ProjectAttributes>>(`/projects/${projectId}`);
  }

  createProject(organizationName: string, attributes: ProjectAttributes) {
    return this.client.post<JsonApiDocument<'projects', ProjectAttributes>>(
      `/organizations/${organizationName}/projects`,
      jsonApiBody('projects', attributes as unknown as Record<string, unknown>),
    );
  }

  updateProject(projectId: string, attributes: Partial<ProjectAttributes>) {
    return this.client.patch<JsonApiDocument<'projects', ProjectAttributes>>(
      `/projects/${projectId}`,
      jsonApiBody('projects', attributes as unknown as Record<string, unknown>, undefined, projectId),
    );
  }

  deleteProject(projectId: string) {
    return this.client.delete(`/projects/${projectId}`);
  }

  // ============================================
  // Policy Sets
  // ============================================

  listPolicySets(organizationName: string, params?: Record<string, string | number | boolean | undefined>) {
    return this.client.get<JsonApiDocument<'policy-sets', PolicySetAttributes>>(
      `/organizations/${organizationName}/policy-sets`,
      params,
    );
  }

  getPolicySet(policySetId: string) {
    return this.client.get<JsonApiDocument<'policy-sets', PolicySetAttributes>>(`/policy-sets/${policySetId}`);
  }

  createPolicySet(organizationName: string, attributes: PolicySetAttributes) {
    return this.client.post<JsonApiDocument<'policy-sets', PolicySetAttributes>>(
      `/organizations/${organizationName}/policy-sets`,
      jsonApiBody('policy-sets', attributes as unknown as Record<string, unknown>),
    );
  }

  updatePolicySet(policySetId: string, attributes: Partial<PolicySetAttributes>) {
    return this.client.patch<JsonApiDocument<'policy-sets', PolicySetAttributes>>(
      `/policy-sets/${policySetId}`,
      jsonApiBody('policy-sets', attributes as unknown as Record<string, unknown>, undefined, policySetId),
    );
  }

  deletePolicySet(policySetId: string) {
    return this.client.delete(`/policy-sets/${policySetId}`);
  }
}

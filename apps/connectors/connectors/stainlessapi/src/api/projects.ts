import type { StainlessClient } from './client';
import type {
  BranchCreateParams,
  Page,
  Project,
  ProjectBranch,
  ProjectCreateParams,
  ProjectListParams,
  ProjectUpdateParams,
} from '../types';

/**
 * Branches sub-API for a project.
 * https://www.stainless.com/docs/api (/v0/projects/{project}/branches)
 */
export class BranchesApi {
  constructor(
    private readonly client: StainlessClient,
    private readonly defaultProject?: string,
  ) {}

  private resolveProject(project?: string): string {
    const resolved = project || this.defaultProject;
    if (!resolved) {
      throw new Error('A project is required (pass `project` or configure a default project)');
    }
    return resolved;
  }

  async list(project?: string): Promise<Page<ProjectBranch>> {
    const slug = this.resolveProject(project);
    return this.client.get<Page<ProjectBranch>>(
      `/projects/${encodeURIComponent(slug)}/branches`,
    );
  }

  async retrieve(branch: string, project?: string): Promise<ProjectBranch> {
    const slug = this.resolveProject(project);
    return this.client.get<ProjectBranch>(
      `/projects/${encodeURIComponent(slug)}/branches/${encodeURIComponent(branch)}`,
    );
  }

  async create(params: BranchCreateParams, project?: string): Promise<ProjectBranch> {
    const slug = this.resolveProject(project);
    return this.client.post<ProjectBranch>(
      `/projects/${encodeURIComponent(slug)}/branches`,
      params,
    );
  }

  async delete(branch: string, project?: string): Promise<Record<string, unknown>> {
    const slug = this.resolveProject(project);
    return this.client.delete<Record<string, unknown>>(
      `/projects/${encodeURIComponent(slug)}/branches/${encodeURIComponent(branch)}`,
    );
  }

  async rebase(branch: string, project?: string): Promise<ProjectBranch> {
    const slug = this.resolveProject(project);
    return this.client.put<ProjectBranch>(
      `/projects/${encodeURIComponent(slug)}/branches/${encodeURIComponent(branch)}/rebase`,
    );
  }
}

/**
 * Projects API — manage Stainless projects and their branches.
 * https://www.stainless.com/docs/api (/v0/projects)
 */
export class ProjectsApi {
  public readonly branches: BranchesApi;

  constructor(
    private readonly client: StainlessClient,
    private readonly defaultProject?: string,
  ) {
    this.branches = new BranchesApi(client, defaultProject);
  }

  private resolveProject(project?: string): string {
    const resolved = project || this.defaultProject;
    if (!resolved) {
      throw new Error('A project is required (pass `project` or configure a default project)');
    }
    return resolved;
  }

  async create(params: ProjectCreateParams): Promise<Project> {
    return this.client.post<Project>('/projects', params);
  }

  async retrieve(project?: string): Promise<Project> {
    const slug = this.resolveProject(project);
    return this.client.get<Project>(`/projects/${encodeURIComponent(slug)}`);
  }

  async update(params: ProjectUpdateParams, project?: string): Promise<Project> {
    const slug = this.resolveProject(project);
    return this.client.patch<Project>(`/projects/${encodeURIComponent(slug)}`, params);
  }

  async list(params: ProjectListParams = {}): Promise<Page<Project>> {
    return this.client.get<Page<Project>>('/projects', { ...params });
  }
}

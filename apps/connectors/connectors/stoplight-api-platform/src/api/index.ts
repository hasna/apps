import type {
  StoplightConfig,
  Project,
  Branch,
  Member,
  Group,
  Node,
  TableOfContents,
  GetNodeParams,
  PaginationParams,
} from '../types';
import { StoplightClient, DEFAULT_BASE_URL } from './client';

/**
 * High-level wrapper around the Stoplight API.
 *
 * Endpoint coverage mirrors the public Stoplight API surface:
 *   - workspaces/{id}/projects, workspaces/{id}/groups
 *   - projects/{id}, projects/{id}/branches, projects/{id}/members,
 *     projects/{id}/table-of-contents
 *   - projects/{workspace}/{project}/nodes  (OpenAPI/Markdown export)
 *
 * `request()` is exposed as an escape hatch for endpoints not modeled here.
 */
export class Stoplight {
  private readonly client: StoplightClient;

  constructor(config: StoplightConfig) {
    this.client = new StoplightClient(config);
  }

  static fromEnv(): Stoplight {
    const token = process.env.STOPLIGHT_API_TOKEN;
    if (!token) {
      throw new Error('STOPLIGHT_API_TOKEN environment variable is required');
    }
    const baseUrl = process.env.STOPLIGHT_BASE_URL || DEFAULT_BASE_URL;
    return new Stoplight({ token, baseUrl });
  }

  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  getClient(): StoplightClient {
    return this.client;
  }

  private static pageParams(params?: PaginationParams): Record<string, string | number | undefined> {
    if (!params) return {};
    return {
      page: params.page,
      page_size: params.pageSize,
    };
  }

  // ============================================
  // Workspace Methods
  // ============================================

  /** List the projects that belong to a workspace. */
  async listWorkspaceProjects(workspaceId: string, params?: PaginationParams): Promise<Project[]> {
    return this.client.get<Project[]>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`,
      Stoplight.pageParams(params),
    );
  }

  /** List the access groups defined in a workspace. */
  async listWorkspaceGroups(workspaceId: string, params?: PaginationParams): Promise<Group[]> {
    return this.client.get<Group[]>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/groups`,
      Stoplight.pageParams(params),
    );
  }

  // ============================================
  // Project Methods
  // ============================================

  /** Get a single project by its id. */
  async getProject(projectId: string): Promise<Project> {
    return this.client.get<Project>(`/v1/projects/${encodeURIComponent(projectId)}`);
  }

  /** List the branches available in a project. */
  async listProjectBranches(projectId: string, params?: PaginationParams): Promise<Branch[]> {
    return this.client.get<Branch[]>(
      `/v1/projects/${encodeURIComponent(projectId)}/branches`,
      Stoplight.pageParams(params),
    );
  }

  /** List the members (and their roles) of a project. */
  async listProjectMembers(projectId: string, params?: PaginationParams): Promise<Member[]> {
    return this.client.get<Member[]>(
      `/v1/projects/${encodeURIComponent(projectId)}/members`,
      Stoplight.pageParams(params),
    );
  }

  /** Get the rendered table of contents for a project. */
  async getTableOfContents(projectId: string, branch?: string): Promise<TableOfContents> {
    return this.client.get<TableOfContents>(
      `/v1/projects/${encodeURIComponent(projectId)}/table-of-contents`,
      branch ? { branch } : undefined,
    );
  }

  // ============================================
  // Node / Spec Export Methods
  // ============================================

  /**
   * Read a single node (OpenAPI file, JSON Schema model, or Markdown article)
   * from a project. Uses the slug-addressed nodes endpoint:
   *   GET /v1/projects/{workspaceSlug}/{projectSlug}/nodes?uri=...
   */
  async getNode(workspaceSlug: string, projectSlug: string, params: GetNodeParams): Promise<Node> {
    const query: Record<string, string | number | boolean | undefined> = {
      uri: params.uri,
      branch: params.branch,
    };
    if (params.deref !== undefined) {
      query.deref = params.deref === true ? 'bundle' : params.deref === false ? undefined : params.deref;
    }
    return this.client.get<Node>(
      `/v1/projects/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(projectSlug)}/nodes`,
      query,
    );
  }

  /**
   * Convenience helper: fetch a bundled (fully dereferenced) OpenAPI or JSON
   * Schema document for the given node uri.
   */
  async exportBundledNode(workspaceSlug: string, projectSlug: string, uri: string, branch?: string): Promise<Node> {
    return this.getNode(workspaceSlug, projectSlug, { uri, branch, deref: 'bundle' });
  }

  // ============================================
  // Escape Hatch
  // ============================================

  /** Perform an arbitrary request against the Stoplight API. */
  async request<T>(
    path: string,
    options?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'; params?: Record<string, string | number | boolean | undefined>; body?: Record<string, unknown> | unknown[] | string },
  ): Promise<T> {
    return this.client.request<T>(path, options);
  }
}

export { StoplightClient, DEFAULT_BASE_URL } from './client';

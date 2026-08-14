import type { StainlessClient } from './client';
import type {
  Build,
  BuildCompareParams,
  BuildCreateParams,
  BuildDiagnostic,
  BuildListParams,
  Page,
} from '../types';

/**
 * Builds API — create SDK builds and inspect their status.
 * https://www.stainless.com/docs/api (POST/GET /v0/builds)
 */
export class BuildsApi {
  constructor(
    private readonly client: StainlessClient,
    private readonly defaultProject?: string,
  ) {}

  /** Create a new build. */
  async create(params: BuildCreateParams): Promise<Build> {
    const project = params.project || this.defaultProject;
    if (!project) {
      throw new Error('A project is required (pass `project` or configure a default project)');
    }
    return this.client.post<Build>('/builds', { ...params, project });
  }

  /** Retrieve a single build by id. */
  async retrieve(buildId: string): Promise<Build> {
    return this.client.get<Build>(`/builds/${encodeURIComponent(buildId)}`);
  }

  /** List builds for a project. */
  async list(params: BuildListParams = {}): Promise<Page<Build>> {
    const project = params.project || this.defaultProject;
    if (!project) {
      throw new Error('A project is required (pass `project` or configure a default project)');
    }
    return this.client.get<Page<Build>>('/builds', { ...params, project });
  }

  /** Compare two build revisions. */
  async compare(params: BuildCompareParams): Promise<Record<string, unknown>> {
    const project = params.project || this.defaultProject;
    if (!project) {
      throw new Error('A project is required (pass `project` or configure a default project)');
    }
    return this.client.post<Record<string, unknown>>('/builds/compare', { ...params, project });
  }

  /** List diagnostics for a build. */
  async diagnostics(buildId: string): Promise<Page<BuildDiagnostic>> {
    return this.client.get<Page<BuildDiagnostic>>(
      `/builds/${encodeURIComponent(buildId)}/diagnostics`,
    );
  }
}

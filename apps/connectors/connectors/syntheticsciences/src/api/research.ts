import type { SyntheticSciencesClient, HttpMethod } from './client';
import type {
  Project,
  CreateProjectInput,
  LiteratureSearchInput,
  LiteratureResult,
  Experiment,
  CreateExperimentInput,
  GpuJob,
  DispatchGpuJobInput,
  Draft,
  ListParams,
  Paginated,
} from '../types';

/**
 * Research API: projects, literature, experiments, GPU jobs, and drafts.
 * Mirrors the Synthetic Sciences co-scientist REST surface.
 */
export class ResearchApi {
  constructor(private readonly client: SyntheticSciencesClient) {}

  // ---- Projects ----

  listProjects(params: ListParams = {}): Promise<Paginated<Project>> {
    return this.client.get<Paginated<Project>>('/projects', {
      limit: params.limit,
      cursor: params.cursor,
    });
  }

  async getProject(id: string): Promise<Project> {
    if (!id) throw new Error('project id is required');
    return this.client.get<Project>(`/projects/${encodeURIComponent(id)}`);
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    if (!input?.name) throw new Error('project name is required');
    return this.client.post<Project>('/projects', input);
  }

  // ---- Literature ----

  async searchLiterature(input: LiteratureSearchInput): Promise<Paginated<LiteratureResult>> {
    if (!input?.query) throw new Error('search query is required');
    return this.client.post<Paginated<LiteratureResult>>('/literature/search', input);
  }

  // ---- Experiments ----

  listExperiments(params: ListParams & { project_id?: string } = {}): Promise<Paginated<Experiment>> {
    return this.client.get<Paginated<Experiment>>('/experiments', {
      limit: params.limit,
      cursor: params.cursor,
      project_id: params.project_id,
    });
  }

  async createExperiment(input: CreateExperimentInput): Promise<Experiment> {
    if (!input?.project_id) throw new Error('project_id is required');
    if (!input?.hypothesis) throw new Error('hypothesis is required');
    return this.client.post<Experiment>('/experiments', input);
  }

  // ---- GPU Jobs ----

  dispatchGpuJob(input: DispatchGpuJobInput): Promise<GpuJob> {
    return this.client.post<GpuJob>('/gpu-jobs', input);
  }

  async getGpuJob(id: string): Promise<GpuJob> {
    if (!id) throw new Error('gpu job id is required');
    return this.client.get<GpuJob>(`/gpu-jobs/${encodeURIComponent(id)}`);
  }

  // ---- Drafts ----

  listDrafts(params: ListParams & { project_id?: string } = {}): Promise<Paginated<Draft>> {
    return this.client.get<Paginated<Draft>>('/drafts', {
      limit: params.limit,
      cursor: params.cursor,
      project_id: params.project_id,
    });
  }

  // ---- Raw ----

  /**
   * Escape hatch for arbitrary API calls not covered by a typed method.
   */
  raw<T = unknown>(
    method: HttpMethod,
    path: string,
    body?: Record<string, unknown> | unknown[] | string
  ): Promise<T> {
    return this.client.request<T>(path, { method, body });
  }
}

import type {
  YouArtBacker,
  YouArtConfig,
  YouArtFundingCampaign,
  YouArtMembershipTier,
  YouArtOriginal,
  YouArtProject,
  YouArtRawRequestOptions,
} from '../types';
import { YouArtClient, bodyFromArgs, encodePathSegment } from './client';

export class YouArt {
  private readonly client: YouArtClient;

  constructor(config: YouArtConfig) {
    this.client = new YouArtClient(config);
  }

  static fromEnv(): YouArt {
    const apiKey = process.env.YOUART_API_KEY;
    const baseUrl = process.env.YOUART_BASE_URL;
    if (!apiKey) {
      throw new Error('YOUART_API_KEY environment variable is required');
    }
    return new YouArt({ apiKey, baseUrl });
  }

  async listProjects(query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.request('/projects', { params: query });
  }

  async getProject(projectId: string): Promise<YouArtProject> {
    return this.client.request<YouArtProject>(`/projects/${encodePathSegment(projectId)}`);
  }

  async createProject(args: Record<string, unknown> = {}): Promise<YouArtProject> {
    return this.client.request<YouArtProject>('/projects', {
      method: 'POST',
      body: bodyFromArgs(args),
    });
  }

  async listOriginals(query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.request('/originals', { params: query });
  }

  async publishOriginal(originalId: string, args: Record<string, unknown> = {}): Promise<YouArtOriginal> {
    return this.client.request<YouArtOriginal>(`/originals/${encodePathSegment(originalId)}/publish`, {
      method: 'POST',
      body: bodyFromArgs(args),
    });
  }

  async listMembershipTiers(query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.request('/membership-tiers', { params: query });
  }

  async createFundingCampaign(args: Record<string, unknown> = {}): Promise<YouArtFundingCampaign> {
    const body = bodyFromArgs(args);
    if (args.projectId !== undefined && body.project_id === undefined) {
      body.project_id = args.projectId;
    }

    return this.client.request<YouArtFundingCampaign>('/funding-campaigns', {
      method: 'POST',
      body,
    });
  }

  async listBackers(query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.request('/backers', { params: query });
  }

  async rawRequest(options: YouArtRawRequestOptions): Promise<unknown> {
    const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
    return this.client.request(path, {
      method: options.method ?? 'GET',
      params: options.query,
      body: options.body,
      headers: options.headers,
    });
  }

  getClient(): YouArtClient {
    return this.client;
  }
}

export { YouArtClient, bodyFromArgs, encodePathSegment, DEFAULT_BASE_URL } from './client';
export type {
  YouArtConfig,
  YouArtProject,
  YouArtOriginal,
  YouArtMembershipTier,
  YouArtFundingCampaign,
  YouArtBacker,
  YouArtRawRequestOptions,
} from '../types';

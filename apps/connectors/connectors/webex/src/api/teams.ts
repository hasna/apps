import type { WebexClient } from './client';
import type {
  PaginatedResponse,
  WebexTeam,
  WebexTeamCreateRequest,
  WebexTeamUpdateRequest,
  ListOptions,
} from '../types';

export class TeamsApi {
  constructor(private readonly client: WebexClient) {}

  async list(options: ListOptions = {}): Promise<WebexTeam[]> {
    const response = await this.client.get<PaginatedResponse<WebexTeam>>('/teams', {
      max: options.max,
    });
    return response.items ?? [];
  }

  async get(teamId: string): Promise<WebexTeam> {
    return this.client.get<WebexTeam>(`/teams/${encodeURIComponent(teamId)}`);
  }

  async create(team: WebexTeamCreateRequest): Promise<WebexTeam> {
    return this.client.post<WebexTeam>('/teams', team);
  }

  async update(teamId: string, updates: WebexTeamUpdateRequest): Promise<WebexTeam> {
    return this.client.put<WebexTeam>(`/teams/${encodeURIComponent(teamId)}`, updates);
  }

  async delete(teamId: string): Promise<void> {
    await this.client.delete(`/teams/${encodeURIComponent(teamId)}`);
  }
}

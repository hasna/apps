import type { UmamiClient } from './client';
import type {
  PaginationParams,
  TeamCreateParams,
  TeamJoinParams,
  TeamUpdateParams,
  TeamUserParams,
  TeamUserUpdateParams,
} from '../types';

export class TeamsApi {
  constructor(private readonly client: UmamiClient) {}

  async list(params?: PaginationParams): Promise<unknown> {
    return this.client.get('/teams', {
      page: params?.page,
      pageSize: params?.pageSize,
    });
  }

  async get(teamId: string): Promise<unknown> {
    return this.client.get(`/teams/${teamId}`);
  }

  async create(params: TeamCreateParams): Promise<unknown> {
    return this.client.post('/teams', params);
  }

  async update(teamId: string, params: TeamUpdateParams): Promise<unknown> {
    return this.client.post(`/teams/${teamId}`, params);
  }

  async delete(teamId: string): Promise<unknown> {
    return this.client.delete(`/teams/${teamId}`);
  }

  async join(params: TeamJoinParams): Promise<unknown> {
    return this.client.post('/teams/join', params);
  }

  async listUsers(teamId: string, params?: PaginationParams): Promise<unknown> {
    return this.client.get(`/teams/${teamId}/users`, {
      search: params?.search,
      page: params?.page,
      pageSize: params?.pageSize,
    });
  }

  async addUser(teamId: string, params: TeamUserParams): Promise<unknown> {
    return this.client.post(`/teams/${teamId}/users`, params);
  }

  async getUser(teamId: string, userId: string): Promise<unknown> {
    return this.client.get(`/teams/${teamId}/users/${userId}`);
  }

  async updateUser(teamId: string, userId: string, params: TeamUserUpdateParams): Promise<unknown> {
    return this.client.post(`/teams/${teamId}/users/${userId}`, params);
  }

  async removeUser(teamId: string, userId: string): Promise<unknown> {
    return this.client.delete(`/teams/${teamId}/users/${userId}`);
  }
}

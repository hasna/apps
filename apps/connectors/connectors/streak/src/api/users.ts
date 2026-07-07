import type { ConnectorClient } from './client';
import type { StreakTeam, StreakUser } from '../types';

export class TeamsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(): Promise<StreakTeam[]> {
    return this.client.get<StreakTeam[]>('/teams');
  }

  async getUsers(teamKey: string): Promise<StreakTeam> {
    return this.client.get<StreakTeam>(`/teams/${encodeURIComponent(teamKey)}`);
  }
}

export class UsersApi {
  constructor(private readonly client: ConnectorClient) {}

  async me(): Promise<StreakUser> {
    return this.client.get<StreakUser>('/users/me');
  }

  async get(key: string): Promise<StreakUser> {
    return this.client.get<StreakUser>(`/users/${encodeURIComponent(key)}`);
  }
}

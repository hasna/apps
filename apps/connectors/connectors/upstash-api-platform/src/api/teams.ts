import type { UpstashApiPlatformClient } from './client';
import type { CreateTeamRequest, Team, TeamMember } from '../types';

export class TeamsApi {
  constructor(private readonly client: UpstashApiPlatformClient) {}

  listTeams(): Promise<Team[]> {
    return this.client.get<Team[]>('/teams');
  }

  createTeam(body: CreateTeamRequest): Promise<Team> {
    return this.client.post<Team>('/team', body);
  }

  getTeamMembers(teamId: string): Promise<TeamMember[]> {
    return this.client.get<TeamMember[]>(`/teams/${encodeURIComponent(teamId)}`);
  }
}

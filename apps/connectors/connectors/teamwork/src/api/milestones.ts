import type { ConnectorClient } from './client';
import { V3, toQuery } from './params';
import type {
  ListParams,
  Milestone,
  MilestoneResponse,
  MilestonesResponse,
} from '../types';

export class MilestonesApi {
  constructor(private readonly client: ConnectorClient) {}

  /** List milestones across the installation. */
  async list(params?: ListParams): Promise<MilestonesResponse> {
    return this.client.get<MilestonesResponse>(`${V3}/milestones.json`, toQuery(params));
  }

  /** List milestones that belong to a project. */
  async listByProject(projectId: number | string, params?: ListParams): Promise<MilestonesResponse> {
    return this.client.get<MilestonesResponse>(`${V3}/projects/${projectId}/milestones.json`, toQuery(params));
  }

  async get(id: number | string): Promise<MilestoneResponse> {
    return this.client.get<MilestoneResponse>(`${V3}/milestones/${id}.json`);
  }
}

export type { Milestone };

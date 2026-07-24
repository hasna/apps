import type {
  ChangeRequestStatus,
  SplitDefinition,
  SplitIoConfig,
  SplitOwner,
  SplitTreatment,
  UserStatus,
} from '../types';
import { SplitIoClient } from './client';

/**
 * Split.io Admin API v2 wrapper
 */
export class SplitIo {
  private readonly client: SplitIoClient;

  constructor(config: SplitIoConfig) {
    this.client = new SplitIoClient(config.apiKey);
  }

  static fromEnv(): SplitIo {
    const apiKey = process.env.SPLIT_IO_API_KEY;
    if (!apiKey) {
      throw new Error('SPLIT_IO_API_KEY environment variable is required');
    }
    return new SplitIo({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): SplitIoClient {
    return this.client;
  }

  // Workspaces
  async listWorkspaces(params: { limit?: number; offset?: number; name?: string } = {}) {
    return this.client.get('/workspaces', params);
  }

  // Environments
  async listEnvironments(workspaceId: string) {
    return this.client.get(`/environments/ws/${encodeURIComponent(workspaceId)}`);
  }

  async createEnvironment(
    workspaceId: string,
    body: { name: string; production?: boolean; type?: string },
  ) {
    return this.client.post(`/environments/ws/${encodeURIComponent(workspaceId)}`, body);
  }

  async deleteEnvironment(workspaceId: string, environmentName: string) {
    return this.client.delete(
      `/environments/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(environmentName)}`,
    );
  }

  // Traffic types
  async listTrafficTypes(workspaceId: string) {
    return this.client.get(`/trafficTypes/ws/${encodeURIComponent(workspaceId)}`);
  }

  async createTrafficType(
    workspaceId: string,
    body: { name: string; displayAttributeId?: string },
  ) {
    return this.client.post(`/trafficTypes/ws/${encodeURIComponent(workspaceId)}`, body);
  }

  async deleteTrafficType(trafficTypeId: string) {
    return this.client.delete(`/trafficTypes/${encodeURIComponent(trafficTypeId)}`);
  }

  // Splits
  async listSplits(
    workspaceId: string,
    params: {
      limit?: number;
      offset?: number;
      trafficTypeName?: string;
      tags?: string[];
      archived?: boolean;
    } = {},
  ) {
    const { tags, ...rest } = params;
    return this.client.get(`/splits/ws/${encodeURIComponent(workspaceId)}`, {
      ...rest,
      tag: tags,
    });
  }

  async getSplit(workspaceId: string, splitName: string) {
    return this.client.get(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(splitName)}`,
    );
  }

  async createSplit(
    workspaceId: string,
    trafficTypeId: string,
    body: {
      name: string;
      description?: string;
      rolloutStatusId?: string;
      owners?: SplitOwner[];
      tags?: string[];
    },
  ) {
    const payload = {
      name: body.name,
      description: body.description,
      rolloutStatusId: body.rolloutStatusId,
      owners: body.owners,
      tags: body.tags?.map(tag => ({ name: tag })),
    };
    return this.client.post(
      `/splits/ws/${encodeURIComponent(workspaceId)}/trafficTypes/${encodeURIComponent(trafficTypeId)}`,
      payload,
    );
  }

  async updateSplitDescription(workspaceId: string, splitName: string, description: string) {
    return this.client.put(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(splitName)}/updateDescription`,
      { description },
    );
  }

  async deleteSplit(workspaceId: string, splitName: string) {
    return this.client.delete(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(splitName)}`,
    );
  }

  async getSplitDefinition(workspaceId: string, splitName: string, environmentName: string) {
    return this.client.get(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(splitName)}/environments/${encodeURIComponent(environmentName)}`,
    );
  }

  async createSplitDefinition(
    workspaceId: string,
    splitName: string,
    environmentName: string,
    body: SplitDefinition,
  ) {
    return this.client.post(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(splitName)}/environments/${encodeURIComponent(environmentName)}`,
      body,
    );
  }

  async updateSplitDefinition(
    workspaceId: string,
    splitName: string,
    environmentName: string,
    definition: SplitDefinition,
    comment?: string,
  ) {
    return this.client.put(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(splitName)}/environments/${encodeURIComponent(environmentName)}`,
      { ...definition, comment },
    );
  }

  async killSplit(workspaceId: string, splitName: string, environmentName: string) {
    return this.client.put(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(splitName)}/environments/${encodeURIComponent(environmentName)}/kill`,
    );
  }

  async restoreSplit(workspaceId: string, splitName: string, environmentName: string) {
    return this.client.put(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(splitName)}/environments/${encodeURIComponent(environmentName)}/restore`,
    );
  }

  async deleteSplitDefinition(workspaceId: string, splitName: string, environmentName: string) {
    return this.client.delete(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(splitName)}/environments/${encodeURIComponent(environmentName)}`,
    );
  }

  // Segments
  async listSegments(
    workspaceId: string,
    params: { limit?: number; offset?: number; name?: string } = {},
  ) {
    return this.client.get(`/segments/ws/${encodeURIComponent(workspaceId)}`, params);
  }

  async createSegment(
    workspaceId: string,
    trafficTypeName: string,
    body: { name: string; description?: string },
  ) {
    return this.client.post(
      `/segments/ws/${encodeURIComponent(workspaceId)}/trafficTypes/${encodeURIComponent(trafficTypeName)}`,
      body,
    );
  }

  async deleteSegment(workspaceId: string, segmentName: string) {
    return this.client.delete(
      `/segments/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(segmentName)}`,
    );
  }

  async getSegmentKeys(
    segmentName: string,
    environmentName: string,
    params: { offset?: number; limit?: number } = {},
  ) {
    return this.client.get(
      `/segments/${encodeURIComponent(environmentName)}/${encodeURIComponent(segmentName)}/keys`,
      params,
    );
  }

  async addKeysToSegment(
    segmentName: string,
    environmentName: string,
    keys: string[],
    comment?: string,
    replace = false,
  ) {
    return this.client.put(
      `/segments/${encodeURIComponent(environmentName)}/${encodeURIComponent(segmentName)}/uploadKeys`,
      { keys, comment },
      { replace },
    );
  }

  async removeKeysFromSegment(segmentName: string, environmentName: string, keys: string[]) {
    return this.client.put(
      `/segments/${encodeURIComponent(environmentName)}/${encodeURIComponent(segmentName)}/removeKeys`,
      { keys },
    );
  }

  // Tags
  async listTags(workspaceId: string, params: { tagName?: string } = {}) {
    return this.client.get(`/tags/ws/${encodeURIComponent(workspaceId)}`, params);
  }

  // Metrics
  async listMetrics(workspaceId: string, params: { limit?: number; offset?: number } = {}) {
    return this.client.get(`/metrics/ws/${encodeURIComponent(workspaceId)}`, params);
  }

  async createMetric(workspaceId: string, metric: Record<string, unknown>) {
    return this.client.post(`/metrics/ws/${encodeURIComponent(workspaceId)}`, metric);
  }

  async deleteMetric(workspaceId: string, metricId: string) {
    return this.client.delete(
      `/metrics/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(metricId)}`,
    );
  }

  // Change requests
  async listChangeRequests(params: {
    workspaceId?: string;
    status?: ChangeRequestStatus;
    limit?: number;
    offset?: number;
  } = {}) {
    return this.client.get('/changeRequests', params);
  }

  async getChangeRequest(id: string) {
    return this.client.get(`/changeRequests/${encodeURIComponent(id)}`);
  }

  async approveChangeRequest(id: string, comment?: string) {
    return this.updateChangeRequestStatus(id, 'APPROVED', comment);
  }

  async declineChangeRequest(id: string, comment?: string) {
    return this.updateChangeRequestStatus(id, 'REJECTED', comment);
  }

  private async updateChangeRequestStatus(
    id: string,
    status: 'APPROVED' | 'REJECTED' | 'WITHDRAWN',
    comment?: string,
  ) {
    const body = new URLSearchParams({ status });
    if (comment) {
      body.set('comment', comment);
    }
    return this.client.put(`/changeRequests/${encodeURIComponent(id)}`, body);
  }

  // Attributes schema
  async listAttributes(workspaceId: string, trafficTypeId: string) {
    return this.client.get(
      `/trafficTypes/${encodeURIComponent(trafficTypeId)}/schema/ws/${encodeURIComponent(workspaceId)}`,
    );
  }

  // Groups
  async listGroups(params: { limit?: number; offset?: number } = {}) {
    return this.client.get('/groups', params);
  }

  // Users
  async listUsers(params: { limit?: number; offset?: number; status?: UserStatus } = {}) {
    return this.client.get('/users', params);
  }

  /**
   * Validate credentials by listing workspaces
   */
  async validate(): Promise<{ valid: boolean }> {
    try {
      await this.listWorkspaces({ limit: 1 });
      return { valid: true };
    } catch {
      return { valid: false };
    }
  }
}

export { SplitIoClient } from './client';

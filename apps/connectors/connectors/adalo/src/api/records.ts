import type { ConnectorClient } from './client';
import type { AdaloRecord, RecordCreateParams, RecordUpdateParams, ListParams, RecordsResponse } from '../types';

export class RecordsApi {
  constructor(private readonly client: ConnectorClient) {}

  private getAppId(appId?: string): string {
    const id = appId || this.client.appId;
    if (!id) {
      throw new Error('App ID is required. Set ADALO_APP_ID or pass --app-id.');
    }
    return id;
  }

  async list(collectionId: string, params?: ListParams, appId?: string): Promise<RecordsResponse> {
    const aid = this.getAppId(appId);
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.offset !== undefined) queryParams.offset = params.offset;
    if (params?.limit !== undefined) queryParams.limit = params.limit;
    if (params?.filterKey) queryParams.filterKey = params.filterKey;
    if (params?.filterValue !== undefined) queryParams.filterValue = params.filterValue;
    return this.client.get<RecordsResponse>(`/apps/${aid}/collections/${collectionId}`, queryParams);
  }

  async get(collectionId: string, recordId: number, appId?: string): Promise<AdaloRecord> {
    const aid = this.getAppId(appId);
    return this.client.get<AdaloRecord>(`/apps/${aid}/collections/${collectionId}/${recordId}`);
  }

  async create(collectionId: string, params: RecordCreateParams, appId?: string): Promise<AdaloRecord> {
    const aid = this.getAppId(appId);
    return this.client.post<AdaloRecord>(`/apps/${aid}/collections/${collectionId}`, params);
  }

  async update(collectionId: string, recordId: number, params: RecordUpdateParams, appId?: string): Promise<AdaloRecord> {
    const aid = this.getAppId(appId);
    return this.client.put<AdaloRecord>(`/apps/${aid}/collections/${collectionId}/${recordId}`, params);
  }

  async delete(collectionId: string, recordId: number, appId?: string): Promise<void> {
    const aid = this.getAppId(appId);
    await this.client.delete(`/apps/${aid}/collections/${collectionId}/${recordId}`);
  }
}

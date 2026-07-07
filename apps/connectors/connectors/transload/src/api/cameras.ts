import type { ConnectorClient } from './client';
import type { CameraListResponse, ListParams } from '../types';

export class CamerasApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<CameraListResponse> {
    return this.client.get<CameraListResponse>('/cameras', params);
  }
}

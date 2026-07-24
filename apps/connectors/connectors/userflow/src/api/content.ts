import type { UserflowClient } from './client';
import type { CursorListParams } from '../types';
import { encodeResourceId } from './helpers';

export class ChecklistsApi {
  constructor(private readonly client: UserflowClient) {}

  async listChecklists(params: CursorListParams = {}): Promise<unknown> {
    return this.client.get('/v2/checklists', params);
  }

  async getChecklist(id: string): Promise<unknown> {
    return this.client.get(`/v2/checklists/${encodeResourceId(id)}`);
  }
}

export class ResourceCentersApi {
  constructor(private readonly client: UserflowClient) {}

  async listResourceCenters(params: CursorListParams = {}): Promise<unknown> {
    return this.client.get('/v2/resource_centers', params);
  }

  async getResourceCenter(id: string): Promise<unknown> {
    return this.client.get(`/v2/resource_centers/${encodeResourceId(id)}`);
  }
}

export class LaunchersApi {
  constructor(private readonly client: UserflowClient) {}

  async listLaunchers(params: CursorListParams = {}): Promise<unknown> {
    return this.client.get('/v2/launchers', params);
  }

  async getLauncher(id: string): Promise<unknown> {
    return this.client.get(`/v2/launchers/${encodeResourceId(id)}`);
  }
}

export class BannersApi {
  constructor(private readonly client: UserflowClient) {}

  async listBanners(params: CursorListParams = {}): Promise<unknown> {
    return this.client.get('/v2/banners', params);
  }

  async getBanner(id: string): Promise<unknown> {
    return this.client.get(`/v2/banners/${encodeResourceId(id)}`);
  }
}

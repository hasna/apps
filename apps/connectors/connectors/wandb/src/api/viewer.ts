import type { WandbClient } from './client';
import type { ViewerResponse } from '../types';

const VIEWER_QUERY = `query Viewer {
  viewer {
    id
    username
    name
    email
    entity
  }
}`;

export class ViewerApi {
  constructor(private readonly client: WandbClient) {}

  async get() {
    return this.client.query<ViewerResponse>(VIEWER_QUERY);
  }
}

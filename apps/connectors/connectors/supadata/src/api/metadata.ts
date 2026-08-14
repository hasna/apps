import type { SupadataClient } from './client';
import type { MetadataOptions, MediaMetadata } from '../types';

export class MetadataApi {
  constructor(private readonly client: SupadataClient) {}

  async get(options: MetadataOptions): Promise<MediaMetadata> {
    return this.client.get<MediaMetadata>('/metadata', { url: options.url });
  }
}

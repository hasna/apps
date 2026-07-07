import type { TikTokEventsClient } from './client';
import type { JsonRecord } from '../types';

export class OfflineApi {
  constructor(private readonly client: TikTokEventsClient) {}

  async list(options: JsonRecord = {}) {
    return this.client.get('/offline/get/', {
      advertiser_id: this.client.resolveAdvertiserId(options),
      event_set_ids: options.eventSetIds ?? options.event_set_ids,
      name: options.name,
    });
  }

  async create(options: JsonRecord) {
    return this.client.post('/offline/create/', {
      advertiser_id: this.client.resolveAdvertiserId(options),
      name: options.name,
      description: options.description,
      auto_tracking: options.autoTracking ?? options.auto_tracking,
    });
  }

  async update(options: JsonRecord) {
    return this.client.post('/offline/update/', {
      advertiser_id: this.client.resolveAdvertiserId(options),
      event_set_id: options.eventSetId ?? options.event_set_id,
      name: options.name,
      auto_tracking: options.autoTracking ?? options.auto_tracking,
    });
  }

  async delete(options: JsonRecord) {
    return this.client.post('/offline/delete/', {
      advertiser_id: this.client.resolveAdvertiserId(options),
      event_set_id: options.eventSetId ?? options.event_set_id,
    });
  }
}

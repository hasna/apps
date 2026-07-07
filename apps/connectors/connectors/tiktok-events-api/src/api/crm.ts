import type { TikTokEventsClient } from './client';
import type { JsonRecord } from '../types';

export class CrmApi {
  constructor(private readonly client: TikTokEventsClient) {}

  async list(options: JsonRecord = {}) {
    return this.client.get('/crm/list/', {
      advertiser_id: this.client.resolveAdvertiserId(options),
      name: options.name,
      event_set_ids: options.eventSetIds ?? options.event_set_ids,
    });
  }

  async create(options: JsonRecord) {
    return this.client.post('/crm/create/', {
      advertiser_id: this.client.resolveAdvertiserId(options),
      name: options.name,
    });
  }
}

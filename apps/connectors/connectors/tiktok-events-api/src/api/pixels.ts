import type { TikTokEventsClient } from './client';
import type { JsonRecord } from '../types';

export class PixelsApi {
  constructor(private readonly client: TikTokEventsClient) {}

  async list(options: JsonRecord = {}) {
    return this.client.get('/pixel/list/', {
      advertiser_id: this.client.resolveAdvertiserId(options),
      code: options.code,
      pixel_id: options.pixelId ?? options.pixel_id,
      name: options.name,
      order_by: options.orderBy ?? options.order_by,
      filtering: options.filtering,
      available_for_catalog_only: options.availableForCatalogOnly ?? options.available_for_catalog_only,
      page: options.page,
      page_size: options.pageSize ?? options.page_size,
    });
  }

  async create(options: JsonRecord) {
    return this.client.post('/pixel/create/', {
      advertiser_id: this.client.resolveAdvertiserId(options),
      pixel_name: options.pixelName ?? options.pixel_name,
      pixel_category: options.pixelCategory ?? options.pixel_category,
    });
  }

  async update(options: JsonRecord) {
    return this.client.post('/pixel/update/', {
      advertiser_id: this.client.resolveAdvertiserId(options),
      pixel_id: options.pixelId ?? options.pixel_id,
      pixel_name: options.pixelName ?? options.pixel_name ?? '',
      advanced_matching_fields: options.advancedMatchingFields ?? options.advanced_matching_fields,
      automatic_advanced_matching_fields:
        options.automaticAdvancedMatchingFields ?? options.automatic_advanced_matching_fields,
      enable_first_party_cookies: options.enableFirstPartyCookies ?? options.enable_first_party_cookies,
      enable_expanded_data_sharing: options.enableExpandedDataSharing ?? options.enable_expanded_data_sharing,
    });
  }

  async createEvents(options: JsonRecord) {
    return this.client.post('/pixel/event/create/', {
      advertiser_id: this.client.resolveAdvertiserId(options),
      pixel_id: options.pixelId ?? options.pixel_id,
      pixel_events: options.pixelEvents ?? options.pixel_events,
    });
  }

  async updateEvent(options: JsonRecord) {
    return this.client.post('/pixel/event/update/', {
      advertiser_id: this.client.resolveAdvertiserId(options),
      event_id: options.eventId ?? options.event_id,
      event_name: options.eventName ?? options.event_name,
      currency: options.currency,
      currency_value: options.currencyValue ?? options.currency_value,
    });
  }

  async deleteEvent(options: JsonRecord) {
    return this.client.post('/pixel/event/delete/', {
      advertiser_id: this.client.resolveAdvertiserId(options),
      event_id: options.eventId ?? options.event_id,
    });
  }

  async getEventStats(options: JsonRecord) {
    return this.client.get('/pixel/event/stats/', {
      advertiser_id: this.client.resolveAdvertiserId(options),
      pixel_ids: options.pixelIds ?? options.pixel_ids,
      date_range: options.dateRange ?? options.date_range,
    });
  }
}

import type { TikTokClient } from './client';
import type { Pixel, PixelCreateParams, PixelUpdateParams, PaginatedData } from '../types';

/**
 * TikTok Pixels API
 * Create and manage pixels for conversion tracking
 */
export class PixelsApi {
  constructor(private readonly client: TikTokClient) {}

  /**
   * List pixels
   * GET /pixel/list/
   */
  async list(advertiserId: string, params?: {
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<Pixel>> {
    return this.client.get<PaginatedData<Pixel>>('/pixel/list/', {
      advertiser_id: advertiserId,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Get a single pixel by ID
   */
  async get(advertiserId: string, pixelId: string): Promise<Pixel> {
    const response = await this.list(advertiserId);
    const pixel = response.list.find(p => p.pixel_id === pixelId);
    if (!pixel) {
      throw new Error(`Pixel ${pixelId} not found`);
    }
    return pixel;
  }

  /**
   * Create a pixel
   * POST /pixel/create/
   */
  async create(params: PixelCreateParams): Promise<{ pixel_id: string; pixel_code: string }> {
    return this.client.post<{ pixel_id: string; pixel_code: string }>('/pixel/create/', params);
  }

  /**
   * Update a pixel
   * POST /pixel/update/
   */
  async update(params: PixelUpdateParams): Promise<{ pixel_id: string }> {
    return this.client.post<{ pixel_id: string }>('/pixel/update/', params);
  }

  /**
   * Get pixel code snippet
   * GET /pixel/code/
   */
  async getCode(advertiserId: string, pixelId: string): Promise<{
    pixel_id: string;
    pixel_code: string;
    base_code: string;
  }> {
    return this.client.get('/pixel/code/', {
      advertiser_id: advertiserId,
      pixel_id: pixelId,
    });
  }

  /**
   * List pixel events
   * GET /pixel/event/get/
   */
  async listEvents(advertiserId: string, pixelId: string, params?: {
    start_date?: string;
    end_date?: string;
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<{
    event_name: string;
    event_count: number;
    last_received_time: string;
    source: string;
  }>> {
    return this.client.get('/pixel/event/get/', {
      advertiser_id: advertiserId,
      pixel_id: pixelId,
      start_date: params?.start_date,
      end_date: params?.end_date,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Get pixel stats
   * GET /pixel/stats/
   */
  async getStats(advertiserId: string, pixelId: string, params?: {
    start_date?: string;
    end_date?: string;
  }): Promise<{
    pixel_id: string;
    total_events: number;
    events_by_type: Array<{
      event_type: string;
      count: number;
    }>;
    events_by_day: Array<{
      date: string;
      count: number;
    }>;
  }> {
    return this.client.get('/pixel/stats/', {
      advertiser_id: advertiserId,
      pixel_id: pixelId,
      start_date: params?.start_date,
      end_date: params?.end_date,
    });
  }

  /**
   * Test pixel connection
   * POST /pixel/test/
   */
  async test(advertiserId: string, pixelId: string, url: string): Promise<{
    pixel_id: string;
    test_status: 'SUCCESS' | 'FAILED';
    message?: string;
    events_detected?: string[];
  }> {
    return this.client.post('/pixel/test/', {
      advertiser_id: advertiserId,
      pixel_id: pixelId,
      test_url: url,
    });
  }

  // ============================================
  // Event Rules
  // ============================================

  /**
   * List pixel event rules
   * GET /pixel/event/rule/get/
   */
  async listEventRules(advertiserId: string, pixelId: string): Promise<{
    list: Array<{
      rule_id: string;
      rule_name: string;
      event_type: string;
      trigger_type: string;
      status: string;
      create_time: string;
    }>;
  }> {
    return this.client.get('/pixel/event/rule/get/', {
      advertiser_id: advertiserId,
      pixel_id: pixelId,
    });
  }

  /**
   * Create pixel event rule
   * POST /pixel/event/rule/create/
   */
  async createEventRule(params: {
    advertiser_id: string;
    pixel_id: string;
    rule_name: string;
    event_type: string;
    trigger_type: 'URL_CONTAINS' | 'URL_EQUALS' | 'CSS_SELECTOR' | 'ELEMENT_CLICK';
    trigger_value: string;
  }): Promise<{ rule_id: string }> {
    return this.client.post<{ rule_id: string }>('/pixel/event/rule/create/', params);
  }

  /**
   * Delete pixel event rule
   * POST /pixel/event/rule/delete/
   */
  async deleteEventRule(advertiserId: string, pixelId: string, ruleId: string): Promise<{ rule_id: string }> {
    return this.client.post('/pixel/event/rule/delete/', {
      advertiser_id: advertiserId,
      pixel_id: pixelId,
      rule_id: ruleId,
    });
  }
}

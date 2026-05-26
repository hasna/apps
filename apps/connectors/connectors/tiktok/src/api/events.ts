import type { TikTokClient } from './client';
import type { Event, EventTrackParams, BatchEventParams, EventType, EventProperties, EventUser } from '../types';

/**
 * TikTok Events API
 * Server-side event tracking for conversions (Events API)
 */
export class EventsApi {
  constructor(private readonly client: TikTokClient) {}

  /**
   * Track a single event
   * POST /pixel/track/
   */
  async track(params: EventTrackParams): Promise<{
    code: number;
    message: string;
    data: {
      events_received: number;
      events_processed: number;
    };
  }> {
    const event: Event = {
      event: params.event,
      event_time: params.timestamp || Math.floor(Date.now() / 1000),
      event_id: params.event_id,
      user: params.user || {},
      properties: params.properties,
      page: params.context?.page,
      test_event_code: params.test_event_code,
    };

    return this.client.post('/pixel/track/', {
      pixel_code: params.pixel_code,
      event: params.event,
      event_id: params.event_id,
      timestamp: event.event_time.toString(),
      context: params.context,
      properties: params.properties,
      ...(params.user && { user: params.user }),
      test_event_code: params.test_event_code,
    });
  }

  /**
   * Track multiple events in a batch
   * POST /pixel/batch/
   */
  async trackBatch(params: BatchEventParams): Promise<{
    code: number;
    message: string;
    data: {
      events_received: number;
      events_processed: number;
      failed_events?: Array<{
        event_index: number;
        error_code: number;
        error_message: string;
      }>;
    };
  }> {
    return this.client.post('/pixel/batch/', {
      pixel_code: params.pixel_code,
      batch: params.batch,
      test_event_code: params.test_event_code,
    });
  }

  /**
   * Track a page view event
   */
  async trackPageView(params: {
    pixel_code: string;
    page_url: string;
    page_referrer?: string;
    user?: EventUser;
    test_event_code?: string;
  }): Promise<{ events_received: number; events_processed: number }> {
    const response = await this.track({
      pixel_code: params.pixel_code,
      event: 'ViewContent',
      context: {
        page: {
          url: params.page_url,
          referrer: params.page_referrer,
        },
      },
      user: params.user,
      test_event_code: params.test_event_code,
    });
    return response.data;
  }

  /**
   * Track an add to cart event
   */
  async trackAddToCart(params: {
    pixel_code: string;
    content_id?: string;
    content_name?: string;
    content_type?: string;
    quantity?: number;
    price?: number;
    currency?: string;
    value?: number;
    user?: EventUser;
    context?: {
      page?: { url?: string; referrer?: string };
    };
    test_event_code?: string;
  }): Promise<{ events_received: number; events_processed: number }> {
    const properties: EventProperties = {
      currency: params.currency,
      value: params.value,
      contents: params.content_id ? [{
        content_id: params.content_id,
        content_name: params.content_name,
        content_type: params.content_type,
        quantity: params.quantity,
        price: params.price,
      }] : undefined,
    };

    const response = await this.track({
      pixel_code: params.pixel_code,
      event: 'AddToCart',
      properties,
      user: params.user,
      context: params.context,
      test_event_code: params.test_event_code,
    });
    return response.data;
  }

  /**
   * Track a purchase/complete payment event
   */
  async trackPurchase(params: {
    pixel_code: string;
    value: number;
    currency: string;
    contents?: Array<{
      content_id?: string;
      content_name?: string;
      content_type?: string;
      quantity?: number;
      price?: number;
    }>;
    user?: EventUser;
    context?: {
      page?: { url?: string; referrer?: string };
    };
    test_event_code?: string;
  }): Promise<{ events_received: number; events_processed: number }> {
    const properties: EventProperties = {
      currency: params.currency,
      value: params.value,
      contents: params.contents,
    };

    const response = await this.track({
      pixel_code: params.pixel_code,
      event: 'CompletePayment',
      properties,
      user: params.user,
      context: params.context,
      test_event_code: params.test_event_code,
    });
    return response.data;
  }

  /**
   * Track a lead/form submission event
   */
  async trackLead(params: {
    pixel_code: string;
    value?: number;
    currency?: string;
    description?: string;
    user?: EventUser;
    context?: {
      page?: { url?: string; referrer?: string };
    };
    test_event_code?: string;
  }): Promise<{ events_received: number; events_processed: number }> {
    const properties: EventProperties = {
      currency: params.currency,
      value: params.value,
      description: params.description,
    };

    const response = await this.track({
      pixel_code: params.pixel_code,
      event: 'SubmitForm',
      properties,
      user: params.user,
      context: params.context,
      test_event_code: params.test_event_code,
    });
    return response.data;
  }

  /**
   * Track a registration event
   */
  async trackRegistration(params: {
    pixel_code: string;
    status?: string;
    user?: EventUser;
    context?: {
      page?: { url?: string; referrer?: string };
    };
    test_event_code?: string;
  }): Promise<{ events_received: number; events_processed: number }> {
    const properties: EventProperties = {
      status: params.status,
    };

    const response = await this.track({
      pixel_code: params.pixel_code,
      event: 'CompleteRegistration',
      properties,
      user: params.user,
      context: params.context,
      test_event_code: params.test_event_code,
    });
    return response.data;
  }

  /**
   * Track a search event
   */
  async trackSearch(params: {
    pixel_code: string;
    query: string;
    user?: EventUser;
    context?: {
      page?: { url?: string; referrer?: string };
    };
    test_event_code?: string;
  }): Promise<{ events_received: number; events_processed: number }> {
    const properties: EventProperties = {
      query: params.query,
    };

    const response = await this.track({
      pixel_code: params.pixel_code,
      event: 'Search',
      properties,
      user: params.user,
      context: params.context,
      test_event_code: params.test_event_code,
    });
    return response.data;
  }

  /**
   * Track an initiate checkout event
   */
  async trackInitiateCheckout(params: {
    pixel_code: string;
    value?: number;
    currency?: string;
    contents?: Array<{
      content_id?: string;
      content_name?: string;
      quantity?: number;
      price?: number;
    }>;
    user?: EventUser;
    context?: {
      page?: { url?: string; referrer?: string };
    };
    test_event_code?: string;
  }): Promise<{ events_received: number; events_processed: number }> {
    const properties: EventProperties = {
      currency: params.currency,
      value: params.value,
      contents: params.contents,
    };

    const response = await this.track({
      pixel_code: params.pixel_code,
      event: 'InitiateCheckout',
      properties,
      user: params.user,
      context: params.context,
      test_event_code: params.test_event_code,
    });
    return response.data;
  }

  /**
   * Get supported event types
   */
  getSupportedEvents(): EventType[] {
    return [
      'AddPaymentInfo',
      'AddToCart',
      'AddToWishlist',
      'ClickButton',
      'CompletePayment',
      'CompleteRegistration',
      'Contact',
      'Download',
      'InitiateCheckout',
      'PlaceAnOrder',
      'Search',
      'SubmitForm',
      'Subscribe',
      'ViewContent',
    ];
  }
}

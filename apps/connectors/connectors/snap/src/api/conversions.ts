import type { SnapClient } from './client';
import type {
  ConversionEvent,
  ConversionBatchRequest,
  ConversionResponse,
  ConversionEventType,
} from '../types';
import { createHash } from 'crypto';

const CONVERSIONS_API_URL = 'https://tr.snapchat.com/v3';

/**
 * Snapchat Conversions API v3 (CAPI)
 * Send server-side conversion events
 */
export class ConversionsApi {
  constructor(private readonly client: SnapClient) {}

  /**
   * Send a single conversion event
   */
  async sendEvent(event: ConversionEvent): Promise<ConversionResponse> {
    return this.sendEvents([event]);
  }

  /**
   * Send multiple conversion events in batch
   */
  async sendEvents(events: ConversionEvent[], testEventCode?: string): Promise<ConversionResponse> {
    const request: ConversionBatchRequest = {
      data: events,
    };

    if (testEventCode) {
      request.test_event_code = testEventCode;
    }

    // CAPI uses a different endpoint
    return this.client.post<ConversionResponse>(
      `/conversion`,
      request
    );
  }

  /**
   * Send a page view event
   */
  async sendPageView(
    pixelId: string,
    options: {
      email?: string;
      phone?: string;
      ipAddress?: string;
      userAgent?: string;
      pageUrl?: string;
      clickId?: string;
    }
  ): Promise<ConversionResponse> {
    return this.sendEvent(this.buildEvent(pixelId, 'PAGE_VIEW', 'WEB', options));
  }

  /**
   * Send a purchase event
   */
  async sendPurchase(
    pixelId: string,
    options: {
      email?: string;
      phone?: string;
      ipAddress?: string;
      userAgent?: string;
      pageUrl?: string;
      clickId?: string;
      price?: number;
      currency?: string;
      transactionId?: string;
      itemIds?: string[];
      numberOfItems?: number;
      description?: string;
    }
  ): Promise<ConversionResponse> {
    return this.sendEvent(this.buildEvent(pixelId, 'PURCHASE', 'WEB', options));
  }

  /**
   * Send an add to cart event
   */
  async sendAddToCart(
    pixelId: string,
    options: {
      email?: string;
      phone?: string;
      ipAddress?: string;
      userAgent?: string;
      pageUrl?: string;
      clickId?: string;
      price?: number;
      currency?: string;
      itemIds?: string[];
      numberOfItems?: number;
    }
  ): Promise<ConversionResponse> {
    return this.sendEvent(this.buildEvent(pixelId, 'ADD_CART', 'WEB', options));
  }

  /**
   * Send a sign up event
   */
  async sendSignUp(
    pixelId: string,
    options: {
      email?: string;
      phone?: string;
      ipAddress?: string;
      userAgent?: string;
      pageUrl?: string;
      clickId?: string;
      signUpMethod?: string;
    }
  ): Promise<ConversionResponse> {
    return this.sendEvent(this.buildEvent(pixelId, 'SIGN_UP', 'WEB', options));
  }

  /**
   * Send an app install event
   */
  async sendAppInstall(
    pixelId: string,
    appId: string,
    options: {
      mobileAdId?: string;
      idfv?: string;
      email?: string;
      phone?: string;
    }
  ): Promise<ConversionResponse> {
    const event = this.buildEvent(pixelId, 'APP_INSTALL', 'MOBILE_APP', {
      ...options,
      appId,
    });
    return this.sendEvent(event);
  }

  /**
   * Send a custom event
   */
  async sendCustomEvent(
    pixelId: string,
    eventType: 'CUSTOM_EVENT_1' | 'CUSTOM_EVENT_2' | 'CUSTOM_EVENT_3' | 'CUSTOM_EVENT_4' | 'CUSTOM_EVENT_5',
    conversionType: 'WEB' | 'MOBILE_APP' | 'OFFLINE',
    options: {
      email?: string;
      phone?: string;
      ipAddress?: string;
      userAgent?: string;
      pageUrl?: string;
      clickId?: string;
      appId?: string;
      mobileAdId?: string;
      price?: number;
      currency?: string;
      transactionId?: string;
      description?: string;
    }
  ): Promise<ConversionResponse> {
    return this.sendEvent(this.buildEvent(pixelId, eventType, conversionType, options));
  }

  /**
   * Build a conversion event object
   */
  buildEvent(
    pixelId: string,
    eventType: ConversionEventType,
    conversionType: 'WEB' | 'MOBILE_APP' | 'OFFLINE',
    options: {
      email?: string;
      phone?: string;
      ipAddress?: string;
      userAgent?: string;
      mobileAdId?: string;
      idfv?: string;
      pageUrl?: string;
      appId?: string;
      clickId?: string;
      price?: number;
      currency?: string;
      transactionId?: string;
      itemIds?: string[];
      numberOfItems?: number;
      description?: string;
      brands?: string[];
      itemCategory?: string;
      level?: string;
      searchString?: string;
      signUpMethod?: string;
      eventTag?: string;
      dedupId?: string;
    }
  ): ConversionEvent {
    const event: ConversionEvent = {
      pixel_id: pixelId,
      event_type: eventType,
      event_conversion_type: conversionType,
      timestamp: Date.now(),
    };

    // Hash and add user identifiers
    if (options.email) {
      event.hashed_email = this.hashValue(options.email.toLowerCase().trim());
    }

    if (options.phone) {
      event.hashed_phone_number = this.hashValue(this.normalizePhone(options.phone));
    }

    if (options.ipAddress) {
      event.hashed_ip_address = this.hashValue(options.ipAddress);
    }

    if (options.userAgent) {
      event.user_agent = options.userAgent;
    }

    if (options.mobileAdId) {
      event.hashed_mobile_ad_id = this.hashValue(options.mobileAdId.toLowerCase());
    }

    if (options.idfv) {
      event.hashed_idfv = this.hashValue(options.idfv.toLowerCase());
    }

    // Add context
    if (options.pageUrl) {
      event.page_url = options.pageUrl;
    }

    if (options.appId) {
      event.app_id = options.appId;
    }

    if (options.clickId) {
      event.click_id = options.clickId;
    }

    // Add event details
    if (options.price) {
      event.price = options.price;
    }

    if (options.currency) {
      event.currency = options.currency;
    }

    if (options.transactionId) {
      event.transaction_id = options.transactionId;
    }

    if (options.itemIds) {
      event.item_ids = options.itemIds;
    }

    if (options.numberOfItems) {
      event.number_items = options.numberOfItems;
    }

    if (options.description) {
      event.description = options.description;
    }

    if (options.brands) {
      event.brands = options.brands;
    }

    if (options.itemCategory) {
      event.item_category = options.itemCategory;
    }

    if (options.level) {
      event.level = options.level;
    }

    if (options.searchString) {
      event.search_string = options.searchString;
    }

    if (options.signUpMethod) {
      event.sign_up_method = options.signUpMethod;
    }

    if (options.eventTag) {
      event.event_tag = options.eventTag;
    }

    if (options.dedupId) {
      event.client_dedup_id = options.dedupId;
    }

    event.integration = 'connect-snap';

    return event;
  }

  /**
   * Hash a value using SHA-256
   */
  hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /**
   * Normalize phone number (remove non-digits, ensure country code)
   */
  normalizePhone(phone: string): string {
    // Remove all non-digit characters
    let normalized = phone.replace(/\D/g, '');

    // If no country code, assume US (+1)
    if (normalized.length === 10) {
      normalized = '1' + normalized;
    }

    return normalized;
  }

  /**
   * Validate an event before sending
   */
  validateEvent(event: ConversionEvent): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!event.pixel_id) {
      errors.push('pixel_id is required');
    }

    if (!event.event_type) {
      errors.push('event_type is required');
    }

    if (!event.event_conversion_type) {
      errors.push('event_conversion_type is required');
    }

    if (!event.timestamp) {
      errors.push('timestamp is required');
    }

    // Check for at least one user identifier
    const hasIdentifier = event.hashed_email ||
      event.hashed_phone_number ||
      event.hashed_mobile_ad_id ||
      event.hashed_ip_address ||
      event.click_id;

    if (!hasIdentifier) {
      errors.push('At least one user identifier is required (email, phone, mobile_ad_id, ip_address, or click_id)');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get supported event types for CAPI
   */
  getSupportedEventTypes(): ConversionEventType[] {
    return [
      'PAGE_VIEW',
      'VIEW_CONTENT',
      'ADD_CART',
      'ADD_TO_WISHLIST',
      'SIGN_UP',
      'PURCHASE',
      'SAVE',
      'START_CHECKOUT',
      'ADD_BILLING',
      'SEARCH',
      'SUBSCRIBE',
      'AD_CLICK',
      'AD_VIEW',
      'COMPLETE_TUTORIAL',
      'LEVEL_COMPLETE',
      'INVITE',
      'LOGIN',
      'SHARE',
      'RESERVE',
      'ACHIEVEMENT_UNLOCKED',
      'SPENT_CREDITS',
      'RATE',
      'START_TRIAL',
      'LIST_VIEW',
      'APP_OPEN',
      'APP_INSTALL',
      'CUSTOM_EVENT_1',
      'CUSTOM_EVENT_2',
      'CUSTOM_EVENT_3',
      'CUSTOM_EVENT_4',
      'CUSTOM_EVENT_5',
    ];
  }
}

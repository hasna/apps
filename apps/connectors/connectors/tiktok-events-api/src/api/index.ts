import type { JsonRecord, TikTokEventsConfig, TikTokRequestOptions, TikTokTrackOptions } from '../types';
import { TikTokEventsClient } from './client';
import { EventsApi, STANDARD_EVENT_METHODS, standardEventOptions } from './events';
import { PixelsApi } from './pixels';
import { OfflineApi } from './offline';
import { CrmApi } from './crm';
import {
  getAccessToken,
  getAdvertiserId,
  getPixelCode,
  getAppId,
  getOfflineEventSetId,
  getCrmEventSetId,
  getTestEventCode,
  getApiBaseUrl,
} from '../utils/config';

export class TikTokEventsApi {
  private readonly client: TikTokEventsClient;

  public readonly events: EventsApi;
  public readonly pixels: PixelsApi;
  public readonly offline: OfflineApi;
  public readonly crm: CrmApi;

  constructor(config: TikTokEventsConfig) {
    this.client = new TikTokEventsClient(config);
    this.events = new EventsApi(this.client);
    this.pixels = new PixelsApi(this.client);
    this.offline = new OfflineApi(this.client);
    this.crm = new CrmApi(this.client);
  }

  static fromEnv(): TikTokEventsApi {
    const accessToken = getAccessToken();
    if (!accessToken) {
      throw new Error('TIKTOK_ACCESS_TOKEN environment variable is required');
    }

    return new TikTokEventsApi({
      accessToken,
      advertiserId: getAdvertiserId(),
      pixelCode: getPixelCode(),
      appId: getAppId(),
      offlineEventSetId: getOfflineEventSetId(),
      crmEventSetId: getCrmEventSetId(),
      testEventCode: getTestEventCode(),
      baseUrl: getApiBaseUrl(),
    });
  }

  static fromProfile(): TikTokEventsApi {
    return TikTokEventsApi.fromEnv();
  }

  getClient(): TikTokEventsClient {
    return this.client;
  }

  async trackEvent(options: TikTokTrackOptions) {
    return this.events.track(options);
  }

  async trackEvents(options: TikTokTrackOptions) {
    return this.events.track(options);
  }

  async trackWebEvent(options: TikTokTrackOptions) {
    return this.events.trackWeb(options);
  }

  async trackAppEvent(options: TikTokTrackOptions) {
    return this.events.trackApp(options);
  }

  async trackOfflineEvent(options: TikTokTrackOptions) {
    return this.events.trackOffline(options);
  }

  async trackCrmEvent(options: TikTokTrackOptions) {
    return this.events.trackCrm(options);
  }

  async trackTestEvent(options: TikTokTrackOptions) {
    return this.events.trackTest(options);
  }

  async hashUserData(options: { user?: JsonRecord }) {
    return this.events.hashUserData(options.user ?? {});
  }

  async listPixels(options: JsonRecord = {}) {
    return this.pixels.list(options);
  }

  async createPixel(options: JsonRecord) {
    return this.pixels.create(options);
  }

  async updatePixel(options: JsonRecord) {
    return this.pixels.update(options);
  }

  async createPixelEvents(options: JsonRecord) {
    return this.pixels.createEvents(options);
  }

  async updatePixelEvent(options: JsonRecord) {
    return this.pixels.updateEvent(options);
  }

  async deletePixelEvent(options: JsonRecord) {
    return this.pixels.deleteEvent(options);
  }

  async getPixelEventStats(options: JsonRecord) {
    return this.pixels.getEventStats(options);
  }

  async listOfflineEventSets(options: JsonRecord = {}) {
    return this.offline.list(options);
  }

  async createOfflineEventSet(options: JsonRecord) {
    return this.offline.create(options);
  }

  async updateOfflineEventSet(options: JsonRecord) {
    return this.offline.update(options);
  }

  async deleteOfflineEventSet(options: JsonRecord) {
    return this.offline.delete(options);
  }

  async listCrmEventSets(options: JsonRecord = {}) {
    return this.crm.list(options);
  }

  async createCrmEventSet(options: JsonRecord) {
    return this.crm.create(options);
  }

  async rawRequest(options: TikTokRequestOptions) {
    return this.client.request({
      method: options.method,
      path: options.path,
      query: options.query,
      body: options.body,
    });
  }

  async trackAddPaymentInfo(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('AddPaymentInfo', options));
  }

  async trackAddToCart(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('AddToCart', options));
  }

  async trackAddToWishlist(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('AddToWishlist', options));
  }

  async trackApplicationApproval(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('ApplicationApproval', options));
  }

  async trackCompleteRegistration(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('CompleteRegistration', options));
  }

  async trackContact(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('Contact', options));
  }

  async trackCustomizeProduct(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('CustomizeProduct', options));
  }

  async trackDownload(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('Download', options));
  }

  async trackFindLocation(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('FindLocation', options));
  }

  async trackInitiateCheckout(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('InitiateCheckout', options));
  }

  async trackLead(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('Lead', options));
  }

  async trackPurchase(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('Purchase', options));
  }

  async trackSchedule(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('Schedule', options));
  }

  async trackSearch(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('Search', options));
  }

  async trackStartTrial(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('StartTrial', options));
  }

  async trackSubmitApplication(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('SubmitApplication', options));
  }

  async trackSubscribe(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('Subscribe', options));
  }

  async trackViewContent(options: TikTokTrackOptions) {
    return this.events.trackWeb(standardEventOptions('ViewContent', options));
  }
}

export const tiktokEventsApiCommandSpecs = [
  ['trackEvent', 'track-event', 'Send one TikTok Events API 2.0 event. Args: event/eventName, optional eventId, eventTime, eventSource, eventSourceId, user, page, app, ad, lead, properties, limitedDataUse, testEventCode.'],
  ['trackEvents', 'track-events', 'Send multiple TikTok Events API 2.0 events. Args: events, optional eventSource, eventSourceId, testEventCode.'],
  ['trackWebEvent', 'track-web-event', 'Send one web event through Events API 2.0. Args: event/eventName, user, page, ad, properties, eventId, testEventCode.'],
  ['trackAppEvent', 'track-app-event', 'Send one app event through Events API 2.0. Args: event/eventName, appId/eventSourceId, user, app, ad, properties.'],
  ['trackOfflineEvent', 'track-offline-event', 'Send one offline event through Events API 2.0. Args: event/eventName, offlineEventSetId/eventSourceId, user, properties.'],
  ['trackCrmEvent', 'track-crm-event', 'Send one CRM event through Events API 2.0. Args: event/eventName, crmEventSetId/eventSourceId, lead, user, eventId.'],
  ['trackTestEvent', 'track-test-event', 'Send a web test event with test_event_code for TikTok Events Manager diagnostics.'],
  ...STANDARD_EVENT_METHODS.map(([method, , name, description]) => [method, name, `${description} Args: user, page, properties, eventId, value, currency, contentIds, contentType.`] as const),
  ['hashUserData', 'hash-user-data', 'Normalize and SHA-256 hash TikTok customer match keys. Args: user.'],
  ['listPixels', 'list-pixels', 'List TikTok pixels and their event definitions. Args: advertiserId. Optional: code, pixelId, name, orderBy, filtering, availableForCatalogOnly, page, pageSize.'],
  ['createPixel', 'create-pixel', 'Create a TikTok Pixel. Args: advertiserId, pixelName. Optional: pixelCategory.'],
  ['updatePixel', 'update-pixel', 'Update TikTok Pixel settings. Args: advertiserId, pixelId, pixelName. Optional: advancedMatchingFields, automaticAdvancedMatchingFields, enableFirstPartyCookies, enableExpandedDataSharing.'],
  ['createPixelEvents', 'create-pixel-events', 'Create Pixel Events. Args: advertiserId, pixelId, pixelEvents.'],
  ['updatePixelEvent', 'update-pixel-event', 'Update a Pixel Event name/value. Args: advertiserId, eventId, eventName. Optional: currency, currencyValue.'],
  ['deletePixelEvent', 'delete-pixel-event', 'Delete a Pixel Event. Args: advertiserId, eventId.'],
  ['getPixelEventStats', 'get-pixel-event-stats', 'Get Pixel Event statistics. Args: advertiserId, pixelIds, dateRange.'],
  ['listOfflineEventSets', 'list-offline-event-sets', 'List Offline Event sets. Args: advertiserId. Optional: eventSetIds, name.'],
  ['createOfflineEventSet', 'create-offline-event-set', 'Create an Offline Event set. Args: advertiserId, name. Optional: description, autoTracking.'],
  ['updateOfflineEventSet', 'update-offline-event-set', 'Update an Offline Event set. Args: advertiserId, eventSetId. Optional: name, autoTracking.'],
  ['deleteOfflineEventSet', 'delete-offline-event-set', 'Delete an Offline Event set. Args: advertiserId, eventSetId.'],
  ['listCrmEventSets', 'list-crm-event-sets', 'List CRM Event Sets. Args: advertiserId. Optional: name, eventSetIds.'],
  ['createCrmEventSet', 'create-crm-event-set', 'Create a CRM Event Set. Args: advertiserId, name.'],
  ['rawRequest', 'raw-request', 'Call a TikTok Business API endpoint on the configured origin. Args: method, path, query, body.'],
] as const;

export { TikTokEventsClient } from './client';
export { EventsApi, PixelsApi, OfflineApi, CrmApi, STANDARD_EVENT_METHODS };
export {
  buildEvent,
  buildTrackBody,
  hashUserData,
  hashCustomerValue,
  getEventSourceId,
  mergeLegacyContext,
} from './events';

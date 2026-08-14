import { createHash } from 'node:crypto';
import type { TikTokEventsClient } from './client';
import type {
  JsonRecord,
  TikTokEventOptions,
  TikTokEventSource,
  TikTokEventsConfig,
  TikTokTrackOptions,
} from '../types';

const HASHED_CUSTOMER_FIELDS = new Set(['email', 'phone', 'external_id']);

export const STANDARD_EVENT_METHODS = [
  ['trackAddPaymentInfo', 'AddPaymentInfo', 'track-add-payment-info', 'Track TikTok AddPaymentInfo.'],
  ['trackAddToCart', 'AddToCart', 'track-add-to-cart', 'Track TikTok AddToCart.'],
  ['trackAddToWishlist', 'AddToWishlist', 'track-add-to-wishlist', 'Track TikTok AddToWishlist.'],
  ['trackApplicationApproval', 'ApplicationApproval', 'track-application-approval', 'Track TikTok ApplicationApproval.'],
  ['trackCompleteRegistration', 'CompleteRegistration', 'track-complete-registration', 'Track TikTok CompleteRegistration.'],
  ['trackContact', 'Contact', 'track-contact', 'Track TikTok Contact.'],
  ['trackCustomizeProduct', 'CustomizeProduct', 'track-customize-product', 'Track TikTok CustomizeProduct.'],
  ['trackDownload', 'Download', 'track-download', 'Track TikTok Download.'],
  ['trackFindLocation', 'FindLocation', 'track-find-location', 'Track TikTok FindLocation.'],
  ['trackInitiateCheckout', 'InitiateCheckout', 'track-initiate-checkout', 'Track TikTok InitiateCheckout.'],
  ['trackLead', 'Lead', 'track-lead', 'Track TikTok Lead.'],
  ['trackPurchase', 'Purchase', 'track-purchase', 'Track TikTok Purchase with order value and content data.'],
  ['trackSchedule', 'Schedule', 'track-schedule', 'Track TikTok Schedule.'],
  ['trackSearch', 'Search', 'track-search', 'Track TikTok Search.'],
  ['trackStartTrial', 'StartTrial', 'track-start-trial', 'Track TikTok StartTrial.'],
  ['trackSubmitApplication', 'SubmitApplication', 'track-submit-application', 'Track TikTok SubmitApplication.'],
  ['trackSubscribe', 'Subscribe', 'track-subscribe', 'Track TikTok Subscribe.'],
  ['trackViewContent', 'ViewContent', 'track-view-content', 'Track TikTok ViewContent.'],
] as const;

export function asRecord(value: unknown): JsonRecord | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return undefined;
}

export function pickString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value.trim());
}

export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  return trimmed.replace(/\D/g, '');
}

export function hashCustomerValue(field: string, value: string): string {
  const trimmed = value.trim();
  if (isSha256Hex(trimmed)) return trimmed.toLowerCase();

  const normalized =
    field === 'email'
      ? trimmed.toLowerCase()
      : field === 'phone'
        ? normalizePhone(trimmed)
        : trimmed;

  return createHash('sha256').update(normalized).digest('hex');
}

export function hashUserData(user: JsonRecord): JsonRecord {
  const output: JsonRecord = {};

  for (const [key, value] of Object.entries(user)) {
    const normalizedKey = key === 'phone_number' ? 'phone' : key;
    if (HASHED_CUSTOMER_FIELDS.has(normalizedKey)) {
      if (Array.isArray(value)) {
        output[normalizedKey] = value.map((item) =>
          typeof item === 'string' ? hashCustomerValue(normalizedKey, item) : item,
        );
      } else if (typeof value === 'string') {
        output[normalizedKey] = hashCustomerValue(normalizedKey, value);
      } else {
        output[normalizedKey] = value;
      }
      continue;
    }
    output[normalizedKey] = value;
  }

  return output;
}

export function normalizeEventTime(value: TikTokEventOptions['eventTime']): number {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    if (/^\d+$/.test(value.trim())) return Number(value.trim());
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

export function mergeLegacyContext(event: TikTokEventOptions): TikTokEventOptions {
  const context = asRecord(event.context);
  if (!context) return event;

  const contextUser = asRecord(context.user);
  const user = asRecord(event.user) ?? {};
  const mergedUser: JsonRecord = { ...contextUser, ...user };

  if (typeof context.ip === 'string' && !('ip' in mergedUser)) mergedUser.ip = context.ip;
  if (typeof context.user_agent === 'string' && !('user_agent' in mergedUser)) {
    mergedUser.user_agent = context.user_agent;
  }

  return {
    ...event,
    user: Object.keys(mergedUser).length > 0 ? mergedUser : event.user,
    page: event.page ?? asRecord(context.page),
    app: event.app ?? asRecord(context.app),
    ad: event.ad ?? asRecord(context.ad),
  };
}

export function buildEvent(options: TikTokEventOptions): JsonRecord {
  const input = mergeLegacyContext(options);
  const eventName = pickString(input.event, input.eventName);
  if (!eventName) throw new Error('TikTok Events API: event or eventName is required.');

  const event: JsonRecord = {
    event: eventName,
    event_time: normalizeEventTime(input.eventTime ?? input.event_time ?? input.timestamp),
  };

  const eventId = pickString(input.eventId, input.event_id);
  if (eventId) event.event_id = eventId;

  const user = asRecord(input.user);
  if (user) event.user = hashUserData(user);

  const properties = asRecord(input.properties);
  if (properties) event.properties = properties;

  const page = asRecord(input.page);
  if (page) event.page = page;

  const app = asRecord(input.app);
  if (app) event.app = app;

  const ad = asRecord(input.ad);
  if (ad) event.ad = ad;

  const lead = asRecord(input.lead);
  if (lead) event.lead = lead;

  const limitedDataUse = input.limitedDataUse ?? input.limited_data_use;
  if (typeof limitedDataUse === 'boolean') event.limited_data_use = limitedDataUse;

  const extra = asRecord(input.extra);
  if (extra) Object.assign(event, extra);

  return event;
}

export function normalizeEventSource(value: unknown): TikTokEventSource {
  if (value === 'app' || value === 'offline' || value === 'crm' || value === 'web') return value;
  return 'web';
}

export function getEventSourceId(
  config: TikTokEventsConfig,
  options: TikTokTrackOptions,
  eventSource: TikTokEventSource,
): string {
  const sourceId = pickString(
    options.eventSourceId,
    options.event_source_id,
    options.pixelCode,
    options.pixel_code,
    options.appId,
    options.app_id,
    options.offlineEventSetId,
    options.offline_event_set_id,
    options.crmEventSetId,
    options.crm_event_set_id,
  );
  if (sourceId) return sourceId;

  if (eventSource === 'web' && config.pixelCode) return config.pixelCode;
  if (eventSource === 'app' && config.appId) return config.appId;
  if (eventSource === 'offline' && config.offlineEventSetId) return config.offlineEventSetId;
  if (eventSource === 'crm' && config.crmEventSetId) return config.crmEventSetId;

  throw new Error(`TikTok Events API: event_source_id is required for ${eventSource} events.`);
}

export function buildTrackBody(
  config: TikTokEventsConfig,
  options: TikTokTrackOptions,
  eventSourceOverride?: TikTokEventSource,
): JsonRecord {
  if (options.body) return options.body;

  const eventSource = eventSourceOverride ?? normalizeEventSource(options.eventSource ?? options.event_source);
  const events = options.events && options.events.length > 0 ? options.events : [options];
  const body: JsonRecord = {
    event_source: eventSource,
    event_source_id: getEventSourceId(config, options, eventSource),
    data: events.map((event) => buildEvent(event)),
  };

  const testEventCode = pickString(options.testEventCode, options.test_event_code, config.testEventCode);
  if (testEventCode) body.test_event_code = testEventCode;

  const topLevel = asRecord(options.topLevel);
  if (topLevel) Object.assign(body, topLevel);

  return body;
}

export function standardEventOptions(event: string, options: TikTokTrackOptions): TikTokTrackOptions {
  const properties: JsonRecord = { ...(asRecord(options.properties) ?? {}) };
  const contentIds = options.extra?.contentIds ?? (options as JsonRecord).contentIds;
  const contentType = options.extra?.contentType ?? (options as JsonRecord).contentType;
  const value = (options as JsonRecord).value;
  const currency = (options as JsonRecord).currency;
  const searchString = (options as JsonRecord).searchString;

  if (contentIds && !('content_ids' in properties)) properties.content_ids = contentIds;
  if (contentType && !('content_type' in properties)) properties.content_type = contentType;
  if (value !== undefined && !('value' in properties)) properties.value = value;
  if (currency && !('currency' in properties)) properties.currency = currency;
  if (searchString && !('search_string' in properties)) properties.search_string = searchString;

  return { ...options, event, properties };
}

export class EventsApi {
  constructor(private readonly client: TikTokEventsClient) {}

  async track(options: TikTokTrackOptions, eventSourceOverride?: TikTokEventSource) {
    return this.client.post('/event/track/', buildTrackBody(this.client.config, options, eventSourceOverride));
  }

  async trackWeb(options: TikTokTrackOptions) {
    return this.track(options, 'web');
  }

  async trackApp(options: TikTokTrackOptions) {
    return this.track(options, 'app');
  }

  async trackOffline(options: TikTokTrackOptions) {
    return this.track(options, 'offline');
  }

  async trackCrm(options: TikTokTrackOptions) {
    return this.track(options, 'crm');
  }

  async trackTest(options: TikTokTrackOptions) {
    return this.track(
      {
        ...options,
        testEventCode: pickString(options.testEventCode, options.test_event_code),
      },
      'web',
    );
  }

  hashUserData(user: JsonRecord): JsonRecord {
    return hashUserData(user);
  }
}

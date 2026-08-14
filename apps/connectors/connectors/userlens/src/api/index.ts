import type {
  GroupBody,
  IdentifyBody,
  RawEventsBody,
  TrackBody,
  UserlensConfig,
} from '../types';
import { DEFAULT_SOURCE } from '../types';
import { UserlensClient } from './client';

/**
 * Userlens events API — identify, group, track, and raw event forwarding.
 */
export class EventsApi {
  constructor(private readonly client: UserlensClient) {}

  async identifyUser(args: {
    userId: string;
    traits?: Record<string, unknown>;
    source?: string;
  }): Promise<unknown> {
    const body: IdentifyBody = {
      type: 'identify',
      userId: args.userId,
      source: args.source ?? DEFAULT_SOURCE,
      traits: args.traits ?? {},
    };
    return this.client.request('/event', { method: 'POST', body });
  }

  async groupUser(args: {
    groupId: string;
    userId: string;
    traits?: Record<string, unknown>;
    source?: string;
  }): Promise<unknown> {
    const body: GroupBody = {
      type: 'group',
      groupId: args.groupId,
      userId: args.userId,
      source: args.source ?? DEFAULT_SOURCE,
    };
    if (args.traits !== undefined) {
      body.traits = args.traits;
    }
    return this.client.request('/event', { method: 'POST', body });
  }

  async trackEvent(args: {
    userId: string;
    event: string;
    properties?: Record<string, unknown>;
    source?: string;
  }): Promise<unknown> {
    const body: TrackBody = {
      type: 'track',
      userId: args.userId,
      event: args.event,
      source: args.source ?? DEFAULT_SOURCE,
    };
    if (args.properties !== undefined) {
      body.properties = args.properties;
    }
    return this.client.request('/event', { method: 'POST', body });
  }

  async forwardRawEvents(args: { events: RawEventsBody['events'] }): Promise<unknown> {
    if (!Array.isArray(args.events)) {
      throw new Error('Userlens: events is required.');
    }
    const body: RawEventsBody = { events: args.events };
    return this.client.request('/raw/event', { method: 'POST', body, useRawBase: true });
  }
}

/**
 * Main Userlens connector class.
 */
export class Userlens {
  private readonly client: UserlensClient;
  public readonly events: EventsApi;

  constructor(config: UserlensConfig) {
    this.client = new UserlensClient(config);
    this.events = new EventsApi(this.client);
  }

  static fromEnv(): Userlens {
    return new Userlens({
      apiKey: process.env.USERLENS_API_KEY,
      eventsBaseUrl: process.env.USERLENS_EVENTS_BASE_URL,
      rawBaseUrl: process.env.USERLENS_RAW_BASE_URL,
    });
  }

  async identifyUser(
    userId: string,
    traits?: Record<string, unknown>,
    source?: string,
  ): Promise<unknown> {
    return this.events.identifyUser({ userId, traits, source });
  }

  async groupUser(
    groupId: string,
    userId: string,
    traits?: Record<string, unknown>,
    source?: string,
  ): Promise<unknown> {
    return this.events.groupUser({ groupId, userId, traits, source });
  }

  async trackEvent(
    userId: string,
    event: string,
    properties?: Record<string, unknown>,
    source?: string,
  ): Promise<unknown> {
    return this.events.trackEvent({ userId, event, properties, source });
  }

  async forwardRawEvents(events: RawEventsBody['events']): Promise<unknown> {
    return this.events.forwardRawEvents({ events });
  }

  async rawRequest<T = unknown>(options: Parameters<UserlensClient['rawRequest']>[0]): Promise<T> {
    return this.client.rawRequest<T>(options);
  }
}

export { UserlensClient } from './client';

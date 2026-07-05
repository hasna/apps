import type { WebexConfig } from '../types';
import { WebexClient } from './client';
import { RoomsApi } from './rooms';
import { MembershipsApi } from './memberships';
import { MessagesApi } from './messages';
import { PeopleApi } from './people';
import { TeamsApi } from './teams';
import { MeetingsApi } from './meetings';
import { RecordingsApi } from './recordings';
import { WebhooksApi } from './webhooks';

export class Webex {
  private readonly client: WebexClient;

  public readonly rooms: RoomsApi;
  public readonly memberships: MembershipsApi;
  public readonly messages: MessagesApi;
  public readonly people: PeopleApi;
  public readonly teams: TeamsApi;
  public readonly meetings: MeetingsApi;
  public readonly recordings: RecordingsApi;
  public readonly webhooks: WebhooksApi;

  constructor(config: WebexConfig) {
    this.client = new WebexClient(config);
    this.rooms = new RoomsApi(this.client);
    this.memberships = new MembershipsApi(this.client);
    this.messages = new MessagesApi(this.client);
    this.people = new PeopleApi(this.client);
    this.teams = new TeamsApi(this.client);
    this.meetings = new MeetingsApi(this.client);
    this.recordings = new RecordingsApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
  }

  static fromEnv(): Webex {
    const accessToken = process.env.WEBEX_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('WEBEX_ACCESS_TOKEN environment variable is required');
    }
    return new Webex({ accessToken });
  }

  async test(): Promise<unknown> {
    return this.people.me();
  }

  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  getClient(): WebexClient {
    return this.client;
  }
}

export { WebexClient, WEBEX_API_BASE } from './client';
export { RoomsApi } from './rooms';
export { MembershipsApi } from './memberships';
export { MessagesApi } from './messages';
export { PeopleApi } from './people';
export { TeamsApi } from './teams';
export { MeetingsApi } from './meetings';
export { RecordingsApi } from './recordings';
export { WebhooksApi } from './webhooks';

import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { PeopleApi } from './people';
import { PetitionsApi } from './petitions';
import { EventsApi } from './events';
import { FormsApi } from './forms';
import { FundraisingApi } from './fundraising';
import { TagsApi } from './tags';
import { MessagesApi } from './messages';
import { AdvocacyApi } from './advocacy';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly people: PeopleApi;
  public readonly petitions: PetitionsApi;
  public readonly events: EventsApi;
  public readonly forms: FormsApi;
  public readonly fundraising: FundraisingApi;
  public readonly tags: TagsApi;
  public readonly messages: MessagesApi;
  public readonly advocacy: AdvocacyApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.people = new PeopleApi(this.client);
    this.petitions = new PetitionsApi(this.client);
    this.events = new EventsApi(this.client);
    this.forms = new FormsApi(this.client);
    this.fundraising = new FundraisingApi(this.client);
    this.tags = new TagsApi(this.client);
    this.messages = new MessagesApi(this.client);
    this.advocacy = new AdvocacyApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.ACTION_NETWORK_API_KEY;

    if (!apiKey) {
      throw new Error('ACTION_NETWORK_API_KEY environment variable is required');
    }
    return new Connector({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { PeopleApi } from './people';
export { PetitionsApi } from './petitions';
export { EventsApi } from './events';
export { FormsApi } from './forms';
export { FundraisingApi } from './fundraising';
export { TagsApi } from './tags';
export { MessagesApi } from './messages';
export { AdvocacyApi } from './advocacy';

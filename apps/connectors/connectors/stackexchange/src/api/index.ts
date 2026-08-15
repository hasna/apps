import { StackExchangeClient } from './client';
import type { StackExchangeConfig } from '../types';

/**
 * High-level facade over {@link StackExchangeClient}. Construct directly with a
 * config object, or use {@link StackExchange.fromEnv} to read STACKEXCHANGE_*
 * environment variables.
 */
export class StackExchange {
  public readonly client: StackExchangeClient;

  constructor(config: StackExchangeConfig = {}) {
    this.client = new StackExchangeClient(config);
  }

  /** Build a connector from STACKEXCHANGE_* environment variables. */
  static fromEnv(overrides: StackExchangeConfig = {}): StackExchange {
    return new StackExchange({
      key: process.env.STACKEXCHANGE_KEY,
      accessToken: process.env.STACKEXCHANGE_ACCESS_TOKEN,
      site: process.env.STACKEXCHANGE_SITE,
      ...overrides,
    });
  }

  get listQuestions() {
    return this.client.listQuestions.bind(this.client);
  }

  get getQuestions() {
    return this.client.getQuestions.bind(this.client);
  }

  get searchQuestions() {
    return this.client.searchQuestions.bind(this.client);
  }

  get listAnswers() {
    return this.client.listAnswers.bind(this.client);
  }

  get getQuestionAnswers() {
    return this.client.getQuestionAnswers.bind(this.client);
  }

  get listUsers() {
    return this.client.listUsers.bind(this.client);
  }

  get getUsers() {
    return this.client.getUsers.bind(this.client);
  }

  get listTags() {
    return this.client.listTags.bind(this.client);
  }
}

export { StackExchangeClient } from './client';
export { StackExchange as Connector };

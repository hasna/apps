import type { TrackjsConfig } from '../types';
import { TrackjsClient } from './client';
import { ErrorsApi } from './errors';

export class Trackjs {
  private readonly client: TrackjsClient;

  public readonly errors: ErrorsApi;

  constructor(config: TrackjsConfig) {
    this.client = new TrackjsClient(config);
    this.errors = new ErrorsApi(this.client);
  }

  static fromEnv(): Trackjs {
    const apiKey = process.env.TRACKJS_API_KEY;
    const customerId = process.env.TRACKJS_CUSTOMER_ID;

    if (!apiKey || !customerId) {
      throw new Error('TRACKJS_API_KEY and TRACKJS_CUSTOMER_ID environment variables are required');
    }

    return new Trackjs({ apiKey, customerId });
  }

  getClient(): TrackjsClient {
    return this.client;
  }
}

export { TrackjsClient } from './client';
export { ErrorsApi } from './errors';

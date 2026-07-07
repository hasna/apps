import type {
  BusinessStatusParams,
  BusinessStatusResult,
  RawRequestOptions,
  RecoverParams,
  RecoverResult,
  SignupParams,
  SignupResult,
  UsageResult,
  VoygrConfig,
} from '../types';
import { VoygrClient } from './client';

export class Voygr {
  private readonly client: VoygrClient;

  constructor(config: VoygrConfig = {}) {
    this.client = new VoygrClient(config);
  }

  static fromEnv(): Voygr {
    const apiKey = process.env.VOYGR_API_KEY;
    const baseUrl = process.env.VOYGR_BASE_URL;
    return new Voygr({ apiKey, baseUrl });
  }

  async signup(params: SignupParams): Promise<SignupResult> {
    const body: Record<string, unknown> = { email: params.email };
    if (params.name !== undefined) {
      body.name = params.name;
    }
    return this.client.post<SignupResult>('/signup', body, { authenticated: false });
  }

  async recover(params: RecoverParams): Promise<RecoverResult> {
    return this.client.post<RecoverResult>('/recover', { email: params.email }, { authenticated: false });
  }

  async checkBusinessStatus(params: BusinessStatusParams): Promise<BusinessStatusResult> {
    return this.client.post<BusinessStatusResult>('/v1/business-status', {
      name: params.name,
      address: params.address,
    });
  }

  async getUsage(): Promise<UsageResult> {
    return this.client.get<UsageResult>('/v1/usage');
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, body, query, headers, authenticated } = options;
    const needsAuth =
      authenticated ?? !(path === '/signup' || path === '/recover');

    return this.client.request(path, {
      method,
      body,
      params: query,
      headers,
      authenticated: needsAuth,
    });
  }

  getClient(): VoygrClient {
    return this.client;
  }
}

export { VoygrClient, DEFAULT_BASE_URL } from './client';

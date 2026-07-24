// Yesware Connector — sales email tracking, sequences, and outreach analytics
import { YeswareClient } from './client';
import type {
  YeswareConfig,
  YeswareSequence,
  YeswareEvent,
  YeswareSearchRequest,
  YeswareSearchResponse,
  CreateSequenceInput,
} from '../types';

export { YeswareClient } from './client';

export class Yesware {
  private readonly client: YeswareClient;

  constructor(config: YeswareConfig) {
    this.client = new YeswareClient(config);
  }

  static fromEnv(): Yesware {
    const apiKey = process.env.YESWARE_API_KEY;
    if (!apiKey) {
      throw new Error('YESWARE_API_KEY is required');
    }
    return new Yesware({
      apiKey,
      baseUrl: process.env.YESWARE_BASE_URL,
    });
  }

  async listSequences(params?: Record<string, string | number | boolean | undefined>): Promise<YeswareSequence[]> {
    return this.client.get<YeswareSequence[]>('/sequences', params);
  }

  async createSequence(data: CreateSequenceInput): Promise<YeswareSequence> {
    return this.client.post<YeswareSequence>('/sequences', data);
  }

  async getSequence(sequenceId: string): Promise<YeswareSequence> {
    return this.client.get<YeswareSequence>(`/sequences/${encodeURIComponent(sequenceId)}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<YeswareEvent[]> {
    return this.client.get<YeswareEvent[]>('/events', params);
  }

  async search(request: YeswareSearchRequest): Promise<YeswareSearchResponse> {
    return this.client.post<YeswareSearchResponse>('/search', request);
  }

  getClient(): YeswareClient {
    return this.client;
  }
}

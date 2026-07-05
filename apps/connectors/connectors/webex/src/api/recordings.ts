import type { WebexClient } from './client';
import type {
  PaginatedResponse,
  WebexRecording,
  ListRecordingsOptions,
} from '../types';

export class RecordingsApi {
  constructor(private readonly client: WebexClient) {}

  async list(options: ListRecordingsOptions = {}): Promise<WebexRecording[]> {
    const response = await this.client.get<PaginatedResponse<WebexRecording>>('/recordings', {
      from: options.from,
      to: options.to,
      hostEmail: options.hostEmail,
      topic: options.topic,
      serviceType: options.serviceType,
      max: options.max,
    });
    return response.items ?? [];
  }

  async get(recordingId: string): Promise<WebexRecording> {
    return this.client.get<WebexRecording>(`/recordings/${encodeURIComponent(recordingId)}`);
  }

  async delete(recordingId: string): Promise<void> {
    await this.client.delete(`/recordings/${encodeURIComponent(recordingId)}`);
  }
}

import type { TinybirdClient } from './client';

export class EventsApi {
  constructor(private readonly client: TinybirdClient) {}

  async ingest(name: string, ndjson: string): Promise<string> {
    return this.client.request<string>(`/v0/events`, {
      method: 'POST',
      params: { name },
      body: ndjson,
      headers: { 'Content-Type': 'application/x-ndjson' },
      skipJsonContentType: true,
      rawText: true,
    });
  }
}

import { MixpanelClient } from './client';
import type { ExportParams, ExportedEvent } from '../types';

/**
 * Mixpanel Export API
 * Export raw event data
 */
export class ExportApi {
  constructor(private readonly client: MixpanelClient) {}

  /**
   * Export raw event data
   * Returns NDJSON (newline-delimited JSON)
   *
   * @param from_date Start date (YYYY-MM-DD)
   * @param to_date End date (YYYY-MM-DD)
   * @param options Additional options
   */
  async export(
    from_date: string,
    to_date: string,
    options: {
      event?: string[];
      where?: string;
      bucket?: string;
    } = {}
  ): Promise<ExportedEvent[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      from_date,
      to_date,
    };

    if (options.event && options.event.length > 0) {
      params.event = JSON.stringify(options.event);
    }

    if (options.where) {
      params.where = options.where;
    }

    if (options.bucket) {
      params.bucket = options.bucket;
    }

    const rawData = await this.client.exportRequest('/api/2.0/export', params);

    // Parse NDJSON
    const events: ExportedEvent[] = [];
    const lines = rawData.trim().split('\n');

    for (const line of lines) {
      if (line.trim()) {
        try {
          events.push(JSON.parse(line));
        } catch {
          // Skip invalid lines
        }
      }
    }

    return events;
  }

  /**
   * Export raw data and return as a string (NDJSON format)
   */
  async exportRaw(
    from_date: string,
    to_date: string,
    options: {
      event?: string[];
      where?: string;
      bucket?: string;
    } = {}
  ): Promise<string> {
    const params: Record<string, string | number | boolean | undefined> = {
      from_date,
      to_date,
    };

    if (options.event && options.event.length > 0) {
      params.event = JSON.stringify(options.event);
    }

    if (options.where) {
      params.where = options.where;
    }

    if (options.bucket) {
      params.bucket = options.bucket;
    }

    return this.client.exportRequest('/api/2.0/export', params);
  }

  /**
   * Stream export data (for large datasets)
   * Yields individual events
   */
  async *exportStream(
    from_date: string,
    to_date: string,
    options: {
      event?: string[];
      where?: string;
      bucket?: string;
    } = {}
  ): AsyncGenerator<ExportedEvent> {
    const rawData = await this.exportRaw(from_date, to_date, options);
    const lines = rawData.split('\n');

    for (const line of lines) {
      if (line.trim()) {
        try {
          yield JSON.parse(line);
        } catch {
          // Skip invalid lines
        }
      }
    }
  }
}

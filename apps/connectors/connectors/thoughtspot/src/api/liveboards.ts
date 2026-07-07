import type { MetadataSearchRequest, TmlImportRequest } from '../types';
import type { ConnectorClient } from './client';
import { encodePathSegment } from './client';

export class LiveboardsApi {
  constructor(private readonly client: ConnectorClient) {}

  /** List liveboards via POST /metadata/search. */
  async list(options: MetadataSearchRequest = {}): Promise<unknown> {
    const body: MetadataSearchRequest = {
      metadata: [{ type: 'LIVEBOARD' }],
      ...options,
    };
    if (!body.metadata?.length) {
      body.metadata = [{ type: 'LIVEBOARD' }];
    }
    return this.client.post('/metadata/search', body);
  }

  /** Create/import a liveboard via TML import. */
  async create(body: TmlImportRequest): Promise<unknown> {
    return this.client.post('/metadata/tml/import', body);
  }

  /** Get a liveboard by ID or name. */
  async get(liveboardId: string, options: MetadataSearchRequest = {}): Promise<unknown> {
    return this.client.post('/metadata/search', {
      metadata: [{ type: 'LIVEBOARD', identifier: liveboardId }],
      include_details: true,
      ...options,
    });
  }

  /** Get liveboard data (visualizations). */
  async data(liveboardId: string, body: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.post('/metadata/liveboard/data', {
      metadata_identifier: liveboardId,
      ...body,
    });
  }

  /** Encode a liveboard identifier for use in raw paths. */
  encodeId(liveboardId: string): string {
    return encodePathSegment(liveboardId);
  }
}

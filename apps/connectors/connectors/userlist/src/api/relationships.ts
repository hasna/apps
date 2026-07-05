import type { RelationshipDeletePayload, RelationshipUpsertPayload } from '../types';
import type { ConnectorClient } from './client';

export class RelationshipsApi {
  constructor(private readonly client: ConnectorClient) {}

  upsert(payload: RelationshipUpsertPayload): Promise<void> {
    return this.client.post('/relationships', payload as unknown as Record<string, unknown>);
  }

  delete(payload: RelationshipDeletePayload): Promise<void> {
    return this.client.delete('/relationships', payload as unknown as Record<string, unknown>);
  }
}

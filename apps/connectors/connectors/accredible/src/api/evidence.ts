import type { ConnectorClient } from './client';
import type { EvidenceItemResponse, EvidenceItemCreate } from '../types';

export class EvidenceApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(credentialId: number, item: EvidenceItemCreate): Promise<EvidenceItemResponse> {
    return this.client.post<EvidenceItemResponse>(
      `/credentials/${credentialId}/evidence_items`,
      { evidence_item: item }
    );
  }
}

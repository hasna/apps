import type { ConnectorClient } from './client';
import type { CreateOfferParams, Offer } from '../types';

export class OffersApi {
  constructor(private readonly client: ConnectorClient) {}

  async get(candidateId: string): Promise<Offer> {
    return this.client.get<Offer>(`/candidates/${encodeURIComponent(candidateId)}/offer`);
  }

  async create(params: CreateOfferParams): Promise<Offer> {
    return this.client.post<Offer>(
      `/candidates/${encodeURIComponent(params.candidateId)}/offer`,
      {
        template_id: params.templateId,
        salary: params.salary,
        start_date: params.startDate,
        documents: params.documents,
      },
    );
  }
}

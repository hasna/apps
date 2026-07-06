import type {
  ApiEnvelope,
  CommitQuoteRequestBody,
  CreateQuoteRequestBody,
  UpdateQuoteRequestBody,
} from '../types';
import type { TotalisClient } from './client';
import { encodePathSegment } from './client';

export class QuoteRequestsApi {
  constructor(private readonly client: TotalisClient) {}

  create(body: CreateQuoteRequestBody): Promise<ApiEnvelope<unknown>> {
    return this.client.post<ApiEnvelope<unknown>>('/v1/quote-requests', body);
  }

  get(id: string): Promise<ApiEnvelope<unknown>> {
    return this.client.get<ApiEnvelope<unknown>>(`/v1/quote-requests/${encodePathSegment(id)}`);
  }

  update(id: string, body: UpdateQuoteRequestBody): Promise<ApiEnvelope<unknown>> {
    return this.client.patch<ApiEnvelope<unknown>>(
      `/v1/quote-requests/${encodePathSegment(id)}`,
      body,
    );
  }

  cancel(id: string): Promise<ApiEnvelope<unknown>> {
    return this.client.post<ApiEnvelope<unknown>>(
      `/v1/quote-requests/${encodePathSegment(id)}/cancel`,
    );
  }

  commit(id: string, body: CommitQuoteRequestBody): Promise<ApiEnvelope<unknown>> {
    return this.client.post<ApiEnvelope<unknown>>(
      `/v1/quote-requests/${encodePathSegment(id)}/commit`,
      body,
    );
  }
}

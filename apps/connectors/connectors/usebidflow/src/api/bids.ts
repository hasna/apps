import type { UsebidflowClient } from './client';
import { encodePathSegment } from './client';
import type { Bid, BidListResponse, CreateBidParams } from '../types';

export class BidsApi {
  constructor(private readonly client: UsebidflowClient) {}

  list(params?: Record<string, string | number | boolean | undefined>): Promise<BidListResponse> {
    return this.client.get<BidListResponse>('/bids', params);
  }

  get(bidId: string): Promise<Bid> {
    return this.client.get<Bid>(`/bids/${encodePathSegment(bidId)}`);
  }

  create(body: CreateBidParams): Promise<Bid> {
    return this.client.post<Bid>('/bids', body);
  }
}

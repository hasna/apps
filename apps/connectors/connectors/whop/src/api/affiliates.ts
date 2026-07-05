import type { WhopClient } from './client';
import type {
  Affiliate,
  AffiliateListParams,
  CreateAffiliateParams,
  WhopListResponse,
} from '../types';

export class AffiliatesApi {
  constructor(
    private readonly client: WhopClient,
    private readonly defaultCompanyId?: string
  ) {}

  list(params: AffiliateListParams = {}): Promise<WhopListResponse<Affiliate>> {
    return this.client.get('/affiliates', {
      company_id: params.company_id ?? this.defaultCompanyId,
      after: params.after,
      before: params.before,
      first: params.first,
      last: params.last,
      statuses: params.statuses,
      search: params.search,
      direction: params.direction,
      order: params.order,
    });
  }

  get(id: string): Promise<Affiliate> {
    return this.client.get(`/affiliates/${encodeURIComponent(id)}`);
  }

  create(body: CreateAffiliateParams): Promise<Affiliate> {
    return this.client.post('/affiliates', {
      ...body,
      company_id: body.company_id ?? this.defaultCompanyId,
    });
  }
}

import type { WhopClient } from './client';
import type {
  CreatePromoCodeParams,
  PromoCode,
  PromoCodeListParams,
  WhopListResponse,
} from '../types';

export class PromoCodesApi {
  constructor(
    private readonly client: WhopClient,
    private readonly defaultCompanyId?: string
  ) {}

  list(params: PromoCodeListParams = {}): Promise<WhopListResponse<PromoCode>> {
    return this.client.get('/promo_codes', {
      company_id: params.company_id ?? this.defaultCompanyId,
      after: params.after,
      before: params.before,
      first: params.first,
      last: params.last,
      plan_ids: params.plan_ids,
      product_ids: params.product_ids,
      statuses: params.statuses,
    });
  }

  get(id: string): Promise<PromoCode> {
    return this.client.get(`/promo_codes/${encodeURIComponent(id)}`);
  }

  create(body: CreatePromoCodeParams): Promise<PromoCode> {
    return this.client.post('/promo_codes', {
      ...body,
      company_id: body.company_id ?? this.defaultCompanyId,
    });
  }
}

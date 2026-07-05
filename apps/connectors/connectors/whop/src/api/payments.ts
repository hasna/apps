import type { WhopClient } from './client';
import type {
  Payment,
  PaymentListParams,
  RefundPaymentParams,
  WhopListResponse,
} from '../types';

export class PaymentsApi {
  constructor(
    private readonly client: WhopClient,
    private readonly defaultCompanyId?: string
  ) {}

  list(params: PaymentListParams = {}): Promise<WhopListResponse<Payment>> {
    return this.client.get('/payments', {
      company_id: params.company_id ?? this.defaultCompanyId,
      after: params.after,
      before: params.before,
      first: params.first,
      last: params.last,
      product_ids: params.product_ids,
      plan_ids: params.plan_ids,
      statuses: params.statuses,
      billing_reasons: params.billing_reasons,
      currencies: params.currencies,
      user_ids: params.user_ids,
      created_before: params.created_before,
      created_after: params.created_after,
      direction: params.direction,
      order: params.order,
    });
  }

  get(id: string): Promise<Payment> {
    return this.client.get(`/payments/${encodeURIComponent(id)}`);
  }

  refund(id: string, body: RefundPaymentParams = {}): Promise<Payment> {
    return this.client.post(`/payments/${encodeURIComponent(id)}/refund`, body as Record<string, unknown>);
  }
}

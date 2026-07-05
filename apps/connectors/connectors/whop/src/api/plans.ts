import type { WhopClient } from './client';
import type { Plan, PlanListParams, WhopListResponse } from '../types';

export class PlansApi {
  constructor(
    private readonly client: WhopClient,
    private readonly defaultAccountId?: string
  ) {}

  list(params: PlanListParams = {}): Promise<WhopListResponse<Plan>> {
    return this.client.get('/plans', {
      account_id: params.account_id ?? this.defaultAccountId,
      after: params.after,
      before: params.before,
      first: params.first,
      last: params.last,
      product_ids: params.product_ids,
      visibilities: params.visibilities,
      plan_types: params.plan_types,
      release_methods: params.release_methods,
      direction: params.direction,
      order: params.order,
      created_before: params.created_before,
      created_after: params.created_after,
    });
  }

  get(id: string): Promise<Plan> {
    return this.client.get(`/plans/${encodeURIComponent(id)}`);
  }
}

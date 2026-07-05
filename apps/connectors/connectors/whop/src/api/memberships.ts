import type { WhopClient } from './client';
import type {
  AddFreeDaysParams,
  CancelMembershipParams,
  Membership,
  MembershipListParams,
  UpdateMembershipParams,
  WhopListResponse,
} from '../types';

export class MembershipsApi {
  constructor(
    private readonly client: WhopClient,
    private readonly defaultCompanyId?: string
  ) {}

  list(params: MembershipListParams = {}): Promise<WhopListResponse<Membership>> {
    return this.client.get('/memberships', {
      company_id: params.company_id ?? this.defaultCompanyId,
      after: params.after,
      before: params.before,
      first: params.first,
      last: params.last,
      product_ids: params.product_ids,
      plan_ids: params.plan_ids,
      user_ids: params.user_ids,
      statuses: params.statuses,
      direction: params.direction,
      order: params.order,
    });
  }

  get(id: string): Promise<Membership> {
    return this.client.get(`/memberships/${encodeURIComponent(id)}`);
  }

  update(id: string, body: UpdateMembershipParams): Promise<Membership> {
    return this.client.patch(`/memberships/${encodeURIComponent(id)}`, body);
  }

  cancel(id: string, body: CancelMembershipParams = {}): Promise<Membership> {
    return this.client.post(`/memberships/${encodeURIComponent(id)}/cancel`, body as Record<string, unknown>);
  }

  pause(id: string): Promise<Membership> {
    return this.client.post(`/memberships/${encodeURIComponent(id)}/pause`);
  }

  resume(id: string): Promise<Membership> {
    return this.client.post(`/memberships/${encodeURIComponent(id)}/resume`);
  }

  uncancel(id: string): Promise<Membership> {
    return this.client.post(`/memberships/${encodeURIComponent(id)}/uncancel`);
  }

  addFreeDays(id: string, body: AddFreeDaysParams): Promise<Membership> {
    return this.client.post(`/memberships/${encodeURIComponent(id)}/add_free_days`, { days: body.days });
  }
}

import type { SquarespaceClient } from './client';

export interface MembershipPlansResponse {
  plans: Array<Record<string, unknown>>;
  pagination?: { nextPageCursor?: string; hasNextPage?: boolean };
}

export interface MembersResponse {
  members: Array<Record<string, unknown>>;
  pagination?: { nextPageCursor?: string; hasNextPage?: boolean };
}

export class MembershipApi {
  constructor(private readonly client: SquarespaceClient) {}

  async listPlans(cursor?: string): Promise<MembershipPlansResponse> {
    return this.client.request<MembershipPlansResponse>('/commerce/membership/plans', {
      params: { cursor },
    });
  }

  async listMembers(options: { cursor?: string; planId?: string } = {}): Promise<MembersResponse> {
    return this.client.request<MembersResponse>('/commerce/membership/members', {
      params: { cursor: options.cursor, planId: options.planId },
    });
  }
}

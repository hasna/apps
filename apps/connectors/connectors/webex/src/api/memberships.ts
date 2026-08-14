import type { WebexClient } from './client';
import type {
  PaginatedResponse,
  WebexMembership,
  WebexMembershipCreateRequest,
  WebexMembershipUpdateRequest,
  ListMembershipsOptions,
} from '../types';

export class MembershipsApi {
  constructor(private readonly client: WebexClient) {}

  async list(options: ListMembershipsOptions = {}): Promise<WebexMembership[]> {
    const response = await this.client.get<PaginatedResponse<WebexMembership>>('/memberships', {
      roomId: options.roomId,
      personId: options.personId,
      personEmail: options.personEmail,
      max: options.max,
    });
    return response.items ?? [];
  }

  async get(membershipId: string): Promise<WebexMembership> {
    return this.client.get<WebexMembership>(`/memberships/${encodeURIComponent(membershipId)}`);
  }

  async create(membership: WebexMembershipCreateRequest): Promise<WebexMembership> {
    return this.client.post<WebexMembership>('/memberships', membership);
  }

  async update(membershipId: string, updates: WebexMembershipUpdateRequest): Promise<WebexMembership> {
    return this.client.put<WebexMembership>(`/memberships/${encodeURIComponent(membershipId)}`, updates);
  }

  async delete(membershipId: string): Promise<void> {
    await this.client.delete(`/memberships/${encodeURIComponent(membershipId)}`);
  }
}

import type { DiscordClient } from './client';
import type { DiscordInvite } from '../types';

export class InvitesApi {
  constructor(private readonly client: DiscordClient) {}

  /**
   * Get an invite by code
   */
  async get(
    inviteCode: string,
    options?: {
      with_counts?: boolean;
      with_expiration?: boolean;
      guild_scheduled_event_id?: string;
    }
  ): Promise<DiscordInvite> {
    return this.client.get<DiscordInvite>(`/invites/${inviteCode}`, options);
  }

  /**
   * Delete an invite
   */
  async delete(inviteCode: string, reason?: string): Promise<DiscordInvite> {
    return this.client.delete<DiscordInvite>(`/invites/${inviteCode}`, reason);
  }
}

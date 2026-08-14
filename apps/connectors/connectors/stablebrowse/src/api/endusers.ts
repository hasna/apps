import type { StableBrowseClient } from './client';
import type {
  SetCredentialsParams,
  SetCredentialsResponse,
  CredentialsStatus,
} from '../types';

/**
 * End-Users API
 *
 * Manages per-end-user platform credentials. Credentials are encrypted at rest
 * and never returned; the status endpoint only reports which platforms are set.
 */
export class EndUsersApi {
  constructor(private client: StableBrowseClient) {}

  /**
   * Store (idempotent upsert) credentials for an end-user.
   */
  async setCredentials(endUserId: string, params: SetCredentialsParams): Promise<SetCredentialsResponse> {
    return this.client.put<SetCredentialsResponse>(
      `/end-users/${encodeURIComponent(endUserId)}/credentials`,
      params
    );
  }

  /**
   * Get the credential configuration status for an end-user.
   */
  async getCredentials(endUserId: string): Promise<CredentialsStatus> {
    return this.client.get<CredentialsStatus>(
      `/end-users/${encodeURIComponent(endUserId)}/credentials`
    );
  }

  /**
   * Delete (revoke) all stored credentials for an end-user.
   */
  async deleteCredentials(endUserId: string): Promise<void> {
    await this.client.delete(`/end-users/${encodeURIComponent(endUserId)}/credentials`);
  }
}

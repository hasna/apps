import type { ConnectorClient } from './client';
import type {
  VerificationSession,
  VerificationSessionCreateParams,
  VerificationSessionUpdateParams,
  VerificationSessionListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Identity VerificationSessions API
 * https://stripe.com/docs/api/identity/verification_sessions
 */
export class VerificationSessionsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a VerificationSession.
   */
  async create(params: VerificationSessionCreateParams = {}): Promise<VerificationSession> {
    return this.client.post<VerificationSession>('/identity/verification_sessions', params);
  }

  /**
   * Retrieve a VerificationSession by ID.
   */
  async get(id: string): Promise<VerificationSession> {
    return this.client.get<VerificationSession>(`/identity/verification_sessions/${id}`);
  }

  /**
   * Update an existing VerificationSession (only while status is requires_input).
   */
  async update(id: string, params: VerificationSessionUpdateParams): Promise<VerificationSession> {
    return this.client.post<VerificationSession>(`/identity/verification_sessions/${id}`, params);
  }

  /**
   * List all VerificationSessions.
   */
  async list(options?: VerificationSessionListOptions): Promise<StripeList<VerificationSession>> {
    return this.client.get<StripeList<VerificationSession>>(
      '/identity/verification_sessions',
      options as Record<string, string | number | boolean | undefined>,
    );
  }

  /**
   * Cancel a VerificationSession. A cancelled session can no longer be used.
   */
  async cancel(id: string): Promise<VerificationSession> {
    return this.client.post<VerificationSession>(`/identity/verification_sessions/${id}/cancel`, {});
  }

  /**
   * Redact a VerificationSession, permanently removing collected personal data.
   */
  async redact(id: string): Promise<VerificationSession> {
    return this.client.post<VerificationSession>(`/identity/verification_sessions/${id}/redact`, {});
  }
}

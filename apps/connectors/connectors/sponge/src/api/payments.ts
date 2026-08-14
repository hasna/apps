import { SpongeClient, compact } from './client';
import type {
  X402FetchParams,
  MppFetchParams,
  MppSessionStartParams,
  MppSessionRequestParams,
  MppSessionCloseParams,
  MppSessionsOptions,
} from '../types';

/**
 * Payments API — pay-per-request HTTP over the x402 protocol and the
 * Metered Payment Protocol (MPP) session flow.
 */
export class PaymentsApi {
  constructor(private readonly client: SpongeClient) {}

  /** Perform an x402 paid HTTP fetch. */
  x402Fetch(params: X402FetchParams): Promise<unknown> {
    return this.client.post('/api/x402/fetch', compact({ ...params }));
  }

  /** Perform a single MPP paid fetch. */
  mppFetch(params: MppFetchParams): Promise<unknown> {
    return this.client.post('/api/mpp/fetch', compact({ ...params }));
  }

  /** Open an MPP payment session. */
  mppSessionStart(params: MppSessionStartParams = {}): Promise<unknown> {
    return this.client.post('/api/mpp/session/start', compact({ ...params }));
  }

  /** Issue a request within an open MPP session. */
  mppSessionRequest(params: MppSessionRequestParams): Promise<unknown> {
    return this.client.post('/api/mpp/session/request', compact({ ...params }));
  }

  /** Close an MPP session. */
  mppSessionClose(params: MppSessionCloseParams): Promise<unknown> {
    return this.client.post('/api/mpp/session/close', compact({ ...params }));
  }

  /** List MPP sessions. */
  mppSessions(options: MppSessionsOptions = {}): Promise<unknown> {
    return this.client.get('/api/mpp/sessions', {
      status: options.status,
      limit: options.limit,
    });
  }
}

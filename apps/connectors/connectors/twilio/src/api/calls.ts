import type { TwilioClient } from './client';
import type {
  Call,
  CallListResponse,
  MakeCallParams,
  UpdateCallParams,
  ListCallsParams,
} from '../types';

/**
 * Twilio Calls API
 * Make, list, get, update, and delete voice calls
 */
export class CallsApi {
  constructor(private readonly client: TwilioClient) {}

  /**
   * Make a new outbound call
   */
  async create(params: MakeCallParams): Promise<Call> {
    return this.client.post<Call>(
      `/Accounts/{AccountSid}/Calls.json`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * List calls with optional filters
   */
  async list(params?: ListCallsParams): Promise<CallListResponse> {
    return this.client.get<CallListResponse>(
      `/Accounts/{AccountSid}/Calls.json`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get a single call by SID
   */
  async get(callSid: string): Promise<Call> {
    return this.client.get<Call>(
      `/Accounts/{AccountSid}/Calls/${callSid}.json`
    );
  }

  /**
   * Update a call (modify in-progress call or cancel queued call)
   */
  async update(callSid: string, params: UpdateCallParams): Promise<Call> {
    return this.client.post<Call>(
      `/Accounts/{AccountSid}/Calls/${callSid}.json`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * Delete a call record
   */
  async delete(callSid: string): Promise<void> {
    await this.client.delete(
      `/Accounts/{AccountSid}/Calls/${callSid}.json`
    );
  }

  /**
   * Cancel a queued call
   */
  async cancel(callSid: string): Promise<Call> {
    return this.update(callSid, { Status: 'canceled' });
  }

  /**
   * Complete (hang up) an in-progress call
   */
  async complete(callSid: string): Promise<Call> {
    return this.update(callSid, { Status: 'completed' });
  }

  /**
   * Redirect an in-progress call to new TwiML
   */
  async redirect(callSid: string, url: string, method?: 'GET' | 'POST'): Promise<Call> {
    return this.update(callSid, { Url: url, Method: method });
  }

  /**
   * List recordings for a call
   */
  async listRecordings(callSid: string): Promise<{ recordings: Array<{ sid: string; duration: string; uri: string }> }> {
    return this.client.get(
      `/Accounts/{AccountSid}/Calls/${callSid}/Recordings.json`
    );
  }

  /**
   * List all calls, auto-paginating through results
   */
  async *listAll(params?: ListCallsParams): AsyncGenerator<Call, void, unknown> {
    let page = 0;
    const pageSize = params?.PageSize || 50;

    while (true) {
      const response = await this.list({
        ...params,
        Page: page,
        PageSize: pageSize,
      });

      for (const call of response.calls) {
        yield call;
      }

      if (!response.next_page_uri) {
        break;
      }

      page++;
    }
  }
}

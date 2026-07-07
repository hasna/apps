import type { ConnectorClient } from './client';
import type {
  AwaitingPollResponse,
  ExtractDataAsyncResponse,
  ExtractDataRequest,
  ExtractionPollResponse,
  ExtractionResult,
} from '../types';

export class ExtractionApi {
  constructor(private readonly client: ConnectorClient) {}

  /** Synchronous data extraction (POST /extract-data). */
  async extractData(payload: ExtractDataRequest): Promise<ExtractionResult> {
    return this.client.post<ExtractionResult>('/extract-data', payload);
  }

  /** Start asynchronous extraction (POST /extract-data-async). */
  async extractDataAsync(payload: ExtractDataRequest): Promise<ExtractDataAsyncResponse> {
    return this.client.post<ExtractDataAsyncResponse>('/extract-data-async', payload);
  }

  /** Poll extraction status and results (GET /get-extraction-data). */
  async getExtractionData(extractionId: string): Promise<ExtractionPollResponse> {
    return this.client.get<ExtractionPollResponse>('/get-extraction-data', {
      extraction_id: extractionId,
    });
  }

  /** List extraction IDs ready for polling (GET /api/v1/awaiting-poll). */
  async awaitingPoll(customer?: string): Promise<AwaitingPollResponse> {
    const params = customer ? { customer } : undefined;
    return this.client.get<AwaitingPollResponse>('/api/v1/awaiting-poll', params);
  }

  /**
   * Poll until extraction completes or timeout.
   * Returns the final poll response when status is SUCCESS or ERROR.
   */
  async waitForExtraction(
    extractionId: string,
    options?: { intervalMs?: number; maxAttempts?: number }
  ): Promise<ExtractionPollResponse> {
    const intervalMs = options?.intervalMs ?? 2000;
    const maxAttempts = options?.maxAttempts ?? 60;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await this.getExtractionData(extractionId);

      if (response.status === 'SUCCESS' || response.status === 'ERROR' || response.status === 'EXPIRED') {
        return response;
      }

      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }

    throw new Error(`Extraction ${extractionId} did not complete within ${maxAttempts} attempts`);
  }
}

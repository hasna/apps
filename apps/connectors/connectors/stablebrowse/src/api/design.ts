import type { StableBrowseClient } from './client';
import type {
  DesignExtractParams,
  DesignExtractResponse,
  Extractor,
} from '../types';

/**
 * Design Extraction API
 *
 * Extracts design assets (images, fonts, colors, icons, tokens, logo) from a URL.
 * Submission is asynchronous: poll GET /tasks/{taskId} for results.
 */
export class DesignApi {
  constructor(private client: StableBrowseClient) {}

  /**
   * Submit a design extraction. Runs all extractors unless a subset is provided.
   */
  async extract(params: DesignExtractParams): Promise<DesignExtractResponse> {
    return this.client.post<DesignExtractResponse>('/design/extract', {
      url: params.url,
      endUserId: params.endUserId,
      extractors: params.extractors,
      enableIpRotation: params.enableIpRotation,
    });
  }

  /**
   * Submit a design extraction for a single extractor via its dedicated path.
   */
  async extractByExtractor(
    extractor: Extractor,
    params: Omit<DesignExtractParams, 'extractors'>
  ): Promise<DesignExtractResponse> {
    return this.client.post<DesignExtractResponse>(
      `/design/extract/${encodeURIComponent(extractor)}`,
      {
        url: params.url,
        endUserId: params.endUserId,
        enableIpRotation: params.enableIpRotation,
      }
    );
  }
}

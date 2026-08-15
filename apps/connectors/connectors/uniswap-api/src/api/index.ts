import type {
  CheckApprovalRequest,
  CheckApprovalResponse,
  QuoteRequest,
  QuoteResponse,
  SwapRequest,
  SwapResponse,
  SwapStatusRequest,
  SwapStatusResponse,
  SwappableTokensRequest,
  SwappableTokensResponse,
  UniswapApiConfig,
} from '../types';
import { UniswapApiClient } from './client';

/**
 * Uniswap Trade API connector
 * https://developers.uniswap.org/docs/api-reference/
 */
export class UniswapApi {
  private readonly client: UniswapApiClient;

  constructor(config: UniswapApiConfig) {
    this.client = new UniswapApiClient(config);
  }

  static fromEnv(): UniswapApi {
    const apiKey = process.env.UNISWAP_API_KEY;
    const baseUrl = process.env.UNISWAP_BASE_URL;

    if (!apiKey) {
      throw new Error('UNISWAP_API_KEY environment variable is required');
    }

    return new UniswapApi({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): UniswapApiClient {
    return this.client;
  }

  async checkApproval(request: CheckApprovalRequest): Promise<CheckApprovalResponse> {
    return this.client.post<CheckApprovalResponse>('/check_approval', request);
  }

  async quote(request: QuoteRequest): Promise<QuoteResponse> {
    return this.client.post<QuoteResponse>('/quote', request);
  }

  async createSwap(request: SwapRequest): Promise<SwapResponse> {
    return this.client.post<SwapResponse>('/swap', request);
  }

  async getSwapStatus(request: SwapStatusRequest): Promise<SwapStatusResponse> {
    const params: Record<string, string | undefined> = {};

    if (request.txHashes?.length) {
      params.txHashes = request.txHashes.join(',');
    }
    if (request.userOpHashes?.length) {
      params.userOpHashes = request.userOpHashes.join(',');
    }

    return this.client.get<SwapStatusResponse>('/swaps', params);
  }

  async listSwappableTokens(request: SwappableTokensRequest): Promise<SwappableTokensResponse> {
    return this.client.get<SwappableTokensResponse>('/swappable_tokens', {
      tokenIn: request.tokenIn,
      tokenInChainId: request.tokenInChainId,
    });
  }
}

export { UniswapApiClient, DEFAULT_BASE_URL } from './client';

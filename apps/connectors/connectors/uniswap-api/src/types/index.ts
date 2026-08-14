// Uniswap Trade API connector types

export interface UniswapApiConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type QuoteType = 'EXACT_INPUT' | 'EXACT_OUTPUT';

export type RoutingPreference = 'BEST_PRICE' | 'FASTEST' | 'CLASSIC' | 'UNISWAPX';

export interface CheckApprovalRequest {
  walletAddress: string;
  token: string;
  amount: string;
  chainId: number;
  tokenOut?: string;
  tokenOutChainId?: number;
}

export interface CheckApprovalResponse {
  requestId: string;
  approval?: {
    to?: string;
    from?: string;
    data?: string;
    value?: string;
    chainId?: number;
    gasLimit?: string;
  };
  cancel?: {
    to?: string;
    from?: string;
    data?: string;
    value?: string;
    chainId?: number;
    gasLimit?: string;
  };
  gasFee?: string;
  cancelGasFee?: string;
}

export interface QuoteRequest {
  swapper: string;
  tokenIn: string;
  tokenOut: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  amount: string;
  type: QuoteType;
  routingPreference?: RoutingPreference;
  protocols?: string[];
  slippageTolerance?: number;
  urgency?: string;
}

export interface QuoteResponse {
  requestId: string;
  quoteId?: string;
  routing?: string;
  input?: {
    token?: string;
    amount?: string;
    chainId?: number;
  };
  output?: {
    token?: string;
    amount?: string;
    chainId?: number;
    recipient?: string;
  };
  permitData?: Record<string, unknown>;
  permitTransaction?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SwapRequest {
  quote: QuoteResponse | Record<string, unknown>;
  signature?: string;
  permitData?: Record<string, unknown>;
  refreshGasPrice?: boolean;
  simulateTransaction?: boolean;
}

export interface SwapResponse {
  requestId: string;
  swap?: Record<string, unknown>;
  order?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SwapStatusRequest {
  txHashes?: string[];
  userOpHashes?: string[];
}

export interface SwapStatusResponse {
  requestId: string;
  swaps?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface SwappableTokensRequest {
  tokenIn: string;
  tokenInChainId: number;
}

export interface TokenProject {
  logo?: { url?: string };
  safetyLevel?: string;
  isSpam?: boolean;
}

export interface SwappableToken {
  address: string;
  chainId: number;
  name?: string;
  symbol?: string;
  decimals?: number;
  isSpam?: boolean;
  project?: TokenProject;
}

export interface SwappableTokensResponse {
  requestId: string;
  tokens: SwappableToken[];
}

export class UniswapApiError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'UniswapApiError';
    this.statusCode = statusCode;
    this.details = details;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  getUserMessage(): string {
    return `Uniswap API error (${this.statusCode}): ${this.message}`;
  }
}

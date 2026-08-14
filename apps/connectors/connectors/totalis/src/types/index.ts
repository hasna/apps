export interface TotalisConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type MarketCategory =
  | 'politics'
  | 'sports'
  | 'crypto'
  | 'finance'
  | 'economics'
  | 'entertainment'
  | 'weather'
  | 'tech'
  | 'all';

export type MarketVenue = 'kalshi' | 'polymarket';

export type ParlaySide = 'yes' | 'no';

export interface ParlayLegInput {
  market_ticker: string;
  side: ParlaySide;
  venue?: MarketVenue;
}

export interface CreateQuoteRequestBody {
  legs: ParlayLegInput[];
  bet_amount: number;
}

export interface UpdateQuoteRequestBody extends CreateQuoteRequestBody {}

export interface CommitQuoteRequestBody {
  expected_version: number;
  displayed_quote_id: string;
  displayed_quote_book_seq: number;
  min_payout_odds_seen: number;
}

export interface TotalisErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export class TotalisApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TotalisApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

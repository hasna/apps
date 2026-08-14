// Sponge (PaySponge Agent Wallet) Connector Types
//
// Rebuilt against the public Sponge REST API documented at
// https://docs.paysponge.com and its OpenAPI spec
// (https://docs.paysponge.com/api-reference/public-openapi.json).

// ============================================
// Configuration
// ============================================

export interface SpongeConfig {
  /** API key issued for an agent; sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /** Override the default API base URL (https://api.wallet.paysponge.com). */
  baseUrl?: string;
  /** Optional `Sponge-Version` header value. */
  apiVersion?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

/** Generic key/value metadata bag accepted by many endpoints. */
export type Metadata = Record<string, unknown>;

/** Supported settlement/transfer chains referenced across the API. */
export type Chain =
  | 'ethereum'
  | 'base'
  | 'polygon'
  | 'arbitrum-one'
  | 'hyperliquid'
  | 'solana';

/** Sponge API error with the originating HTTP status code. */
export class SpongeApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly body?: unknown;

  constructor(message: string, statusCode: number, code?: string, body?: unknown) {
    super(message);
    this.name = 'SpongeApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.body = body;
  }
}

// ============================================
// Agents
// ============================================

export interface CreateAgentParams {
  name: string;
  description?: string;
  agentType?: string;
  dailySpendingLimit?: string;
  weeklySpendingLimit?: string;
  monthlySpendingLimit?: string;
  metadata?: Metadata;
}

export interface UpdateAgentParams {
  name?: string;
  description?: string;
  agentType?: string;
  status?: string;
  dailySpendingLimit?: string;
  weeklySpendingLimit?: string;
  monthlySpendingLimit?: string;
  metadata?: Metadata;
}

// ============================================
// Wallets & Balances
// ============================================

export interface BalancesOptions {
  chain?: string;
  allowedChains?: string;
  onlyUsdc?: boolean;
}

// ============================================
// Transfers, Tokens & Transactions
// ============================================

export interface EvmTransferParams {
  chain: string;
  to: string;
  amount: string;
  currency: 'ETH' | 'USDC';
}

export interface SolanaTransferParams {
  chain: string;
  to: string;
  amount: string;
  currency: 'SOL' | 'USDC';
}

export interface TokenSearchOptions {
  limit?: number;
}

export interface TransactionHistoryOptions {
  limit?: number;
  chain?: string;
}

export interface SwapParams {
  chain: string;
  inputToken: string;
  outputToken: string;
  amount: string;
  slippageBps?: number;
}

export interface BridgeParams {
  sourceChain: Chain;
  destinationChain: Chain;
  token: string;
  amount: string;
  destinationToken?: string;
  recipientAddress?: string;
}

// ============================================
// Payments (x402 / MPP) & Trading
// ============================================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface X402FetchParams {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface MppFetchParams {
  url: string;
  chain?: 'tempo';
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface MppSessionStartParams {
  chain?: 'tempo';
  max_deposit?: string;
  deposit?: string;
}

export interface MppSessionRequestParams {
  session_id: string;
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  stream?: boolean;
}

export interface MppSessionCloseParams {
  session_id: string;
  reason?: string;
}

export interface MppSessionsOptions {
  status?: string;
  limit?: number;
}

export type HyperliquidAction =
  | 'status'
  | 'order'
  | 'cancel'
  | 'cancel_all'
  | 'set_leverage'
  | 'positions'
  | 'orders'
  | 'fills'
  | 'markets'
  | 'ticker'
  | 'orderbook'
  | 'funding'
  | 'withdraw'
  | 'transfer'
  | 'set_abstraction';

export interface HyperliquidParams {
  action: HyperliquidAction;
  symbol?: string;
  side?: 'buy' | 'sell';
  type?: 'limit' | 'market';
  amount?: string;
  price?: string;
  reduce_only?: boolean;
  trigger_price?: string;
  tp_sl?: 'tp' | 'sl';
  tif?: 'GTC' | 'IOC' | 'PO';
  order_id?: string;
  leverage?: number;
  since?: number;
  limit?: number;
  offset?: number;
  query?: string;
  market_type?: 'spot' | 'swap';
  full?: boolean;
  destination?: string;
  to_perp?: boolean;
  abstraction?: 'disabled' | 'unifiedAccount' | 'portfolioMargin';
}

// ============================================
// Fiat Onramps
// ============================================

export interface OnrampCryptoParams {
  wallet_address: string;
  provider?: 'auto' | 'stripe' | 'coinbase';
  chain?: 'base' | 'solana' | 'polygon';
  fiat_amount?: string;
  fiat_currency?: string;
  lock_wallet_address?: boolean;
  redirect_url?: string;
}

export interface OnrampAddress {
  chainId: number;
  address: string;
}

export interface CoinbaseOnrampUrlParams {
  addresses: OnrampAddress[];
  defaultChainId?: number;
  defaultAsset?: string;
  presetFiatAmount?: number;
  fiatCurrency?: string;
  redirectUrl?: string;
}

export interface StripeOnrampSessionParams {
  addresses: OnrampAddress[];
  lockWalletAddress?: boolean;
}

// ============================================
// Cards
// ============================================

export interface CardBillingAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface StoreCreditCardParams {
  card_number: string;
  expiry_month?: string;
  expiry_year?: string;
  expiration?: string;
  cvc: string;
  cardholder_name: string;
  email: string;
  billing_address: CardBillingAddress;
  shipping_address: CardBillingAddress;
  label?: string;
  metadata?: Metadata;
  agentId?: string;
}

export interface LinkPaymentAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface LinkPaymentMethodParams {
  linkPaymentMethodId?: string;
  setAsDefault?: boolean;
  clientName?: string;
  email?: string;
  phone?: string;
  billing?: LinkPaymentAddress;
  shipping?: LinkPaymentAddress;
}

export interface LinkPaymentCredentialParams {
  linkPaymentMethodId?: string;
  spendRequestId?: string;
  amount?: string;
  currency?: string;
  merchantName?: string;
  merchantUrl?: string;
  context?: string;
}

export interface GetCardParams {
  card_type?: 'sponge_card' | 'basis_theory_vaulted';
  payment_method_id?: string;
  amount?: string;
  currency?: string;
  merchant_name?: string;
  merchant_url?: string;
  agentId?: string;
}

export interface IssueVirtualCardParams {
  amount: string;
  currency?: string;
  merchant_name: string;
  merchant_url: string;
  merchant_country_code?: string;
  description?: string;
  products?: unknown[];
  shipping_address?: Record<string, unknown>;
  enrollment_id?: string;
  agentId?: string;
}

export interface ReportCardUsageParams {
  payment_method_id: string;
  merchant_name?: string;
  merchant_domain?: string;
  amount?: string;
  currency?: string;
  status: 'success' | 'failed' | 'cancelled';
  failure_reason?: string;
  agentId?: string;
}

// Sponge Card lifecycle

export interface SpongeCardOnboardParams {
  agentId?: string;
  occupation?: string;
  redirect_uri?: string;
  e_sign_consent?: boolean;
  account_opening_privacy_notice?: boolean;
  sponge_card_terms?: boolean;
  information_certification?: boolean;
  unauthorized_solicitation_acknowledgement?: boolean;
}

export interface SpongeCardTermsParams {
  agentId?: string;
  e_sign_consent: boolean;
  account_opening_privacy_notice?: boolean;
  sponge_card_terms: boolean;
  information_certification: boolean;
  unauthorized_solicitation_acknowledgement: boolean;
}

export interface SpongeCardAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface CreateSpongeCardParams {
  agentId?: string;
  billing: SpongeCardAddress;
  email: string;
  phone: string;
  shipping?: Record<string, unknown>;
}

export interface SpongeCardAmountParams {
  amount: string;
  chain?: string;
  agentId?: string;
}

// ============================================
// Agent Service Keys (Secrets)
// ============================================

export interface AgentKeyParams {
  service: string;
  key: string;
  label?: string;
  metadata?: Metadata;
  agentId?: string;
}

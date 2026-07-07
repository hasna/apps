import { SpongeClient, compact } from './client';
import type {
  EvmTransferParams,
  SolanaTransferParams,
  TokenSearchOptions,
  TransactionHistoryOptions,
  SwapParams,
  BridgeParams,
} from '../types';

/**
 * Transfers API — send funds, list/search tokens, inspect transaction
 * history, and perform swaps/bridges across chains.
 */
export class TransfersApi {
  constructor(private readonly client: SpongeClient) {}

  /** Transfer native/USDC on an EVM chain. */
  evm(params: EvmTransferParams): Promise<unknown> {
    return this.client.post('/api/transfers/evm', { ...params });
  }

  /** Transfer SOL/USDC on Solana. */
  solana(params: SolanaTransferParams): Promise<unknown> {
    return this.client.post('/api/transfers/solana', { ...params });
  }

  /** List known Solana tokens for a chain. */
  solanaTokens(chain: string): Promise<unknown> {
    return this.client.get('/api/solana/tokens', { chain });
  }

  /** Search Solana tokens by name/symbol/mint. */
  searchSolanaTokens(query: string, options: TokenSearchOptions = {}): Promise<unknown> {
    return this.client.get('/api/solana/tokens/search', {
      query,
      limit: options.limit,
    });
  }

  /** List recent transactions. */
  history(options: TransactionHistoryOptions = {}): Promise<unknown> {
    return this.client.get('/api/transactions/history', {
      limit: options.limit,
      chain: options.chain,
    });
  }

  /** Get the status of a transaction by hash. */
  status(txHash: string, chain: string): Promise<unknown> {
    return this.client.get(`/api/transactions/status/${encodeURIComponent(txHash)}`, { chain });
  }

  /** Swap tokens on a chain. */
  swap(params: SwapParams): Promise<unknown> {
    return this.client.post('/api/transactions/swap', compact({ ...params }));
  }

  /** Swap tokens on Base. */
  baseSwap(params: SwapParams): Promise<unknown> {
    return this.client.post('/api/transactions/base-swap', compact({ ...params }));
  }

  /** Bridge tokens between chains. */
  bridge(params: BridgeParams): Promise<unknown> {
    return this.client.post('/api/transactions/bridge', compact({ ...params }));
  }
}

// Alchemy Connector — Blockchain/Web3 development platform (Ethereum, Polygon, etc.)
import { AlchemyClient } from './client';
import type { AlchemyConfig, AlchemyJsonRpcResponse, AlchemyNftList } from '../types';
export { AlchemyClient } from './client';

export class Alchemy {
  private readonly client: AlchemyClient;
  constructor(config: AlchemyConfig) { this.client = new AlchemyClient(config); }
  static fromEnv(): Alchemy {
    const apiKey = process.env.ALCHEMY_API_KEY;
    if (!apiKey) throw new Error('ALCHEMY_API_KEY is required');
    return new Alchemy({ apiKey, network: process.env.ALCHEMY_NETWORK });
  }

  // Core Ethereum JSON-RPC
  async getBalance(address: string, block?: string): Promise<AlchemyJsonRpcResponse<string>> { return this.client.rpc<string>('eth_getBalance', [address, block || 'latest']); }
  async getBlockNumber(): Promise<AlchemyJsonRpcResponse<string>> { return this.client.rpc<string>('eth_blockNumber'); }
  async getBlockByNumber(block: string, fullTx?: boolean): Promise<AlchemyJsonRpcResponse<Record<string, unknown>>> { return this.client.rpc('eth_getBlockByNumber', [block, fullTx ?? false]); }
  async getBlockByHash(hash: string, fullTx?: boolean): Promise<AlchemyJsonRpcResponse<Record<string, unknown>>> { return this.client.rpc('eth_getBlockByHash', [hash, fullTx ?? false]); }
  async getTransactionByHash(hash: string): Promise<AlchemyJsonRpcResponse<Record<string, unknown>>> { return this.client.rpc('eth_getTransactionByHash', [hash]); }
  async getTransactionReceipt(hash: string): Promise<AlchemyJsonRpcResponse<Record<string, unknown>>> { return this.client.rpc('eth_getTransactionReceipt', [hash]); }
  async getTransactionCount(address: string, block?: string): Promise<AlchemyJsonRpcResponse<string>> { return this.client.rpc<string>('eth_getTransactionCount', [address, block || 'latest']); }
  async call(tx: { to: string; data?: string; from?: string }, block?: string): Promise<AlchemyJsonRpcResponse<string>> { return this.client.rpc<string>('eth_call', [tx, block || 'latest']); }
  async estimateGas(tx: { to: string; data?: string; from?: string; value?: string }): Promise<AlchemyJsonRpcResponse<string>> { return this.client.rpc<string>('eth_estimateGas', [tx]); }
  async gasPrice(): Promise<AlchemyJsonRpcResponse<string>> { return this.client.rpc<string>('eth_gasPrice'); }
  async getLogs(filter: { fromBlock?: string; toBlock?: string; address?: string; topics?: string[] }): Promise<AlchemyJsonRpcResponse<unknown[]>> { return this.client.rpc<unknown[]>('eth_getLogs', [filter]); }

  // Alchemy Enhanced APIs
  async getTokenBalances(address: string): Promise<AlchemyJsonRpcResponse<{ address: string; tokenBalances: { contractAddress: string; tokenBalance: string }[] }>> {
    return this.client.rpc('alchemy_getTokenBalances', [address, 'erc20']);
  }
  async getTokenMetadata(contractAddress: string): Promise<AlchemyJsonRpcResponse<{ name: string; symbol: string; decimals: number; logo: string | null }>> {
    return this.client.rpc('alchemy_getTokenMetadata', [contractAddress]);
  }
  async getAssetTransfers(params: { fromBlock?: string; toBlock?: string; fromAddress?: string; toAddress?: string; category: string[]; maxCount?: string }): Promise<AlchemyJsonRpcResponse<{ transfers: unknown[] }>> {
    return this.client.rpc('alchemy_getAssetTransfers', [params]);
  }

  // NFT API v3
  async getNftsForOwner(owner: string, options?: { pageKey?: string; pageSize?: number }): Promise<AlchemyNftList> {
    return this.client.nftRequest<AlchemyNftList>('/getNFTsForOwner', { owner, pageKey: options?.pageKey, pageSize: options?.pageSize });
  }

  getClient(): AlchemyClient { return this.client; }
}

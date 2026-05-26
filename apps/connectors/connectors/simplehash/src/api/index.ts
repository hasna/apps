// SimpleHash Connector — NFT and blockchain data for multi-chain digital assets
import { SimpleHashClient } from './client';
import type { SimpleHashConfig, SHNFT, SHNFTList, SHCollection, SHTransfer } from '../types';
export { SimpleHashClient } from './client';

export class SimpleHash {
  private readonly client: SimpleHashClient;
  constructor(config: SimpleHashConfig) { this.client = new SimpleHashClient(config); }
  static fromEnv(): SimpleHash {
    const apiKey = process.env.SIMPLEHASH_API_KEY;
    if (!apiKey) throw new Error('SIMPLEHASH_API_KEY is required');
    return new SimpleHash({ apiKey });
  }

  async getNFT(chain: string, contractAddress: string, tokenId: string): Promise<SHNFT> {
    return this.client.request<SHNFT>(`/nfts/${chain}/${contractAddress}/${tokenId}`);
  }
  async getNFTsByOwner(chains: string, walletAddress: string, options?: { cursor?: string; limit?: number }): Promise<SHNFTList> {
    return this.client.request<SHNFTList>(`/nfts/owners`, { chains, wallet_addresses: walletAddress, cursor: options?.cursor, limit: options?.limit });
  }
  async getNFTsByContract(chain: string, contractAddress: string, options?: { cursor?: string; limit?: number }): Promise<SHNFTList> {
    return this.client.request<SHNFTList>(`/nfts/${chain}/${contractAddress}`, { cursor: options?.cursor, limit: options?.limit });
  }

  async getCollection(collectionId: string): Promise<SHCollection> {
    return this.client.request<SHCollection>(`/nfts/collections/ids`, { collection_ids: collectionId });
  }
  async getTopCollections(chains: string, options?: { time_period?: string; limit?: number }): Promise<{ collections: SHCollection[] }> {
    return this.client.request('/nfts/collections/top_v2', { chains, time_period: options?.time_period || '24h', limit: options?.limit });
  }

  async getTransfersByWallet(chains: string, walletAddress: string, options?: { cursor?: string; limit?: number }): Promise<{ transfers: SHTransfer[]; next_cursor: string | null }> {
    return this.client.request('/nfts/transfers/wallets', { chains, wallet_addresses: walletAddress, cursor: options?.cursor, limit: options?.limit });
  }

  getClient(): SimpleHashClient { return this.client; }
}

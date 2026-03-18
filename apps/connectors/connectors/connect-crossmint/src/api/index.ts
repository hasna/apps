// Crossmint Connector — NFT minting and Web3 wallet infrastructure
import { CrossmintClient } from './client';
import type { CrossmintConfig, CMWallet, CMCollection, CMNft, CMMintResult } from '../types';
export { CrossmintClient } from './client';

export class Crossmint {
  private readonly client: CrossmintClient;
  constructor(config: CrossmintConfig) { this.client = new CrossmintClient(config); }
  static fromEnv(): Crossmint {
    const apiKey = process.env.CROSSMINT_API_KEY;
    if (!apiKey) throw new Error('CROSSMINT_API_KEY environment variable is required');
    return new Crossmint({ apiKey, environment: (process.env.CROSSMINT_ENV as 'staging' | 'production') || 'production' });
  }

  async createWallet(chain: string, options?: { type?: 'custodial' | 'non-custodial' }): Promise<CMWallet> {
    return this.client.request<CMWallet>('/wallets', { method: 'POST', body: { chain, type: options?.type || 'custodial' } });
  }
  async getWallet(walletId: string): Promise<CMWallet> { return this.client.request<CMWallet>(`/wallets/${walletId}`); }

  async listCollections(): Promise<CMCollection[]> { return this.client.request<CMCollection[]>('/collections'); }
  async getCollection(collectionId: string): Promise<CMCollection> { return this.client.request<CMCollection>(`/collections/${collectionId}`); }
  async createCollection(data: { chain: string; metadata: { name: string; description?: string; image?: string } }): Promise<CMCollection> {
    return this.client.request<CMCollection>('/collections', { method: 'POST', body: data as Record<string, unknown> });
  }

  async mintNft(collectionId: string, data: { recipient: string; metadata: Record<string, unknown> }): Promise<CMMintResult> {
    return this.client.request<CMMintResult>(`/collections/${collectionId}/nfts`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async getNft(collectionId: string, nftId: string): Promise<CMNft> {
    return this.client.request<CMNft>(`/collections/${collectionId}/nfts/${nftId}`);
  }
  async getMintStatus(collectionId: string, mintId: string): Promise<CMMintResult> {
    return this.client.request<CMMintResult>(`/collections/${collectionId}/nfts/${mintId}`);
  }

  getClient(): CrossmintClient { return this.client; }
}

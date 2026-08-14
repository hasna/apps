// Starton Connector — Blockchain infrastructure for smart contracts
import { StartonClient } from './client';
import type { StartonConfig, STSmartContract, STTransaction, STWallet, STNetwork, STIPFSFile } from '../types';
export { StartonClient } from './client';

export class Starton {
  private readonly client: StartonClient;
  constructor(config: StartonConfig) { this.client = new StartonClient(config); }
  static fromEnv(): Starton {
    const apiKey = process.env.STARTON_API_KEY;
    if (!apiKey) throw new Error('STARTON_API_KEY is required');
    return new Starton({ apiKey });
  }

  async deploySmartContract(data: { network: string; name: string; abi: Record<string, unknown>[]; bytecode: string; params: unknown[]; signerWallet: string }): Promise<STSmartContract> {
    return this.client.request<STSmartContract>('/smart-contract/deploy', { method: 'POST', body: data as Record<string, unknown> });
  }
  async listSmartContracts(options?: { network?: string; page?: number; limit?: number }): Promise<{ items: STSmartContract[] }> {
    return this.client.request('/smart-contract', { params: { network: options?.network, page: options?.page, limit: options?.limit } });
  }
  async callSmartContract(network: string, address: string, functionName: string, params: unknown[], signerWallet: string): Promise<STTransaction> {
    return this.client.request<STTransaction>(`/smart-contract/${network}/${address}/call`, { method: 'POST', body: { functionName, params, signerWallet } as Record<string, unknown> });
  }
  async readSmartContract(network: string, address: string, functionName: string, params: unknown[]): Promise<{ response: unknown }> {
    return this.client.request(`/smart-contract/${network}/${address}/read`, { method: 'POST', body: { functionName, params } as Record<string, unknown> });
  }

  async getTransaction(transactionId: string): Promise<STTransaction> { return this.client.request<STTransaction>(`/transaction/${transactionId}`); }

  async listWallets(): Promise<{ items: STWallet[] }> { return this.client.request('/kms/wallet'); }
  async createWallet(data: { network: string; name?: string }): Promise<STWallet> {
    return this.client.request<STWallet>('/kms/wallet', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listNetworks(): Promise<STNetwork[]> { return this.client.request<STNetwork[]>('/network'); }

  async pinFileToIPFS(data: { name: string; cid?: string }): Promise<STIPFSFile> {
    return this.client.request<STIPFSFile>('/ipfs/pin', { method: 'POST', body: data as Record<string, unknown> });
  }
  async listIPFSFiles(): Promise<{ items: STIPFSFile[] }> { return this.client.request('/ipfs/pin'); }

  getClient(): StartonClient { return this.client; }
}

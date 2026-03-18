export interface StartonConfig { apiKey: string; }

export interface STSmartContract { id: string; name: string; network: string; address: string; abi: Record<string, unknown>[]; state: string; createdAt: string; }
export interface STTransaction { id: string; hash: string; network: string; from: string; to: string; value: string; state: string; createdAt: string; }
export interface STWallet { address: string; network: string; kmsId: string; createdAt: string; }
export interface STNetwork { name: string; chainId: number; explorerUrl: string; testnet: boolean; }
export interface STIPFSFile { id: string; cid: string; name: string; size: number; pinStatus: string; createdAt: string; }

export class StartonApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'StartonApiError'; this.statusCode = statusCode; }
}

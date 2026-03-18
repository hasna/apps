export interface CrossmintConfig { apiKey: string; environment?: 'production' | 'staging'; baseUrl?: string; }

export interface CMWallet { id: string; chain: string; publicKey: string; type: 'custodial' | 'non-custodial'; created_at: string; }
export interface CMCollection { id: string; chain: string; contractAddress: string; metadata: { name: string; description?: string; image?: string }; }
export interface CMNft { id: string; chain: string; contractAddress: string; tokenId: string; metadata: Record<string, unknown>; owner: string; }
export interface CMMintResult { id: string; onChain: { status: string; chain: string; contractAddress: string; tokenId?: string }; }

export class CrossmintApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CrossmintApiError'; this.statusCode = statusCode; }
}

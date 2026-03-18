export interface AlchemyConfig { apiKey: string; network?: string; baseUrl?: string; }

export interface AlchemyBalance { jsonrpc: string; id: number; result: string; }
export interface AlchemyBlock { jsonrpc: string; id: number; result: { number: string; hash: string; parentHash: string; timestamp: string; transactions: string[]; gasUsed: string; gasLimit: string; miner: string; }; }
export interface AlchemyTransaction { jsonrpc: string; id: number; result: { hash: string; from: string; to: string; value: string; gas: string; gasPrice: string; nonce: string; blockNumber: string; blockHash: string; input: string; }; }
export interface AlchemyTransactionReceipt { jsonrpc: string; id: number; result: { transactionHash: string; blockNumber: string; from: string; to: string; gasUsed: string; status: string; logs: { address: string; topics: string[]; data: string }[]; }; }
export interface AlchemyTokenBalances { jsonrpc: string; id: number; result: { address: string; tokenBalances: { contractAddress: string; tokenBalance: string }[]; }; }
export interface AlchemyTokenMetadata { jsonrpc: string; id: number; result: { name: string; symbol: string; decimals: number; logo: string | null; }; }
export interface AlchemyNftList { ownedNfts: { contract: { address: string }; tokenId: string; title: string; description: string; tokenUri: { raw: string }; media: { raw: string }[] }[]; totalCount: number; pageKey?: string; }
export interface AlchemyJsonRpcResponse<T = unknown> { jsonrpc: string; id: number; result: T; error?: { code: number; message: string }; }

export class AlchemyApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AlchemyApiError'; this.statusCode = statusCode; }
}

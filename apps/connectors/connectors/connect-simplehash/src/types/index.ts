export interface SimpleHashConfig { apiKey: string; }

export interface SHNFT { nft_id: string; chain: string; contract_address: string; token_id: string; name: string; description: string; image_url: string; previews: { image_small_url: string; image_medium_url: string; image_large_url: string }; collection: { collection_id: string; name: string; image_url: string }; owners: { owner_address: string; quantity: number }[]; last_sale: { total_price: number; payment_token: { symbol: string } } | null; rarity: { rank: number; score: number } | null; }
export interface SHNFTList { nfts: SHNFT[]; next_cursor: string | null; next: string | null; }
export interface SHCollection { collection_id: string; name: string; description: string; image_url: string; chain: string; floor_prices: { marketplace_id: string; value: number; payment_token: { symbol: string } }[]; distinct_nft_count: number; distinct_owner_count: number; total_quantity: number; }
export interface SHTransfer { nft_id: string; chain: string; from_address: string; to_address: string; quantity: number; timestamp: string; transaction: string; }

export class SimpleHashApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SimpleHashApiError'; this.statusCode = statusCode; }
}

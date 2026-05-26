export interface MarketplacerConfig { apiKey: string; baseUrl?: string; }

export interface MPListing { id: string; title: string; description: string; price: number; currency: string; status: string; seller_id: string; category_id: string; images: { url: string }[]; variants: MPVariant[]; created_at: string; updated_at: string; }
export interface MPVariant { id: string; sku: string; price: number; stock: number; option_values: Record<string, string>; }
export interface MPOrder { id: string; status: string; total: number; currency: string; buyer: { id: string; name: string; email: string }; line_items: { listing_id: string; variant_id: string; quantity: number; price: number }[]; created_at: string; }
export interface MPOrderList { orders: MPOrder[]; total: number; page: number; per_page: number; }
export interface MPSeller { id: string; name: string; email: string; status: string; listings_count: number; created_at: string; }
export interface MPCategory { id: string; name: string; parent_id: string | null; children: MPCategory[]; }

export class MarketplacerApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MarketplacerApiError'; this.statusCode = statusCode; }
}

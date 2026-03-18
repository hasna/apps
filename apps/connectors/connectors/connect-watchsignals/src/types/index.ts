export interface WatchSignalsConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface Watch {
  id: string;
  brand: string;
  model: string;
  reference: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  caseMaterial: string | null;
  caseSize: number | null;
  movementType: string | null;
  waterResistance: string | null;
  yearIntroduced: number | null;
}

export interface WatchPrice {
  watchId: string;
  currency: string;
  currentPrice: number | null;
  averagePrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  lastUpdated: string;
  priceCount: number;
}

export interface PriceHistoryEntry {
  date: string;
  price: number;
  currency: string;
  source: string;
}

export interface Brand {
  id: string;
  name: string;
  country: string | null;
  foundedYear: number | null;
  logoUrl: string | null;
}

export interface WatchSearchOptions {
  brand?: string;
  model?: string;
  reference?: string;
  minPrice?: number;
  maxPrice?: number;
  currency?: string;
  page?: number;
  limit?: number;
}

export class WatchSignalsApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WatchSignalsApiError';
    this.statusCode = statusCode;
  }
}

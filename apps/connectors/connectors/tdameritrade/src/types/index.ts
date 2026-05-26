export interface TDAConfig { apiKey: string; accessToken?: string; }

export interface TDAQuote { symbol: string; description: string; bidPrice: number; askPrice: number; lastPrice: number; openPrice: number; highPrice: number; lowPrice: number; closePrice: number; totalVolume: number; mark: number; exchange: string; exchangeName: string; regularMarketLastPrice: number; }
export interface TDAAccount { securitiesAccount: { accountId: string; type: string; currentBalances: { liquidationValue: number; cashBalance: number; availableFunds: number }; positions: TDAPosition[] }; }
export interface TDAPosition { shortQuantity: number; longQuantity: number; averagePrice: number; marketValue: number; instrument: { symbol: string; assetType: string }; }
export interface TDAOrder { orderId: number; status: string; orderType: string; instruction: string; quantity: number; filledQuantity: number; price: number; orderLegCollection: { instruction: string; quantity: number; instrument: { symbol: string; assetType: string } }[]; enteredTime: string; }
export interface TDAPriceHistory { candles: { open: number; high: number; low: number; close: number; volume: number; datetime: number }[]; symbol: string; }
export interface TDASearchResult { [symbol: string]: { symbol: string; description: string; exchange: string; assetType: string }; }

export class TDAApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TDAApiError'; this.statusCode = statusCode; }
}

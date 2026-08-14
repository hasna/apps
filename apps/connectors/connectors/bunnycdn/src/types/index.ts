export interface BunnyCDNConfig { apiKey: string; baseUrl?: string; }

export interface BunnyPullZone { Id: number; Name: string; OriginUrl: string; Enabled: boolean; Hostnames: Array<{ Id: number; Value: string }>; MonthlyBandwidthUsed: number; CacheControlMaxAgeOverride: number; }
export interface BunnyStorageZone { Id: number; Name: string; StorageUsed: number; FilesStored: number; Region: string; ReadOnlyPassword: string; }
export interface BunnyPurgeResult { success: boolean; }
export interface BunnyStats { TotalBandwidthUsed: number; TotalRequestsServed: number; CacheHitRate: number; }

export class BunnyCDNApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'BunnyCDNApiError'; this.statusCode = statusCode; }
}

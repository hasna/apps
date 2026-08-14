import type { GoogleAdsClient } from './client';
import type { MutateResponse } from '../types';

// ============================================
// Bulk Operation Types
// ============================================

export interface BulkOperationOptions {
  /** Maximum concurrent API calls (default: 10) */
  concurrency?: number;
  /** Dry run - don't actually modify */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, item: unknown) => void;
  /** Error callback */
  onError?: (error: Error, item: unknown) => void;
}

// --- Status Change Bulk Operations ---

export interface StatusChangeEntry {
  resourceId: string;
  /** The resource path segment, e.g. 'campaigns', 'adGroups', 'adGroupAds', 'adGroupCriteria' */
  resourceType: 'campaign' | 'adGroup' | 'ad' | 'keyword';
  /** Additional identifiers for composite resources */
  parentId?: string;
}

export interface BulkStatusChangeOptions extends BulkOperationOptions {
  /** Entries to update */
  entries: StatusChangeEntry[];
  /** Target status */
  status: 'ENABLED' | 'PAUSED' | 'REMOVED';
}

export interface BulkStatusChangeResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ resourceId: string; error: string }>;
  results: Array<{ resourceId: string; response: MutateResponse }>;
}

// --- Campaign Bulk Operations ---

export interface BulkCampaignOptions extends BulkOperationOptions {
  campaignIds: string[];
  status: 'ENABLED' | 'PAUSED' | 'REMOVED';
}

export interface BulkCampaignResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ campaignId: string; error: string }>;
  results: Array<{ campaignId: string; response: MutateResponse }>;
}

// --- Ad Group Bulk Operations ---

export interface BulkAdGroupOptions extends BulkOperationOptions {
  adGroupIds: string[];
  status: 'ENABLED' | 'PAUSED';
}

export interface BulkAdGroupResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ adGroupId: string; error: string }>;
  results: Array<{ adGroupId: string; response: MutateResponse }>;
}

// --- Ad Bulk Operations ---

export interface BulkAdOptions extends BulkOperationOptions {
  /** Entries with adGroupId and adId pairs */
  entries: Array<{ adGroupId: string; adId: string }>;
  status: 'ENABLED' | 'PAUSED' | 'REMOVED';
}

export interface BulkAdResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ adGroupId: string; adId: string; error: string }>;
  results: Array<{ adGroupId: string; adId: string; response: MutateResponse }>;
}

// --- Keyword Bulk Operations ---

export interface BulkKeywordOptions extends BulkOperationOptions {
  /** Entries with adGroupId and criterionId pairs */
  entries: Array<{ adGroupId: string; criterionId: string }>;
  status: 'ENABLED' | 'PAUSED' | 'REMOVED';
}

export interface BulkKeywordResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ adGroupId: string; criterionId: string; error: string }>;
  results: Array<{ adGroupId: string; criterionId: string; response: MutateResponse }>;
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly client: GoogleAdsClient;

  constructor(client: GoogleAdsClient) {
    this.client = client;
  }

  // ============================================
  // Bulk Campaign Status Changes
  // ============================================

  async campaigns(options: BulkCampaignOptions): Promise<BulkCampaignResult> {
    const { campaignIds, status, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkCampaignResult = {
      total: campaignIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (campaignIds.length === 0) return result;

    const chunks = this.chunkArray(campaignIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (campaignId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              const operation = status === 'REMOVED'
                ? { remove: `customers/${this.client.getCustomerId()}/campaigns/${campaignId}` }
                : {
                    update: {
                      resourceName: `customers/${this.client.getCustomerId()}/campaigns/${campaignId}`,
                      status,
                    },
                    updateMask: 'status',
                  };

              const response = await this.client.mutate('campaigns', [operation]);
              result.success++;
              result.results.push({ campaignId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, campaignId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ campaignId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), campaignId);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Ad Group Status Changes
  // ============================================

  async adGroups(options: BulkAdGroupOptions): Promise<BulkAdGroupResult> {
    const { adGroupIds, status, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkAdGroupResult = {
      total: adGroupIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (adGroupIds.length === 0) return result;

    const chunks = this.chunkArray(adGroupIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (adGroupId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              const operation = {
                update: {
                  resourceName: `customers/${this.client.getCustomerId()}/adGroups/${adGroupId}`,
                  status,
                },
                updateMask: 'status',
              };

              const response = await this.client.mutate('adGroups', [operation]);
              result.success++;
              result.results.push({ adGroupId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, adGroupId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ adGroupId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), adGroupId);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Ad Status Changes
  // ============================================

  async ads(options: BulkAdOptions): Promise<BulkAdResult> {
    const { entries, status, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkAdResult = {
      total: entries.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (entries.length === 0) return result;

    const chunks = this.chunkArray(entries, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (entry) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              const operation = status === 'REMOVED'
                ? { remove: `customers/${this.client.getCustomerId()}/adGroupAds/${entry.adGroupId}~${entry.adId}` }
                : {
                    update: {
                      resourceName: `customers/${this.client.getCustomerId()}/adGroupAds/${entry.adGroupId}~${entry.adId}`,
                      status,
                    },
                    updateMask: 'status',
                  };

              const response = await this.client.mutate('adGroupAds', [operation]);
              result.success++;
              result.results.push({ adGroupId: entry.adGroupId, adId: entry.adId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, entry);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({
              adGroupId: entry.adGroupId,
              adId: entry.adId,
              error: errorMessage,
            });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), entry);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Keyword Status Changes
  // ============================================

  async keywords(options: BulkKeywordOptions): Promise<BulkKeywordResult> {
    const { entries, status, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkKeywordResult = {
      total: entries.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (entries.length === 0) return result;

    const chunks = this.chunkArray(entries, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (entry) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              const operation = status === 'REMOVED'
                ? { remove: `customers/${this.client.getCustomerId()}/adGroupCriteria/${entry.adGroupId}~${entry.criterionId}` }
                : {
                    update: {
                      resourceName: `customers/${this.client.getCustomerId()}/adGroupCriteria/${entry.adGroupId}~${entry.criterionId}`,
                      status,
                    },
                    updateMask: 'status',
                  };

              const response = await this.client.mutate('adGroupCriteria', [operation]);
              result.success++;
              result.results.push({ adGroupId: entry.adGroupId, criterionId: entry.criterionId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, entry);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({
              adGroupId: entry.adGroupId,
              criterionId: entry.criterionId,
              error: errorMessage,
            });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), entry);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Helper Methods
  // ============================================

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

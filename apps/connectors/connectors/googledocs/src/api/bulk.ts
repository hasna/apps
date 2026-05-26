import type { GoogleDocsClient } from './client';
import type { Document, Request, BatchUpdateResponse } from '../types';

// ============================================
// Bulk Operation Types
// ============================================

export interface DocumentSummary {
  documentId: string;
  title: string;
}

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

export interface BulkCreateDocumentsOptions extends BulkOperationOptions {
  /** Document titles to create */
  titles: string[];
}

export interface BulkCreateDocumentsResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ title: string; error: string }>;
  createdDocuments: DocumentSummary[];
}

export interface FindReplaceEntry {
  documentId: string;
  find: string;
  replace: string;
  matchCase?: boolean;
}

export interface BulkFindReplaceOptions extends BulkOperationOptions {
  /** Find/replace entries per document */
  entries: FindReplaceEntry[];
}

export interface FindReplaceResult {
  documentId: string;
  occurrencesChanged: number;
  find: string;
  replace: string;
}

export interface BulkFindReplaceResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ documentId: string; find: string; error: string }>;
  results: FindReplaceResult[];
}

export interface BulkOperationEntry {
  documentId: string;
  requests: Request[];
}

export interface BulkBatchUpdateOptions extends BulkOperationOptions {
  /** Batch update entries */
  entries: BulkOperationEntry[];
}

export interface BulkBatchUpdateResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ documentId: string; error: string }>;
  results: Array<{ documentId: string; response: BatchUpdateResponse }>;
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly client: GoogleDocsClient;

  constructor(client: GoogleDocsClient) {
    this.client = client;
  }

  // ============================================
  // Create Documents
  // ============================================

  /**
   * Bulk create documents from a list of titles
   */
  async createDocuments(
    options: BulkCreateDocumentsOptions
  ): Promise<BulkCreateDocumentsResult> {
    const { titles, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkCreateDocumentsResult = {
      total: titles.length,
      success: 0,
      failed: 0,
      errors: [],
      createdDocuments: [],
    };

    if (titles.length === 0) return result;

    const chunks = this.chunkArray(titles, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (title) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              const doc = await this.client.post<Document>('/documents', { title });
              result.success++;
              result.createdDocuments.push({
                documentId: doc.documentId,
                title: doc.title,
              });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, title);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ title, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), title);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Find/Replace
  // ============================================

  /**
   * Bulk find and replace across multiple documents
   */
  async findReplace(
    options: BulkFindReplaceOptions
  ): Promise<BulkFindReplaceResult> {
    const { entries, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkFindReplaceResult = {
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
              result.results.push({
                documentId: entry.documentId,
                occurrencesChanged: 0,
                find: entry.find,
                replace: entry.replace,
              });
            } else {
              const requests: Request[] = [
                {
                  replaceAllText: {
                    containsText: {
                      text: entry.find,
                      matchCase: entry.matchCase || false,
                    },
                    replaceText: entry.replace,
                  },
                },
              ];

              const response = await this.client.post<BatchUpdateResponse>(
                `/documents/${entry.documentId}:batchUpdate`,
                { requests }
              );

              const occurrencesChanged =
                response.replies?.find((r) => r.replaceAllText)?.replaceAllText?.occurrencesChanged || 0;

              result.success++;
              result.results.push({
                documentId: entry.documentId,
                occurrencesChanged,
                find: entry.find,
                replace: entry.replace,
              });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, entry);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({
              documentId: entry.documentId,
              find: entry.find,
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
  // Batch Update (generic)
  // ============================================

  /**
   * Bulk batch updates across multiple documents
   * Each entry specifies a document ID and an array of requests
   */
  async batchUpdate(
    options: BulkBatchUpdateOptions
  ): Promise<BulkBatchUpdateResult> {
    const { entries, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkBatchUpdateResult = {
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
              const response = await this.client.post<BatchUpdateResponse>(
                `/documents/${entry.documentId}:batchUpdate`,
                { requests: entry.requests }
              );
              result.success++;
              result.results.push({
                documentId: entry.documentId,
                response,
              });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, entry);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({
              documentId: entry.documentId,
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

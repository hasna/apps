// ============================================
// Bulk Operations Utility
// ============================================

/**
 * Options for bulk operations
 */
export interface BulkOperationOptions<T> {
  /** Items to process */
  items: T[];
  /** Maximum concurrent operations (default: 10) */
  concurrency?: number;
  /** Dry run - preview without making changes */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, item: T) => void;
  /** Error callback (return true to continue, false to stop) */
  onError?: (error: Error, item: T) => boolean | void;
  /** Delay between batches in ms (useful for rate limiting) */
  batchDelay?: number;
}

/**
 * Result of a bulk operation
 */
export interface BulkOperationResult<T, R = void> {
  /** Total items processed */
  total: number;
  /** Successfully processed count */
  success: number;
  /** Failed count */
  failed: number;
  /** Skipped count (dry run) */
  skipped: number;
  /** List of errors */
  errors: Array<{ item: T; error: string }>;
  /** Successfully processed items with results */
  results: Array<{ item: T; result: R }>;
}

/**
 * Split an array into chunks of a given size
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a bulk operation with concurrency control
 *
 * @param options - Bulk operation options
 * @param operation - Async function to execute for each item
 * @returns Result summary
 *
 * @example
 * ```typescript
 * const result = await executeBulk(
 *   {
 *     items: users,
 *     concurrency: 5,
 *     onProgress: (current, total, user) => {
 *       console.log(`Processing ${current}/${total}: ${user.email}`);
 *     },
 *   },
 *   async (user) => {
 *     await api.updateUser(user.id, { status: 'active' });
 *   }
 * );
 * console.log(`Success: ${result.success}, Failed: ${result.failed}`);
 * ```
 */
export async function executeBulk<T, R = void>(
  options: BulkOperationOptions<T>,
  operation: (item: T) => Promise<R>
): Promise<BulkOperationResult<T, R>> {
  const {
    items,
    concurrency = 10,
    dryRun = false,
    onProgress,
    onError,
    batchDelay = 0,
  } = options;

  const result: BulkOperationResult<T, R> = {
    total: items.length,
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    results: [],
  };

  if (items.length === 0) {
    return result;
  }

  // Process in batches with concurrency control
  const chunks = chunkArray(items, concurrency);
  let shouldStop = false;

  for (let chunkIndex = 0; chunkIndex < chunks.length && !shouldStop; chunkIndex++) {
    const chunk = chunks[chunkIndex];

    await Promise.all(
      chunk.map(async (item) => {
        if (shouldStop) return;

        try {
          if (dryRun) {
            result.skipped++;
            result.results.push({ item, result: undefined as R });
          } else {
            const opResult = await operation(item);
            result.success++;
            result.results.push({ item, result: opResult });
          }

          if (onProgress) {
            onProgress(result.success + result.failed + result.skipped, result.total, item);
          }
        } catch (err) {
          result.failed++;
          const errorMessage = err instanceof Error ? err.message : String(err);
          result.errors.push({ item, error: errorMessage });

          if (onError) {
            const shouldContinue = onError(err instanceof Error ? err : new Error(errorMessage), item);
            if (shouldContinue === false) {
              shouldStop = true;
            }
          }
        }
      })
    );

    // Add delay between batches if specified (for rate limiting)
    if (batchDelay > 0 && chunkIndex < chunks.length - 1) {
      await sleep(batchDelay);
    }
  }

  return result;
}

/**
 * Execute operations sequentially (one at a time)
 * Useful when operations must be processed in order
 */
export async function executeSequential<T, R = void>(
  options: Omit<BulkOperationOptions<T>, 'concurrency'>,
  operation: (item: T) => Promise<R>
): Promise<BulkOperationResult<T, R>> {
  return executeBulk({ ...options, concurrency: 1 }, operation);
}

/**
 * Create a progress reporter for bulk operations
 */
export function createProgressReporter(prefix: string = 'Processing') {
  let lastPercent = -1;

  return (current: number, total: number, _item: unknown): void => {
    const percent = Math.floor((current / total) * 100);
    if (percent !== lastPercent) {
      lastPercent = percent;
      process.stdout.write(`\r${prefix}: ${current}/${total} (${percent}%)`);
      if (current === total) {
        process.stdout.write('\n');
      }
    }
  };
}

/**
 * Format bulk operation result for display
 */
export function formatBulkResult<T>(result: BulkOperationResult<T, unknown>): string {
  const lines: string[] = [
    `Total: ${result.total}`,
    `Success: ${result.success}`,
    `Failed: ${result.failed}`,
  ];

  if (result.skipped > 0) {
    lines.push(`Skipped (dry run): ${result.skipped}`);
  }

  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const { error } of result.errors.slice(0, 10)) {
      lines.push(`  - ${error}`);
    }
    if (result.errors.length > 10) {
      lines.push(`  ... and ${result.errors.length - 10} more errors`);
    }
  }

  return lines.join('\n');
}

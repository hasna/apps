/** Run every item with bounded concurrency; retain input order and rejection identity. */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Concurrency limit must be a positive integer");
  const results = new Array<R>(items.length);
  const failures = new Map<number, unknown>();
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try { results[index] = await worker(items[index]!, index); }
      catch (error) { failures.set(index, error); }
    }
  }
  // Drain all workers before propagating failure: no orphaned registry subprocesses.
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  if (failures.size) throw failures.get(Math.min(...failures.keys()));
  return results;
}

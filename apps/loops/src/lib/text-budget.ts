/**
 * Size budgeting for text that has to survive a transport or a storage limit.
 *
 * Two consumers, one primitive:
 *  - `src/lib/store.ts` bounds what a run's stdout/stderr costs to KEEP.
 *  - `src/runner/index.ts` bounds what a finalize body costs to SEND.
 *
 * The two limits are not the same number and must not be conflated. Storage
 * retention clamps each field independently; a transport limit applies to the
 * whole serialized request, so a per-field clamp set to the transport limit
 * still produces a body several times over it.
 */

/** Fields whose content is clamped are marked so a reader can tell a truncated run from a short one. */
export function truncationMarker(reason: string): string {
  return `\n...[truncated by ${reason}]...\n`;
}

export interface ClampTextOptions {
  /**
   * Share of the surviving budget given to the END of the value, 0..1.
   * Defaults to an even split. Transport budgeting raises this because the end
   * of a killed process's output is where the failure is.
   */
  tailShare?: number;
}

/**
 * Clamp `value` to at most `maxChars` characters, keeping a head and a tail
 * around a marker naming `reason`. The marker is paid for out of `maxChars`,
 * so the result never exceeds it: when `maxChars` cannot even hold the marker
 * the value is dropped entirely rather than silently overrunning the budget.
 */
export function clampTextToChars(value: string, maxChars: number, reason: string, opts: ClampTextOptions = {}): string {
  if (value.length <= maxChars) return value;
  const marker = truncationMarker(reason);
  if (maxChars < marker.length) return "";
  const budget = maxChars - marker.length;
  const tailShare = Math.min(1, Math.max(0, opts.tailShare ?? 0.5));
  const tailLength = Math.min(budget, Math.round(budget * tailShare));
  const headLength = budget - tailLength;
  const head = headLength > 0 ? value.slice(0, headLength) : "";
  const tail = tailLength > 0 ? value.slice(value.length - tailLength) : "";
  return `${head}${marker}${tail}`;
}

/** Serialized size of a JSON body in bytes — what a `content-length` check and a byte-counting reader both measure. */
export function jsonBodyBytes(body: unknown): number {
  return Buffer.byteLength(JSON.stringify(body) ?? "", "utf8");
}

export interface JsonBodyBudgetResult<T> {
  /** A body whose serialized size is <= `limitBytes` whenever that is achievable at all. */
  body: T;
  /** Measured serialized size of `body`. */
  bytes: number;
  /** True when any field was clamped. */
  truncated: boolean;
  /** True when even the body with every text field emptied exceeds `limitBytes`. */
  overLimit: boolean;
}

const MAX_SHRINK_ITERATIONS = 12;

/**
 * Bound the serialized size of a JSON body by clamping its text-bearing fields.
 *
 * Budgeting the WHOLE body is the point. Two fields each clamped to the
 * transport limit are twice the limit together, and JSON escaping makes the
 * relationship between characters and bytes non-linear — a single control
 * character costs six bytes — so the size is measured after every clamp rather
 * than predicted from a character count.
 *
 * The budget is shared fairly across the named fields, with fields that need
 * less than their share donating the remainder to fields that need more, so a
 * large stdout beside a small stderr does not waste half the budget.
 */
export function budgetJsonBody<T extends Record<string, unknown>>(
  body: T,
  textFields: readonly string[],
  limitBytes: number,
  reason: string,
  opts: ClampTextOptions = {},
): JsonBodyBudgetResult<T> {
  const initialBytes = jsonBodyBytes(body);
  if (initialBytes <= limitBytes) return { body, bytes: initialBytes, truncated: false, overLimit: false };

  const present = textFields.filter((field) => typeof body[field] === "string" && (body[field] as string).length > 0);
  const emptied = { ...body } as Record<string, unknown>;
  for (const field of present) emptied[field] = "";
  const baseBytes = jsonBodyBytes(emptied);

  // Nothing this function can clamp will bring the body under the limit.
  if (baseBytes > limitBytes || present.length === 0) {
    return { body: emptied as T, bytes: baseBytes, truncated: present.length > 0, overLimit: baseBytes > limitBytes };
  }

  const sizes = present.map((field) => (body[field] as string).length);
  let allocations = fairShare(sizes, limitBytes - baseBytes);

  for (let iteration = 0; iteration < MAX_SHRINK_ITERATIONS; iteration += 1) {
    const candidate = { ...body } as Record<string, unknown>;
    present.forEach((field, index) => {
      candidate[field] = clampTextToChars(body[field] as string, allocations[index] ?? 0, reason, opts);
    });
    const bytes = jsonBodyBytes(candidate);
    if (bytes <= limitBytes) return { body: candidate as T, bytes, truncated: true, overLimit: false };

    const nextAllocations = shrink(allocations, sizes, limitBytes - baseBytes, bytes - baseBytes);
    // `shrink` decreases strictly until every allocation is zero, at which point
    // the body equals `emptied`, which was proven above to be within the limit.
    if (nextAllocations.every((value, index) => value === allocations[index])) break;
    allocations = nextAllocations;
  }

  return { body: emptied as T, bytes: baseBytes, truncated: true, overLimit: false };
}

/** Split `budget` across `sizes`, letting fields that need less than an even share donate the remainder. */
function fairShare(sizes: readonly number[], budget: number): number[] {
  const allocations = new Array<number>(sizes.length).fill(0);
  let remaining = Math.max(0, budget);
  const pending = sizes.map((size, index) => ({ size, index })).sort((a, b) => a.size - b.size);

  pending.forEach(({ size, index }, position) => {
    const share = Math.floor(remaining / (pending.length - position));
    const take = Math.min(size, share);
    allocations[index] = take;
    remaining -= take;
  });
  return allocations;
}

/**
 * Scale allocations down by the measured overshoot, always strictly decreasing
 * until they reach zero, so the loop terminates.
 *
 * Fields already given their whole value are left alone while any field is
 * still being truncated: cutting a field that fits buys no bytes it was not
 * already spending, and it is how a four-character stderr gets destroyed to make
 * room for a stdout that is a thousand times its size.
 */
function shrink(allocations: readonly number[], sizes: readonly number[], budget: number, actual: number): number[] {
  const ratio = actual > 0 ? Math.min(1, budget / actual) : 0;
  // Prefer the fields that are already losing content. Once they are exhausted
  // the fully-kept fields become fair game, so the loop still reaches zero.
  const truncated = allocations
    .map((allocation, index) => (allocation > 0 && allocation < (sizes[index] ?? 0) ? index : -1))
    .filter((index) => index >= 0);
  const shrinkable = truncated.length > 0 ? new Set(truncated) : undefined;

  return allocations.map((allocation, index) => {
    if (allocation === 0) return 0;
    if (shrinkable && !shrinkable.has(index)) return allocation;
    return Math.max(0, Math.min(allocation - 1, Math.floor(allocation * ratio)));
  });
}

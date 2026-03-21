/**
 * Element ref cache — stores snapshot refs in mementos so repeat page visits
 * skip the snapshot entirely (0 tokens for known pages).
 */

import type { RefInfo } from "../types/index.js";

const REF_CACHE_PREFIX = "browser-refs:";
const REF_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// In-memory L1 cache (always available, fast)
const l1Cache = new Map<string, { refs: Record<string, RefInfo>; expires: number }>();

function cacheKey(url: string): string {
  try {
    const u = new URL(url);
    return `${REF_CACHE_PREFIX}${u.hostname}${u.pathname}`;
  } catch {
    return `${REF_CACHE_PREFIX}${url}`;
  }
}

async function getMementosSDK() {
  try { return await import("@hasna/mementos"); } catch { return null; }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function cacheRefs(url: string, refs: Record<string, RefInfo>): Promise<void> {
  const key = cacheKey(url);
  const expires = Date.now() + REF_CACHE_TTL_MS;

  // Always write L1
  l1Cache.set(key, { refs, expires });

  // Write to mementos L2 for cross-session persistence
  const sdk = await getMementosSDK();
  if (sdk?.createMemory) {
    try {
      await sdk.createMemory({
        key,
        value: JSON.stringify(refs),
        category: "knowledge",
        scope: "shared",
        importance: 5,
        tags: ["browser-refs", "element-cache"],
        ttl_ms: REF_CACHE_TTL_MS,
      });
    } catch {}
  }
}

export async function getCachedRefs(url: string): Promise<Record<string, RefInfo> | null> {
  const key = cacheKey(url);

  // Check L1 first (fastest)
  const l1 = l1Cache.get(key);
  if (l1 && l1.expires > Date.now()) return l1.refs;

  // Check L2 (mementos)
  const sdk = await getMementosSDK();
  if (sdk?.getMemoryByKey) {
    try {
      const mem = await sdk.getMemoryByKey(key);
      if (mem) {
        const refs = JSON.parse(mem.value) as Record<string, RefInfo>;
        // Populate L1 for next time
        l1Cache.set(key, { refs, expires: Date.now() + REF_CACHE_TTL_MS });
        return refs;
      }
    } catch {}
  }

  return null;
}

export function invalidateRefCache(url?: string): void {
  if (url) {
    l1Cache.delete(cacheKey(url));
  } else {
    // Clear all browser-refs entries
    for (const key of l1Cache.keys()) {
      if (key.startsWith(REF_CACHE_PREFIX)) l1Cache.delete(key);
    }
  }
}

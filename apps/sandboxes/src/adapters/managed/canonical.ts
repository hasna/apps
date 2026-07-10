import { createHash } from "node:crypto"
import type { Digest } from "./types"

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString(10) }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new TypeError("non_canonical_value")
    return value
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("non_canonical_value")
  }
  if (typeof value === "string" && /[\ud800-\udfff]/u.test(value)) {
    throw new TypeError("non_canonical_value")
  }
  if (value instanceof Uint8Array) return { $bytes_hex: Buffer.from(value).toString("hex") }
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("non_canonical_value")
    if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
      throw new TypeError("non_canonical_value")
    }
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key]
      normalized[key] = normalize(item)
    }
    return normalized
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

export function canonicalSha256(value: unknown): Digest {
  const hash = createHash("sha256")
  if (value instanceof Uint8Array) hash.update(value)
  else hash.update(canonicalJson(value), "utf8")
  return `sha256:${hash.digest("hex")}`
}

export function isDigest(value: unknown): value is Digest {
  return typeof value === "string" && DIGEST_PATTERN.test(value)
}

export function safeEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

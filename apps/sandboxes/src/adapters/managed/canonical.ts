import { createHash } from "node:crypto"
import type { Digest } from "./types"

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString(10)
  if (value instanceof Uint8Array) return { $bytes_hex: Buffer.from(value).toString("hex") }
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === "object") {
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) normalized[key] = normalize(item)
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

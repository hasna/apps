import { createHash } from "node:crypto"
import type { Digest } from "./types"

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/
const DECIMAL_BIGINT_PATTERN = /^(?:0|-?[1-9][0-9]*)$/u
const LOWERCASE_HEX_PATTERN = /^(?:[0-9a-f]{2})*$/u
const UNPAIRED_SURROGATE_PATTERN = /[\ud800-\udfff]/u

type CanonicalEnvelope =
  | readonly ["null"]
  | readonly ["boolean", boolean]
  | readonly ["integer", number]
  | readonly ["string", string]
  | readonly ["bigint", string]
  | readonly ["bytes", string]
  | readonly ["array", readonly CanonicalEnvelope[]]
  | readonly ["record", readonly (readonly [string, CanonicalEnvelope])[]]

function nonCanonical(): never {
  throw new TypeError("non_canonical_value")
}

function validateCanonicalString(value: string): string {
  if (UNPAIRED_SURROGATE_PATTERN.test(value)) nonCanonical()
  return value
}

/**
 * Snapshots a real array by walking own property descriptors only. Holes,
 * accessors, hidden indexes, inherited indexes, and extra keys are rejected.
 */
export function snapshotCanonicalDenseArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) nonCanonical()

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length")
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.enumerable ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    nonCanonical()
  }
  const length = lengthDescriptor.value
  const keys = Reflect.ownKeys(value)
  if (keys.length !== length + 1 || !keys.includes("length")) nonCanonical()

  const snapshot = new Array<unknown>(length)
  for (let index = 0; index < length; index += 1) {
    const key = String(index)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      nonCanonical()
    }
    snapshot[index] = descriptor.value
  }
  return snapshot
}

function encodeCanonical(value: unknown): CanonicalEnvelope {
  if (value === null) return ["null"]
  if (typeof value === "boolean") return ["boolean", value]
  if (typeof value === "bigint") return ["bigint", value.toString(10)]
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) nonCanonical()
    return ["integer", value]
  }
  if (typeof value === "string") return ["string", validateCanonicalString(value)]
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    nonCanonical()
  }
  if (value instanceof Uint8Array) {
    return ["bytes", Buffer.from(value).toString("hex")]
  }
  if (Array.isArray(value)) {
    const values = snapshotCanonicalDenseArray(value)
    const encoded: CanonicalEnvelope[] = []
    for (const item of values) encoded.push(encodeCanonical(item))
    return ["array", encoded]
  }
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) nonCanonical()
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key === "symbol")) nonCanonical()
    const encoded: Array<readonly [string, CanonicalEnvelope]> = []
    for (const key of (keys as string[]).sort()) {
      validateCanonicalString(key)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        nonCanonical()
      }
      encoded.push([key, encodeCanonical(descriptor.value)])
    }
    return ["record", encoded]
  }
  return nonCanonical()
}

function decodeCanonical(value: unknown): unknown {
  const envelope = snapshotCanonicalDenseArray(value)
  const tag = envelope[0]
  if (typeof tag !== "string") nonCanonical()

  switch (tag) {
    case "null":
      if (envelope.length !== 1) nonCanonical()
      return null
    case "boolean":
      if (envelope.length !== 2 || typeof envelope[1] !== "boolean") nonCanonical()
      return envelope[1]
    case "integer":
      if (
        envelope.length !== 2 ||
        typeof envelope[1] !== "number" ||
        !Number.isSafeInteger(envelope[1]) ||
        Object.is(envelope[1], -0)
      ) {
        nonCanonical()
      }
      return envelope[1]
    case "string":
      if (envelope.length !== 2 || typeof envelope[1] !== "string") nonCanonical()
      return validateCanonicalString(envelope[1])
    case "bigint": {
      if (
        envelope.length !== 2 ||
        typeof envelope[1] !== "string" ||
        !DECIMAL_BIGINT_PATTERN.test(envelope[1])
      ) {
        nonCanonical()
      }
      return BigInt(envelope[1])
    }
    case "bytes": {
      if (
        envelope.length !== 2 ||
        typeof envelope[1] !== "string" ||
        !LOWERCASE_HEX_PATTERN.test(envelope[1])
      ) {
        nonCanonical()
      }
      return Uint8Array.from(Buffer.from(envelope[1], "hex"))
    }
    case "array": {
      if (envelope.length !== 2) nonCanonical()
      const items = snapshotCanonicalDenseArray(envelope[1])
      const decoded: unknown[] = []
      for (const item of items) decoded.push(decodeCanonical(item))
      return decoded
    }
    case "record": {
      if (envelope.length !== 2) nonCanonical()
      const entries = snapshotCanonicalDenseArray(envelope[1])
      const decoded = Object.create(null) as Record<string, unknown>
      let previousKey: string | undefined
      for (const entry of entries) {
        const pair = snapshotCanonicalDenseArray(entry)
        if (pair.length !== 2 || typeof pair[0] !== "string") nonCanonical()
        const key = validateCanonicalString(pair[0])
        if (previousKey !== undefined && previousKey >= key) nonCanonical()
        Object.defineProperty(decoded, key, {
          enumerable: true,
          value: decodeCanonical(pair[1]),
        })
        previousKey = key
      }
      return decoded
    }
    default:
      return nonCanonical()
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(encodeCanonical(value))
}

export function parseCanonicalJson(text: string): unknown {
  let encoded: unknown
  try {
    encoded = JSON.parse(text)
  } catch {
    return nonCanonical()
  }
  const decoded = decodeCanonical(encoded)
  if (canonicalJson(decoded) !== text) nonCanonical()
  return decoded
}

export function canonicalSha256(value: unknown): Digest {
  const hash = createHash("sha256")
  hash.update(canonicalJson(value), "utf8")
  return `sha256:${hash.digest("hex")}`
}

export function isDigest(value: unknown): value is Digest {
  return typeof value === "string" && DIGEST_PATTERN.test(value)
}

export function safeEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

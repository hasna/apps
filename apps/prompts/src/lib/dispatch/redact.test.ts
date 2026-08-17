import { describe, expect, test } from "bun:test"
import { boundAndRedact, boundBytes, redactText, TRUNCATED_MARKER } from "./redact.js"

const frag = (...parts: string[]): string => parts.join("")

describe("redactText", () => {
  test("redacts Anthropic key shapes", () => {
    const key = frag("sk-", "ant-", "AbCdEf0123456789AbCdEf0123")
    const out = redactText(`token here: ${key} end`)
    expect(out).not.toContain(key)
    expect(out).toContain("[REDACTED]")
  })

  test("redacts npm and GitHub token shapes", () => {
    const npm = frag("npm_", "AbCdEf0123456789AbCdEf0123456789")
    const gh = frag("ghp", "_", "AbCdEf0123456789AbCdEf0123456789")
    const out = redactText(`npm=${npm} gh=${gh}`)
    expect(out).not.toContain(npm)
    expect(out).not.toContain(gh)
    expect(out).toContain("[REDACTED]")
  })

  test("redacts keyed assignments with quoted keys and values", () => {
    const out = redactText(`"api_key": "super-secret-value-12345"`)
    expect(out).not.toContain("super-secret-value-12345")
    expect(out).toContain("[REDACTED]")
  })

  test("redacts PEM private key blocks", () => {
    const pem = frag(
      "-----BEGIN ",
      "PRIVATE KEY-----\nMIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA\n-----END ",
      "PRIVATE KEY-----"
    )
    const out = redactText(`key:\n${pem}`)
    expect(out).not.toContain("MIIBVAIBADAN")
    expect(out).toContain("[REDACTED]")
  })

  test("leaves ordinary prose untouched", () => {
    const out = redactText("The quick brown fox jumps over the lazy dog. Use --var name=value.")
    expect(out).toBe("The quick brown fox jumps over the lazy dog. Use --var name=value.")
  })
})

describe("boundBytes", () => {
  test("keeps text under the byte bound", () => {
    const { text, truncated } = boundBytes("hello world", 100)
    expect(truncated).toBe(false)
    expect(text).toBe("hello world")
  })

  test("truncates at the byte bound with a truncation marker", () => {
    const body = "x".repeat(500)
    const { text, truncated } = boundAndRedact(body, 128)
    expect(truncated).toBe(true)
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(128 + Buffer.byteLength(TRUNCATED_MARKER, "utf8") + 1)
    expect(text.endsWith(TRUNCATED_MARKER)).toBe(true)
  })

  test("redaction happens after bounding and keeps the bound", () => {
    const key = frag("sk-", "ant-", "AbCdEf0123456789AbCdEf0123")
    // The key sits inside the bounded window (40 + key + padding < 128), so
    // redaction must replace it in place rather than being skipped by the cut.
    const body = "a".repeat(40) + " " + key + " " + "b".repeat(200)
    const { text, truncated } = boundAndRedact(body, 128)
    expect(truncated).toBe(true)
    expect(text).not.toContain(key)
    expect(text).toContain("[REDACTED]")
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(128 + Buffer.byteLength(TRUNCATED_MARKER, "utf8") + 1)
  })
})

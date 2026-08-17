import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  resolvePromptsClientTransport,
  assertNoRetiredPromptsStorageSelector,
  RetiredPromptsStorageSelectorError,
  PROMPTS_API_URL_ENV,
  PROMPTS_API_KEY_ENV,
  RETIRED_PROMPTS_SELECTOR_ENV_KEYS,
  RETIRED_PROMPTS_REGISTRY_ENV_KEYS,
} from "./client-transport.js"

describe("client transport selection", () => {
  let originals: Record<string, string | undefined>

  beforeEach(() => {
    originals = {}
    for (const key of [PROMPTS_API_URL_ENV, PROMPTS_API_KEY_ENV, ...RETIRED_PROMPTS_SELECTOR_ENV_KEYS, ...RETIRED_PROMPTS_REGISTRY_ENV_KEYS]) {
      originals[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test("absent API URL selects the on-box sqlite transport", () => {
    const report = resolvePromptsClientTransport()
    expect(report.transport).toBe("sqlite")
    expect(report.source).toBe("default")
  })

  test("API URL plus key selects http", () => {
    process.env[PROMPTS_API_URL_ENV] = "http://localhost:19430"
    process.env[PROMPTS_API_KEY_ENV] = "hasna_prompts_key"
    const report = resolvePromptsClientTransport()
    expect(report.transport).toBe("http")
    expect(report.source).toBe(PROMPTS_API_URL_ENV)
  })

  test("API URL without its key fails closed instead of drifting to sqlite", () => {
    process.env[PROMPTS_API_URL_ENV] = "http://localhost:19430"
    expect(() => resolvePromptsClientTransport()).toThrow(
      new RegExp(`${PROMPTS_API_KEY_ENV} is missing`),
    )
  })

  test("blank API URL is treated as absent", () => {
    process.env[PROMPTS_API_URL_ENV] = "   "
    expect(resolvePromptsClientTransport().transport).toBe("sqlite")
  })

  test("retired selector names fail loudly even when blank", () => {
    for (const key of RETIRED_PROMPTS_SELECTOR_ENV_KEYS) {
      process.env[key] = ""
      expect(() => assertNoRetiredPromptsStorageSelector(process.env)).toThrow(RetiredPromptsStorageSelectorError)
      expect(() => resolvePromptsClientTransport(process.env)).toThrow(RetiredPromptsStorageSelectorError)
      delete process.env[key]
    }
  })

  test("retired registry diagnostics names fail loudly", () => {
    for (const key of RETIRED_PROMPTS_REGISTRY_ENV_KEYS) {
      process.env[key] = "value"
      expect(() => resolvePromptsClientTransport(process.env)).toThrow(RetiredPromptsStorageSelectorError)
      delete process.env[key]
    }
  })
})

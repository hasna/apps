import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  LocalBodyStore,
  normalizeBodyKey,
  promptBodyKey,
  sha256Hex,
  bytesOf,
  readBodyVerified,
  PromptBodyMissingError,
  PromptBodyCorruptError,
} from "./body-store.js"

describe("normalizeBodyKey", () => {
  test("rejects absolute paths", () => {
    expect(() => normalizeBodyKey("/etc/passwd")).toThrow(/Invalid body key/)
  })

  test("rejects . and .. segments", () => {
    expect(() => normalizeBodyKey("prompts/../x.md")).toThrow(/Invalid body key/)
    expect(() => normalizeBodyKey("./x.md")).toThrow(/Invalid body key/)
    expect(() => normalizeBodyKey("prompts/a/../../x.md")).toThrow(/Invalid body key/)
  })

  test("normalizes backslashes and empty segments", () => {
    expect(normalizeBodyKey("prompts\\id\\versions\\1.md")).toBe("prompts/id/versions/1.md")
    expect(normalizeBodyKey("prompts//id/versions//1.md")).toBe("prompts/id/versions/1.md")
  })
})

describe("promptBodyKey", () => {
  test("uses the prompts/<id>/versions/<version>.md layout with immutable version", () => {
    expect(promptBodyKey("prmt-abc", 1)).toBe("prompts/prmt-abc/versions/1.md")
    expect(promptBodyKey("prmt-abc", 2)).toBe("prompts/prmt-abc/versions/2.md")
  })
})

describe("LocalBodyStore", () => {
  test("put/get/exists round-trips with 0700 directory and 0600 file modes", async () => {
    const root = mkdtempSync(join(tmpdir(), "prompts-bodies-"))
    try {
      const store = new LocalBodyStore(root)
      const result = await store.put({ key: "prompts/prmt-1/versions/1.md", body: "# hello" })
      expect(result.uri).toStartWith("file://")
      expect(await store.exists("prompts/prmt-1/versions/1.md")).toBe(true)
      expect(await store.getText("prompts/prmt-1/versions/1.md")).toBe("# hello")
      expect(statSync(join(root, "prompts", "prmt-1", "versions")).mode & 0o777).toBe(0o700)
      expect(statSync(join(root, "prompts", "prmt-1", "versions", "1.md")).mode & 0o777).toBe(0o600)
      expect(store.uriFor("prompts/prmt-1/versions/1.md")).toBe(result.uri)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("traversal keys cannot escape the root", async () => {
    const root = mkdtempSync(join(tmpdir(), "prompts-bodies-"))
    try {
      const store = new LocalBodyStore(root)
      await expect(store.put({ key: "../escape.md", body: "x" })).rejects.toThrow()
      await expect(store.getText("prompts/../../escape.md")).rejects.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("listKeys enumerates stored objects", async () => {
    const root = mkdtempSync(join(tmpdir(), "prompts-bodies-"))
    try {
      const store = new LocalBodyStore(root)
      await store.put({ key: "prompts/a/versions/1.md", body: "a" })
      await store.put({ key: "prompts/b/versions/2.md", body: "b" })
      const keys = store.listKeys().sort()
      expect(keys).toEqual(["prompts/a/versions/1.md", "prompts/b/versions/2.md"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("readBodyVerified", () => {
  test("verifies sha256 and byte count", async () => {
    const root = mkdtempSync(join(tmpdir(), "prompts-bodies-"))
    try {
      const store = new LocalBodyStore(root)
      const body = "hello world"
      await store.put({ key: "prompts/p/versions/1.md", body })
      const verified = await readBodyVerified(store, "prompts/p/versions/1.md", sha256Hex(body), bytesOf(body))
      expect(verified.body).toBe(body)
      expect(verified.sha256).toBe(sha256Hex(body))
      expect(verified.bytes).toBe(bytesOf(body))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("missing object raises PromptBodyMissingError, never an empty body", async () => {
    const root = mkdtempSync(join(tmpdir(), "prompts-bodies-"))
    try {
      const store = new LocalBodyStore(root)
      await expect(readBodyVerified(store, "prompts/p/versions/9.md", null, null)).rejects.toThrow(
        PromptBodyMissingError,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("corrupt object (hash mismatch) raises PromptBodyCorruptError", async () => {
    const root = mkdtempSync(join(tmpdir(), "prompts-bodies-"))
    try {
      const store = new LocalBodyStore(root)
      await store.put({ key: "prompts/p/versions/1.md", body: "actual content" })
      await expect(
        readBodyVerified(store, "prompts/p/versions/1.md", "a".repeat(64), bytesOf("actual content")),
      ).rejects.toThrow(PromptBodyCorruptError)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("corrupt object (byte mismatch) raises PromptBodyCorruptError", async () => {
    const root = mkdtempSync(join(tmpdir(), "prompts-bodies-"))
    try {
      const store = new LocalBodyStore(root)
      await store.put({ key: "prompts/p/versions/1.md", body: "actual content" })
      await expect(
        readBodyVerified(store, "prompts/p/versions/1.md", sha256Hex("actual content"), 9999),
      ).rejects.toThrow(PromptBodyCorruptError)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("existence check is traversal-safe", async () => {
    const root = mkdtempSync(join(tmpdir(), "prompts-bodies-"))
    try {
      const store = new LocalBodyStore(root)
      await expect(store.exists("../escape")).rejects.toThrow(/Invalid body key|escapes/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

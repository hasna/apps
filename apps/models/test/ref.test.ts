import { expect, test } from "bun:test";
import { parseProviderRef, formatProviderRef, safePathSegment } from "../src/ref.js";

test("parses model refs", () => {
  const ref = parseProviderRef("hf:sshleifer/tiny-gpt2");
  expect(ref).toEqual({
    provider: "huggingface",
    entityKind: "model",
    repoId: "sshleifer/tiny-gpt2",
    revision: "main",
  });
});

test("parses dataset refs with revisions", () => {
  const ref = parseProviderRef("hf:dataset:owner/name@abc123", "dataset");
  expect(ref.entityKind).toBe("dataset");
  expect(ref.repoId).toBe("owner/name");
  expect(ref.revision).toBe("abc123");
  expect(formatProviderRef(ref)).toBe("hf:dataset:owner/name@abc123");
});

test("rejects empty revisions and unsupported providers", () => {
  expect(() => parseProviderRef("hf:sshleifer/tiny-gpt2@")).toThrow("Revision cannot be empty");
  expect(() => parseProviderRef("foo:sshleifer/tiny-gpt2")).toThrow("Unsupported provider");
  expect(() => parseProviderRef("hf:banana:sshleifer/tiny-gpt2")).toThrow("Unsupported ref prefix");
});

test("safe path segments do not preserve dot directory aliases", () => {
  expect(safePathSegment(".")).toBe("unnamed");
  expect(safePathSegment("..")).toBe("unnamed");
  expect(safePathSegment("refs/heads/main")).toBe("refs__heads__main");
});

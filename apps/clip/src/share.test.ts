import { describe, expect, it } from "bun:test";
import type { ClipRecord } from "./types.js";
import { buildShareUrl, normalizeBaseUrl, resolveBaseUrl, withShareUrl } from "./share.js";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("share URL helpers", () => {
  it("normalizes explicit and environment base URLs", () => {
    const previousBaseUrl = process.env["CLIP_BASE_URL"];
    try {
      expect(normalizeBaseUrl("http://clip.test///")).toBe("http://clip.test");

      process.env["CLIP_BASE_URL"] = "http://env.clip///";
      expect(resolveBaseUrl()).toBe("http://env.clip");
      expect(resolveBaseUrl({ baseUrl: "http://option.clip/" })).toBe("http://option.clip");
    } finally {
      restoreEnv("CLIP_BASE_URL", previousBaseUrl);
    }
  });

  it("uses host and port options before environment defaults", () => {
    const previousHost = process.env["HOST"];
    const previousPort = process.env["PORT"];
    try {
      process.env["HOST"] = "env-host";
      process.env["PORT"] = "not-a-number";

      expect(resolveBaseUrl()).toBe("http://env-host:3741");
      expect(resolveBaseUrl({ host: "option-host", port: 9999 })).toBe("http://option-host:9999");
    } finally {
      restoreEnv("HOST", previousHost);
      restoreEnv("PORT", previousPort);
    }
  });

  it("encodes slugs and returns immutable records with share URLs", () => {
    const record = {
      id: "id",
      slug: "space slug/with slash",
      kind: "text",
      title: null,
      mimeType: "text/plain",
      artifactPath: null,
      text: "hello",
      sizeBytes: 5,
      sha256: "hash",
      source: "test",
      metadata: {},
      createdAt: "now",
      updatedAt: "now",
      deletedAt: null,
    } satisfies ClipRecord;

    const withUrl = withShareUrl(record, { baseUrl: "http://clip.test/" });

    expect(buildShareUrl(record, { baseUrl: "http://clip.test/" })).toBe("http://clip.test/s/space%20slug%2Fwith%20slash");
    expect(withUrl).not.toBe(record);
    expect(withUrl.shareUrl).toBe("http://clip.test/s/space%20slug%2Fwith%20slash");
    expect(record.shareUrl).toBeUndefined();
  });
});

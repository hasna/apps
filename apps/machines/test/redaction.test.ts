import { describe, expect, test } from "bun:test";
import {
  PRIVATE_METADATA_ENV,
  PRIVATE_METADATA_FALLBACK_ENV,
  REDACTED_VALUE,
  isPrivateMetadataEnabled,
  redactErrorMessage,
  redactNetworkValue,
} from "../src/redaction.js";

describe("redaction helpers", () => {
  test("private metadata is opt-in", () => {
    expect(isPrivateMetadataEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isPrivateMetadataEnabled({ [PRIVATE_METADATA_ENV]: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isPrivateMetadataEnabled({ [PRIVATE_METADATA_FALLBACK_ENV]: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isPrivateMetadataEnabled({ [PRIVATE_METADATA_ENV]: "0" } as NodeJS.ProcessEnv)).toBe(false);
  });

  test("redacts network values by default", () => {
    expect(redactNetworkValue("demo-node.tailnet.example")).toBe(REDACTED_VALUE);
    expect(redactNetworkValue("100.64.0.7")).toBe(REDACTED_VALUE);
  });

  test("redacts database URLs and private network addresses from errors", () => {
    const message = redactErrorMessage(
      "connect failed for postgres://user:pass@10.0.0.5:5432/machines from /Users/alice/work"
    );
    expect(message).toContain("postgres://[redacted]");
    expect(message).toContain(REDACTED_VALUE);
    expect(message).toContain("/Users/<user>/work");
    expect(message).not.toContain("user:pass");
    expect(message).not.toContain("10.0.0.5");
    expect(message).not.toContain("alice");
  });

  test("redacts private hostnames and user-qualified targets from free-form text", () => {
    const message = redactErrorMessage("operator@demo-node-01.private.example via demo-node-01.tailnet.example");
    expect(message).not.toContain("operator@demo-node-01.private.example");
    expect(message).not.toContain("demo-node-01.tailnet.example");
    expect(message).toContain(REDACTED_VALUE);
  });

  test("redacts common API key and bearer token shapes from free-form text", () => {
    const samples = [
      `sk-${"proj"}-abcdefghijklmnopqrstuvwxyz`,
      `npm${"_"}abcdefghijklmnopqrstuvwxyz`,
      `gh${"o"}_abcdefghijklmnopqrstuvwxyz123456`,
      `ctx7sk${"-"}abcdefghijklmnopqrstuvwxyz`,
      `xai${"-"}abcdefghijklmnopqrstuvwxyz`,
      `AI${"za"}abcdefghijklmnopqrstuvwxyz123456`,
      `${"secret"}-token:abcdef`,
      "Bearer abcdefghijklmnopqrstuvwxyz",
    ];
    const raw = samples.join(" ");
    const message = redactErrorMessage(raw);
    expect(message).toContain(REDACTED_VALUE);
    for (const sample of samples) expect(message).not.toContain(sample);
    expect(message).not.toContain("Bearer abcdefghijklmnopqrstuvwxyz");
  });
});

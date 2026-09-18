import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { describe, expect, test } from "bun:test";
import { CloudExecutionClient } from "./cloud-executions.js";

describe("read-only cloud eligibility transport", () => {
  test("binds exact identity and makes one authenticated GET without execution", async () => {
    const calls: { method: string; pathname: string; version: string | null; digest: string | null; authenticated: boolean }[] = [];
    const digest = "a".repeat(64);
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const url = new URL(request.url);
      calls.push({ method: request.method, pathname: url.pathname, version: url.searchParams.get("version"), digest: url.searchParams.get("bundleDigest"),
        authenticated: request.headers.get("authorization") === "Bearer synthetic-eligibility" });
      return Response.json({ contractVersion: 1, eligible: false, reason: "BUNDLE_NOT_REVIEWED_FOR_CLOUD", skill: "synthetic-pure", version: "1.0.0", bundleDigest: digest });
    } });
    try {
      const client = new CloudExecutionClient(server.url.origin, "synthetic-eligibility");
      expect((await client.eligibility("synthetic-pure", "1.0.0", "sha256:" + digest)).eligible).toBe(false);
      expect(calls).toEqual([{ method: "GET", pathname: "/api/v1/executions/synthetic-pure/eligibility", version: "1.0.0", digest: "sha256:" + digest, authenticated: true }]);
      await expect(client.eligibility("../bad", "1.0.0")).rejects.toThrow();
      await expect(client.eligibility("synthetic-pure", "latest")).rejects.toThrow();
      expect(calls).toHaveLength(1);
    } finally { server.stop(true); }
  });
  test("refuses an eligibility receipt for another bundle or unsupported contract", async () => {
    let mismatch = true;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
      return Response.json({ contractVersion: 1, eligible: true, skill: "synthetic-pure", version: "1.0.0", bundleDigest: (mismatch ? "b" : "a").repeat(64),
        executionContract: { id: "unreviewed.v1" } });
    } });
    try {
      const client = new CloudExecutionClient(server.url.origin, "synthetic-eligibility");
      await expect(client.eligibility("synthetic-pure", "1.0.0", "a".repeat(64))).rejects.toThrow("Invalid cloud eligibility receipt");
      mismatch = false;
      await expect(client.eligibility("synthetic-pure", "1.0.0", "a".repeat(64))).rejects.toThrow("Invalid cloud eligibility receipt");
    } finally { server.stop(true); }
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { ConversationsClient } from "./index.js";

describe("generated SDK channel merge contract", () => {
  test("mergeChannel posts the guarded merge body to the stable destination route", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const client = new ConversationsClient({
      baseUrl: "https://conversations.example.invalid",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(input),
          method: String(init?.method),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });

    await client.mergeChannel("Old Main", {
      source_channel: "Old Main",
      dry_run: true,
      archive_source: true,
    });
    await client.mergeChannel("New Main", {
      source_channel: "Old Main",
      dry_run: false,
      archive_source: true,
      expected_revision: "revision-one",
      idempotency_key: "merge-one",
    });

    expect(new URL(calls[0].url).pathname).toBe("/v1/channels/Old%20Main/merge");
    expect(calls[0]).toMatchObject({
      method: "POST",
      body: {
        source_channel: "Old Main",
        dry_run: true,
        archive_source: true,
      },
    });
    expect(new URL(calls[1].url).pathname).toBe("/v1/channels/New%20Main/merge");
    expect(calls[1]).toMatchObject({
      method: "POST",
      body: {
        source_channel: "Old Main",
        dry_run: false,
        archive_source: true,
        expected_revision: "revision-one",
        idempotency_key: "merge-one",
      },
    });
  });

  test("mergeChannel signature exists in the generated client with guarded body fields", () => {
    const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
    const signature = source.split("\n").find((line) => line.includes("async mergeChannel("));
    expect(signature).toBeDefined();
    expect(signature).toContain("mergeChannel(");
    const bodyType = source.split("\n").find((line) => line.includes("source_channel"));
    expect(bodyType).toContain('"source_channel": string');
    expect(bodyType).toContain('"dry_run"?: boolean');
    expect(bodyType).toContain('"archive_source"?: boolean');
    expect(bodyType).toContain('"expected_revision"?: string');
    expect(bodyType).toContain('"idempotency_key"?: string');
  });
});

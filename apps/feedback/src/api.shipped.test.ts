import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFeedbackHandler } from "./api.js";
import { FeedbackClient } from "./client.js";
import { LocalFeedbackStore } from "./storage.js";

async function createTestClient() {
  const store = new LocalFeedbackStore({
    dataDir: await mkdtemp(join(tmpdir(), "open-feedback-shipped-")),
    eventSink: null,
    taskSink: null,
  });
  const handler = createFeedbackHandler({ store, publicSubmit: true });
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    return handler(request);
  };
  return new FeedbackClient({ baseUrl: "http://feedback.test", fetch: fetchImpl });
}

describe("remote shipped — the loop's receipt must survive a hosted deployment", () => {
  test("markShipped records changelogRef and shippedAt over HTTP", async () => {
    const client = await createTestClient();
    const item = await client.submit({ appId: "app-a", message: "fix the export" });

    const shipped = await client.markShipped(item.id, "v1.4.0#export-fix");

    expect(shipped.status).toBe("shipped");
    expect(shipped.changelogRef).toBe("v1.4.0#export-fix");
    expect(shipped.shippedAt).toBeTruthy();
  });

  test("the receipt is readable back from the service, not just echoed by the write", async () => {
    const client = await createTestClient();
    const item = await client.submit({ appId: "app-a", message: "fix the export" });
    await client.markShipped(item.id, "v1.4.0#export-fix");

    const reread = await client.get(item.id);
    expect(reread.changelogRef).toBe("v1.4.0#export-fix");
    expect(reread.shippedAt).toBeTruthy();
  });

  test("a plain status change to shipped still records no changelogRef — the documented lossy path", async () => {
    const client = await createTestClient();
    const item = await client.submit({ appId: "app-a", message: "fix the export" });
    const shipped = await client.updateStatus(item.id, "shipped");
    expect(shipped.status).toBe("shipped");
    expect(shipped.changelogRef).toBeUndefined();
  });

  test("marking a missing id shipped fails loudly", async () => {
    const client = await createTestClient();
    await expect(client.markShipped("00000000-0000-0000-0000-000000000000", "ref")).rejects.toThrow(/not found/i);
  });

  test("an empty changelogRef is rejected rather than stored as a blank receipt", async () => {
    const client = await createTestClient();
    const item = await client.submit({ appId: "app-a", message: "fix the export" });
    await expect(client.markShipped(item.id, "   ")).rejects.toThrow();
  });
});

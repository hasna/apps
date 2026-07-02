import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClipClient } from "./index.js";

describe("public SDK", () => {
  it("creates and retrieves a text share", () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-sdk-"));
    try {
      const client = createClipClient({ homeDir: dir, baseUrl: "http://127.0.0.1:3741" });
      const record = client.createTextShare("sdk text", { title: "SDK" });
      expect(client.getShare(record.slug)?.text).toBe("sdk text");
      expect(client.listShares({ limit: 5 })[0]?.id).toBe(record.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

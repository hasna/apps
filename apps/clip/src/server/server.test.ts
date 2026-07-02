import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleClipHttpRequest } from "./server.js";

describe("HTTP server routes", () => {
  it("creates, reads, previews, and deletes text shares", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-"));
    try {
      const options = { clientOptions: { homeDir: dir }, baseUrl: "http://test.local" };
      const create = await handleClipHttpRequest(new Request("http://x/api/shares", {
        method: "POST",
        body: JSON.stringify({ text: "hello api", title: "API" }),
      }), options);
      expect(create.status).toBe(201);
      const record = await create.json() as { id: string; slug: string; shareUrl: string };
      expect(record.shareUrl).toBe(`http://test.local/s/${record.slug}`);
      expect("artifactPath" in record).toBe(false);

      const show = await handleClipHttpRequest(new Request(`http://x/api/shares/${record.slug}`), options);
      expect(show.status).toBe(200);

      const preview = await handleClipHttpRequest(new Request(`http://x/s/${record.slug}`), options);
      expect(preview.status).toBe(200);
      expect(await preview.text()).toContain("hello api");

      const deleted = await handleClipHttpRequest(new Request(`http://x/api/shares/${record.id}`, { method: "DELETE" }), options);
      expect(deleted.status).toBe(200);
      expect((await deleted.json() as { deleted: boolean }).deleted).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects server-local file paths and accepts uploaded bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-upload-"));
    try {
      const options = { clientOptions: { homeDir: dir }, baseUrl: "http://test.local" };
      const rejected = await handleClipHttpRequest(new Request("http://x/api/shares", {
        method: "POST",
        body: JSON.stringify({ filePath: "/etc/passwd" }),
      }), options);
      expect(rejected.status).toBe(400);
      expect((await rejected.json() as { error: string }).error).toContain("not allowed");

      const created = await handleClipHttpRequest(new Request("http://x/api/shares", {
        method: "POST",
        body: JSON.stringify({
          dataBase64: Buffer.from("upload smoke", "utf8").toString("base64"),
          mimeType: "text/plain",
          title: "Upload",
        }),
      }), options);
      expect(created.status).toBe(201);
      const record = await created.json() as { slug: string; hasArtifact: boolean; metadata: Record<string, unknown> };
      expect(record.hasArtifact).toBe(true);
      expect("artifactPath" in record).toBe(false);
      expect("path" in record.metadata).toBe(false);

      const raw = await handleClipHttpRequest(new Request(`http://x/s/${record.slug}/raw`), options);
      expect(await raw.text()).toBe("upload smoke");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns a 400 for invalid list limits instead of leaking SQLite errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-limit-"));
    try {
      const response = await handleClipHttpRequest(new Request("http://x/api/shares?limit=nope"), {
        clientOptions: { homeDir: dir },
      });
      expect(response.status).toBe(400);
      expect((await response.json() as { error: string }).error).toContain("limit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

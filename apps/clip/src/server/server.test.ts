import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClipStore } from "../storage.js";
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

  it("redacts local filesystem paths from public status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-status-"));
    try {
      const response = await handleClipHttpRequest(new Request("http://x/api/status"), {
        clientOptions: { homeDir: dir },
        baseUrl: "http://test.local",
      });
      expect(response.status).toBe(200);
      const payloadText = await response.text();
      const payload = JSON.parse(payloadText) as {
        storage: {
          totalActive: number;
          deleted: number;
          localPathsRedacted: boolean;
          homeDir?: string;
          dbPath?: string;
          artifactDir?: string;
        };
      };
      expect(payload.storage.totalActive).toBe(0);
      expect(payload.storage.deleted).toBe(0);
      expect(payload.storage.localPathsRedacted).toBe(true);
      expect(payload.storage.homeDir).toBeUndefined();
      expect(payload.storage.dbPath).toBeUndefined();
      expect(payload.storage.artifactDir).toBeUndefined();
      expect(payloadText).not.toContain(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("redacts nested local metadata paths from public records", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-metadata-"));
    try {
      const store = new ClipStore({ homeDir: dir, baseUrl: "http://test.local" });
      const record = store.createTextClip({
        text: "metadata smoke",
        source: "test",
        metadata: {
          path: join(dir, "source.txt"),
          args: ["-f", join(dir, "capture.png")],
          activeWindow: {
            title: "Window",
            outputPath: join(dir, "window.png"),
            note: `terminal editing ${join(dir, "window.log")}`,
          },
          note: `terminal editing ${join(dir, "notes.txt")}`,
          safe: "visible",
        },
      });
      store.close();

      const response = await handleClipHttpRequest(new Request(`http://x/api/shares/${record.slug}`), {
        clientOptions: { homeDir: dir },
        baseUrl: "http://test.local",
      });
      expect(response.status).toBe(200);
      const payloadText = await response.text();
      const payload = JSON.parse(payloadText) as { metadata: Record<string, unknown> };
      expect(payload.metadata.safe).toBe("visible");
      expect(payload.metadata.note).toBe("[redacted]");
      expect(payload.metadata.activeWindow).toEqual({ title: "Window", note: "[redacted]" });
      expect("path" in payload.metadata).toBe(false);
      expect(payloadText).not.toContain(dir);
      expect(payloadText).not.toContain("/capture.png");
      expect(payloadText).toContain("[redacted]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not expose raw exception messages in public 500 responses", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-error-"));
    const dbPath = dir;
    try {
      const response = await handleClipHttpRequest(new Request("http://x/api/status"), {
        clientOptions: { homeDir: dir, dbPath },
      });
      expect(response.status).toBe(500);
      const payloadText = await response.text();
      expect(payloadText).toContain("Internal server error");
      expect(payloadText).not.toContain(dir);
      expect(payloadText).not.toContain(dbPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

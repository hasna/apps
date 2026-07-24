import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClipStore } from "../storage.js";
import { buildShareAccessUrl } from "../share.js";
import { handleClipHttpRequest, startClipServer } from "./server.js";

describe("HTTP server routes", () => {
  it("serves root health and not found responses without local paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-root-"));
    try {
      const root = await handleClipHttpRequest(new Request("http://x/"), {
        clientOptions: { homeDir: dir },
        host: "0.0.0.0",
        port: 4567,
      });
      expect(root.status).toBe(200);
      expect(await root.json()).toEqual({
        status: "ok",
        name: "clip",
        baseUrl: "http://0.0.0.0:4567",
      });

      const health = await handleClipHttpRequest(new Request("http://x/health"), { clientOptions: { homeDir: dir } });
      expect(health.status).toBe(200);

      const missing = await handleClipHttpRequest(new Request("http://x/nope"), { clientOptions: { homeDir: dir } });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "Not found" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires the access token for protected text shares", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-token-"));
    const accessToken = ["allow", "token"].join("-");
    try {
      const options = { clientOptions: { homeDir: dir }, baseUrl: "http://test.local" };
      const create = await handleClipHttpRequest(new Request("http://x/api/shares", {
        method: "POST",
        body: JSON.stringify({ text: "protected text body", title: "Token Share", accessToken }),
      }), options);
      expect(create.status).toBe(201);
      const createdText = await create.text();
      const record = JSON.parse(createdText) as { slug: string; shareUrl: string; protected?: boolean; text?: string };
      expect(record.protected).toBe(true);
      expect(record.text).toBe("protected text body");
      expect(record.shareUrl).toBe(`http://test.local/s/${record.slug}`);
      expect(record.shareUrl).not.toContain(accessToken);
      expect(createdText).not.toContain(accessToken);

      const protectedUrl = buildShareAccessUrl({ slug: record.slug }, { accessToken }, { baseUrl: "http://test.local" });
      expect(protectedUrl).toBe(`http://test.local/s/${record.slug}?token=${encodeURIComponent(accessToken)}`);

      const listed = await handleClipHttpRequest(new Request("http://x/api/shares"), options);
      expect(listed.status).toBe(200);
      const listedText = await listed.text();
      const listedPayload = JSON.parse(listedText) as { shares: Array<{ slug: string; protected?: boolean; text: string | null; sha256: string }> };
      expect(listedPayload.shares[0]?.slug).toBe(record.slug);
      expect(listedPayload.shares[0]?.protected).toBe(true);
      expect(listedPayload.shares[0]?.text).toBeNull();
      expect(listedPayload.shares[0]?.sha256).toBe("[redacted]");
      expect(listedText).not.toContain("protected text body");
      expect(listedText).not.toContain(accessToken);

      const deniedShow = await handleClipHttpRequest(new Request(`http://x/api/shares/${record.slug}`), options);
      expect(deniedShow.status).toBe(401);
      const deniedText = await deniedShow.text();
      expect(deniedText).not.toContain("protected text body");
      expect(deniedText).not.toContain(accessToken);

      const wrongShow = await handleClipHttpRequest(new Request(`http://x/api/shares/${record.slug}`, {
        headers: { "X-Clip-Access-Token": "wrong" },
      }), options);
      expect(wrongShow.status).toBe(401);

      const allowedShow = await handleClipHttpRequest(new Request(`http://x/api/shares/${record.slug}`, {
        headers: { "X-Clip-Access-Token": accessToken },
      }), options);
      expect(allowedShow.status).toBe(200);
      expect((await allowedShow.json() as { text: string }).text).toBe("protected text body");

      const deniedPreview = await handleClipHttpRequest(new Request(`http://x/s/${record.slug}`), options);
      expect(deniedPreview.status).toBe(401);

      const allowedPreview = await handleClipHttpRequest(new Request(`http://x/s/${record.slug}?token=${encodeURIComponent(accessToken)}`), options);
      expect(allowedPreview.status).toBe(200);
      const previewText = await allowedPreview.text();
      expect(previewText).toContain("protected text body");
      expect(previewText).not.toContain(accessToken);

      const deniedRaw = await handleClipHttpRequest(new Request(`http://x/s/${record.slug}/raw`), options);
      expect(deniedRaw.status).toBe(401);

      const allowedRaw = await handleClipHttpRequest(new Request(`http://x/s/${record.slug}/raw`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }), options);
      expect(allowedRaw.status).toBe(200);
      expect(await allowedRaw.text()).toBe("protected text body");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires the password for protected uploaded shares", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-password-"));
    const password = ["open", "share"].join("-");
    try {
      const options = { clientOptions: { homeDir: dir }, baseUrl: "http://test.local" };
      const created = await handleClipHttpRequest(new Request("http://x/api/shares", {
        method: "POST",
        body: JSON.stringify({
          dataBase64: Buffer.from("protected upload", "utf8").toString("base64"),
          mimeType: "text/plain",
          title: "Upload",
          password,
        }),
      }), options);
      expect(created.status).toBe(201);
      const createdText = await created.text();
      const record = JSON.parse(createdText) as { slug: string; protected?: boolean; metadata: Record<string, unknown> };
      expect(record.protected).toBe(true);
      expect(record.metadata["clipAccessProtection"]).toBeUndefined();
      expect(createdText).not.toContain(password);
      const store = new ClipStore({ homeDir: dir, baseUrl: "http://test.local" });
      const stored = store.getClip(record.slug);
      store.close();
      const storedMetadataText = JSON.stringify(stored?.metadata ?? {});
      expect(storedMetadataText).toContain("\"algorithm\":\"scrypt\"");
      expect(storedMetadataText).not.toContain(password);

      const deniedRaw = await handleClipHttpRequest(new Request(`http://x/s/${record.slug}/raw`), options);
      expect(deniedRaw.status).toBe(401);
      expect(await deniedRaw.text()).not.toContain("protected upload");

      const wrongRaw = await handleClipHttpRequest(new Request(`http://x/s/${record.slug}/raw?password=wrong`), options);
      expect(wrongRaw.status).toBe(401);

      const allowedRaw = await handleClipHttpRequest(new Request(`http://x/s/${record.slug}/raw`, {
        headers: { "X-Clip-Password": password },
      }), options);
      expect(allowedRaw.status).toBe(200);
      expect(await allowedRaw.text()).toBe("protected upload");

      const allowedViaQuery = await handleClipHttpRequest(new Request(`http://x/api/shares/${record.slug}?password=${encodeURIComponent(password)}`), options);
      expect(allowedViaQuery.status).toBe(200);
      expect((await allowedViaQuery.json() as { hasArtifact: boolean }).hasArtifact).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires a bearer token for mutating routes when authToken is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-auth-"));
    try {
      const options = { clientOptions: { homeDir: dir }, baseUrl: "http://test.local", authToken: "sekret" };
      const denied = await handleClipHttpRequest(new Request("http://x/api/shares", {
        method: "POST",
        body: JSON.stringify({ text: "nope" }),
      }), options);
      expect(denied.status).toBe(401);

      const wrongToken = await handleClipHttpRequest(new Request("http://x/api/shares", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
        body: JSON.stringify({ text: "nope" }),
      }), options);
      expect(wrongToken.status).toBe(401);

      const allowed = await handleClipHttpRequest(new Request("http://x/api/shares", {
        method: "POST",
        headers: { Authorization: "Bearer sekret" },
        body: JSON.stringify({ text: "yes" }),
      }), options);
      expect(allowed.status).toBe(201);
      const record = await allowed.json() as { slug: string };

      // Reads stay open.
      const read = await handleClipHttpRequest(new Request(`http://x/s/${record.slug}`), options);
      expect(read.status).toBe(200);

      const deleteDenied = await handleClipHttpRequest(new Request(`http://x/api/shares/${record.slug}`, { method: "DELETE" }), options);
      expect(deleteDenied.status).toBe(401);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never serves uploaded html inline from the share origin", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-xss-"));
    try {
      const options = { clientOptions: { homeDir: dir }, baseUrl: "http://test.local" };
      const created = await handleClipHttpRequest(new Request("http://x/api/shares", {
        method: "POST",
        body: JSON.stringify({
          dataBase64: Buffer.from("<script>alert(1)</script>").toString("base64"),
          mimeType: "text/html",
        }),
      }), options);
      expect(created.status).toBe(201);
      const record = await created.json() as { slug: string };

      const raw = await handleClipHttpRequest(new Request(`http://x/s/${record.slug}/raw`), options);
      expect(raw.status).toBe(200);
      expect(raw.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(raw.headers.get("Content-Disposition")).toStartWith("attachment");
      expect(raw.headers.get("Content-Security-Policy")).toContain("sandbox");

      // Safe types stay inline.
      const png = await handleClipHttpRequest(new Request("http://x/api/shares", {
        method: "POST",
        body: JSON.stringify({ dataBase64: Buffer.from([137, 80, 78, 71]).toString("base64"), mimeType: "image/png" }),
      }), options);
      const pngRecord = await png.json() as { slug: string };
      const pngRaw = await handleClipHttpRequest(new Request(`http://x/s/${pngRecord.slug}/raw`), options);
      expect(pngRaw.headers.get("Content-Type")).toBe("image/png");
      expect(pngRaw.headers.get("Content-Disposition")).toBe("inline");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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

      const raw = await handleClipHttpRequest(new Request(`http://x/s/${record.slug}/raw`), options);
      expect(raw.status).toBe(200);
      expect(raw.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(await raw.text()).toBe("hello api");

      const list = await handleClipHttpRequest(new Request("http://x/api/shares?limit=1"), options);
      expect((await list.json() as { shares: unknown[] }).shares).toHaveLength(1);

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

  it("returns shares with default limits and rejects malformed create bodies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-bodies-"));
    try {
      const options = { clientOptions: { homeDir: dir } };
      const list = await handleClipHttpRequest(new Request("http://x/api/shares"), options);
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual({ shares: [] });

      const malformed = await handleClipHttpRequest(new Request("http://x/api/shares", {
        method: "POST",
        body: "{bad json",
      }), options);
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({ error: "Expected text or dataBase64" });

      const missingBody = await handleClipHttpRequest(new Request("http://x/api/shares", { method: "POST" }), options);
      expect(missingBody.status).toBe(400);

      const invalidBase64 = await handleClipHttpRequest(new Request("http://x/api/shares", {
        method: "POST",
        body: JSON.stringify({ dataBase64: "!" }),
      }), options);
      expect(invalidBase64.status).toBe(400);
      expect(await invalidBase64.json()).toEqual({ error: "dataBase64 did not decode to content" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns a 400 for invalid capture annotation input", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-annotation-"));
    try {
      const response = await handleClipHttpRequest(new Request("http://x/api/capture", {
        method: "POST",
        body: JSON.stringify({
          mode: "full",
          annotations: [{ type: "box", x: 0, y: 0, width: 10, height: 10, color: "not-a-color" }],
        }),
      }), {
        clientOptions: { homeDir: dir },
      });
      expect(response.status).toBe(400);
      expect((await response.json() as { error: string }).error).toContain("Invalid annotation color");
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

  it("returns missing share, missing artifact, image preview, and binary download branches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-artifacts-"));
    try {
      const options = { clientOptions: { homeDir: dir }, baseUrl: "http://test.local" };
      const store = new ClipStore({ homeDir: dir, baseUrl: "http://test.local" });
      const image = store.createBufferClip({
        buffer: Buffer.from("png"),
        kind: "file",
        title: "Image",
        mimeType: "image/png",
        source: "test",
      });
      const binary = store.createBufferClip({
        buffer: Buffer.from("bin"),
        kind: "file",
        title: "Binary",
        mimeType: "application/octet-stream",
        source: "test",
      });
      store.close();

      const missing = await handleClipHttpRequest(new Request("http://x/api/shares/missing"), options);
      expect(missing.status).toBe(404);

      const deleteMissing = await handleClipHttpRequest(new Request("http://x/api/shares/missing", { method: "DELETE" }), options);
      expect(await deleteMissing.json()).toEqual({ deleted: false, ref: "missing" });

      const imagePreview = await handleClipHttpRequest(new Request(`http://x/s/${image.slug}`), options);
      expect(imagePreview.status).toBe(200);
      expect(await imagePreview.text()).toContain(`<img src="/s/${image.slug}/raw"`);

      const binaryPreview = await handleClipHttpRequest(new Request(`http://x/s/${binary.slug}`), options);
      expect(binaryPreview.status).toBe(200);
      expect(await binaryPreview.text()).toContain(`Download ${binary.title}`);

      const binaryRaw = await handleClipHttpRequest(new Request(`http://x/s/${binary.slug}/raw`), options);
      expect(binaryRaw.status).toBe(200);
      expect(binaryRaw.headers.get("Content-Disposition")).toContain(`filename="${binary.slug}"`);
      expect(await binaryRaw.text()).toBe("bin");

      unlinkSync(image.artifactPath!);
      const missingRaw = await handleClipHttpRequest(new Request(`http://x/s/${image.slug}/raw`), options);
      expect(missingRaw.status).toBe(404);
      expect(await missingRaw.json()).toEqual({ error: "Artifact not found" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wraps capture and clipboard route errors as public 500s", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-tool-errors-"));
    const previousPath = process.env["PATH"];
    const previousDisplay = process.env["DISPLAY"];
    const previousWayland = process.env["WAYLAND_DISPLAY"];
    const logs: string[] = [];
    try {
      process.env["PATH"] = "";
      delete process.env["DISPLAY"];
      delete process.env["WAYLAND_DISPLAY"];
      const options = { clientOptions: { homeDir: dir }, log: (message: string) => logs.push(message) };

      const capture = await handleClipHttpRequest(new Request("http://x/api/capture", {
        method: "POST",
        body: JSON.stringify({ mode: "window", title: "No tools" }),
      }), options);
      expect(capture.status).toBe(500);
      expect(await capture.json()).toEqual({ error: "Internal server error" });

      const clipboard = await handleClipHttpRequest(new Request("http://x/api/clipboard", {
        method: "POST",
        body: JSON.stringify({ kind: "text" }),
      }), options);
      expect(clipboard.status).toBe(500);
      expect(await clipboard.json()).toEqual({ error: "Internal server error" });
      expect(logs.join("\n")).toContain("clip server request failed:");
    } finally {
      if (previousPath === undefined) {
        delete process.env["PATH"];
      } else {
        process.env["PATH"] = previousPath;
      }
      if (previousDisplay === undefined) {
        delete process.env["DISPLAY"];
      } else {
        process.env["DISPLAY"] = previousDisplay;
      }
      if (previousWayland === undefined) {
        delete process.env["WAYLAND_DISPLAY"];
      } else {
        process.env["WAYLAND_DISPLAY"] = previousWayland;
      }
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

  it("starts a server with bound port wiring and request handling", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-server-start-"));
    const logs: string[] = [];
    const server = startClipServer({
      host: "127.0.0.1",
      port: 0,
      clientOptions: { homeDir: dir },
      log: (message) => logs.push(message),
    });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(logs[0]).toBe(`clip server listening on http://127.0.0.1:${server.port}`);

      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(response.status).toBe(200);
      const payload = await response.json() as { baseUrl: string };
      expect(payload.baseUrl).toBe(`http://127.0.0.1:${server.port}`);
    } finally {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

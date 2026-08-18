import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesClient } from "@hasna/files/sdk";
import { signEvidenceDownload, uploadEvidenceArtifact } from "./files.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "monitor-files-"));
}

/**
 * Fake `files` CLI that records the exact argv it received and answers with a
 * scripted receipt — so tests exercise the real `files evidence upload`
 * invocation contract without the Files service.
 */
function writeFilesStub(dir: string): { binary: string; argsFile: string } {
  const binary = join(dir, "files");
  const argsFile = join(dir, "stub-args.txt");
  writeFileSync(
    binary,
    `#!/usr/bin/env bash
set -uo pipefail
printf '%s\\n' "$@" > "$FILES_STUB_ARGS_FILE"
case "$FILES_STUB_MODE" in
  fail)
    echo "upload failed: boom" >&2
    exit 1
    ;;
  badjson)
    echo "not-json-receipt" >&2
    exit 0
    ;;
  *)
    cat <<'EOF'
{"asset":{"id":"asset_stub_1","status":"verified"},"intent":{"id":"intent_stub_1"},"replayed":false}
EOF
    exit 0
    ;;
esac
`,
    { mode: 0o700 }
  );
  chmodSync(binary, 0o700);
  return { binary, argsFile };
}

function readStubArgs(argsFile: string): string[] {
  const raw = readFileSync(argsFile, "utf8");
  return raw.trim() ? raw.split("\n") : [];
}

describe("uploadEvidenceArtifact (files evidence upload)", () => {
  test("invokes `files evidence upload <path>` with the exact flags and returns the asset id", async () => {
    const dir = tempDir();
    try {
      const { binary, argsFile } = writeFilesStub(dir);
      const artifact = join(dir, "run-output.txt");
      writeFileSync(artifact, "artifact bytes", { mode: 0o600 });

      const result = await uploadEvidenceArtifact(artifact, {
        org: "hasna",
        app: "monitor",
        kind: "run-artifact",
        binary,
        env: { ...process.env, FILES_STUB_ARGS_FILE: argsFile, FILES_STUB_MODE: "ok" },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.assetId).toBe("asset_stub_1");
        expect(result.intentId).toBe("intent_stub_1");
      }

      const args = readStubArgs(argsFile);
      expect(args[0]).toBe("evidence");
      expect(args[1]).toBe("upload");
      expect(args).toContain(artifact);
      expect(args).toContain("--org");
      expect(args[args.indexOf("--org") + 1]).toBe("hasna");
      expect(args).toContain("--app");
      expect(args[args.indexOf("--app") + 1]).toBe("monitor");
      expect(args).toContain("--kind");
      expect(args[args.indexOf("--kind") + 1]).toBe("run-artifact");
      expect(args).toContain("--json");

      // No credential-shaped argument may ever reach the CLI.
      for (const arg of args) {
        expect(arg).not.toMatch(/sk-ant-|sk-proj-|npm_[A-Za-z0-9]{20,}|ghp_|AKIA|token=|\*\*\*/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("maps a failed upload to a typed upload_failed result without throwing", async () => {
    const dir = tempDir();
    try {
      const { binary, argsFile } = writeFilesStub(dir);
      const artifact = join(dir, "run-output.txt");
      writeFileSync(artifact, "artifact bytes", { mode: 0o600 });

      const result = await uploadEvidenceArtifact(artifact, {
        org: "hasna",
        app: "monitor",
        kind: "run-artifact",
        binary,
        env: { ...process.env, FILES_STUB_ARGS_FILE: argsFile, FILES_STUB_MODE: "fail" },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("upload_failed");
        expect(result.message).toContain("boom");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("maps an unparseable receipt to a typed failure", async () => {
    const dir = tempDir();
    try {
      const { binary, argsFile } = writeFilesStub(dir);
      const artifact = join(dir, "run-output.txt");
      writeFileSync(artifact, "artifact bytes", { mode: 0o600 });

      const result = await uploadEvidenceArtifact(artifact, {
        org: "hasna",
        app: "monitor",
        kind: "run-artifact",
        binary,
        env: { ...process.env, FILES_STUB_ARGS_FILE: argsFile, FILES_STUB_MODE: "badjson" },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("upload_failed");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("signEvidenceDownload (FilesClient.signEvidenceDownload)", () => {
  function stubClient(
    onRequest: (method: string, url: URL, body?: unknown) => Response | Promise<Response>
  ): FilesClient {
    return new FilesClient({
      baseUrl: "https://files.example.invalid/v1",
      apiKey: "test-key",
      fetch: (async (input, init) => {
        const url = new URL(String(input));
        return onRequest(String(init?.method), url, init?.body ? JSON.parse(String(init.body)) : undefined);
      }) as typeof fetch,
    });
  }

  test("issues signEvidenceDownload through the SDK and returns the bounded grant", async () => {
    const calls: Array<{ method: string; url: URL; body?: unknown }> = [];
    const client = new FilesClient({
      baseUrl: "https://files.example.invalid/v1",
      apiKey: "test-key",
      fetch: (async (input, init) => {
        const url = new URL(String(input));
        calls.push({ method: String(init?.method), url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return Response.json({
          asset: { id: "asset_x", status: "verified" },
          url: "https://download.example.invalid/ev/asset_x",
          expires_at: "2026-08-18T12:00:00.000Z",
        });
      }) as typeof fetch,
    });

    const result = await signEvidenceDownload("asset_x", { client, purpose: "run-review" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("https://download.example.invalid/ev/asset_x");
      expect(result.expiresAt).toBe("2026-08-18T12:00:00.000Z");
      expect(result.assetId).toBe("asset_x");
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url.pathname).toBe("/v1/evidence/assets/asset_x/sign-download");
    expect(calls[0]?.body).toEqual({ purpose: "run-review" });
  });

  test("maps a 404 to a typed missing_evidence result", async () => {
    const client = stubClient((method, url, body) => {
      expect(method).toBe("POST");
      expect(url.pathname).toBe("/v1/evidence/assets/asset_missing/sign-download");
      return Response.json({ error: "File asset not found: asset_missing" }, { status: 404 });
    });

    const result = await signEvidenceDownload("asset_missing", { client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing_evidence");
    }
  });

  test("maps a server error to a typed sign_failed result without throwing", async () => {
    const client = stubClient(() => new Response("internal error", { status: 500 }));

    const result = await signEvidenceDownload("asset_x", { client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("sign_failed");
    }
  });

  test("returns a typed not_configured result when no client and no package env are available", async () => {
    const env = { ...process.env };
    delete env.FILES_API_URL;
    delete env.FILES_API_KEY;

    const result = await signEvidenceDownload("asset_x", { env });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_configured");
    }
  });
});

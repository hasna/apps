import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const cliPath = join(process.cwd(), "src/cli/index.tsx");
let testDir: string | undefined;

const CLOUD_ENV_KEYS = [
  "HASNA_FILES_API_URL",
  "FILES_API_URL",
  "HASNA_FILES_API_KEY",
  "FILES_API_KEY",
  "HASNA_FILES_MODE",
  "FILES_MODE",
  "FILES_STORAGE_MODE",
] as const;

function isolatedLocalEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides, HASNA_FILES_STORAGE_MODE: "local" };
  for (const key of CLOUD_ENV_KEYS) delete env[key];
  return env;
}

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("evidence CLI", () => {
  test("strips inherited cloud routing from local command-test environments", () => {
    const env = isolatedLocalEnv({
      HASNA_FILES_API_URL: "https://synthetic.invalid",
      HASNA_FILES_API_KEY: "test-only-key",
      FILES_STORAGE_MODE: "self_hosted",
    });
    expect(env.HASNA_FILES_STORAGE_MODE).toBe("local");
    expect(CLOUD_ENV_KEYS.some((key) => env[key] !== undefined)).toBe(false);
  });

  test("keeps remote upload transport credentials out of ordinary command output", async () => {
    testDir = mkdtempSync(join(tmpdir(), "files-evidence-redaction-"));
    const fixture = join(testDir, "receipt.txt");
    writeFileSync(fixture, "synthetic receipt bytes");

    const credentialCanary = "CANARY_CREDENTIAL_VALUE";
    const sessionCanary = "CANARY_SESSION_VALUE";
    const signatureCanary = "CANARY_SIGNATURE_VALUE";
    const failureCanary = "CANARY_PROPAGATED_FAILURE_PATH";
    let uploadReceived = false;
    let completionReceived = false;
    let completionAfterSuccessfulUpload = false;
    let successfulUpload = false;
    let uploadedBytes = "";
    let uploadedHeaders: Headers | undefined;
    let lastAsset: Record<string, unknown> | undefined;

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname === "/v1/evidence/upload-intents") {
          const body = await request.json() as Record<string, unknown>;
          const now = new Date().toISOString();
          const asset: Record<string, unknown> = {
            id: "asset_synthetic",
            org_id: body.org_id,
            app: body.app,
            kind: body.kind,
            classification: "evidence",
            original_name: body.original_name,
            content_type: body.content_type ?? "text/plain",
            size: body.size,
            checksum: body.checksum,
            checksum_algorithm: "sha256",
            storage_provider: "s3",
            bucket: "synthetic-bucket",
            object_key: "evidence/synthetic-object",
            quarantine_key: "quarantine/evidence/synthetic-object",
            status: "pending_upload",
            scan_status: "pending",
            legal_hold: false,
            immutable: false,
            metadata: {},
            created_at: now,
            updated_at: now,
          };
          lastAsset = asset;
          const uploadUrl = new URL("/synthetic-upload-transport", server.url);
          uploadUrl.searchParams.set("Synthetic-Credential", credentialCanary);
          uploadUrl.searchParams.set("Synthetic-Session", sessionCanary);
          uploadUrl.searchParams.set("Synthetic-Signature", signatureCanary);
          return Response.json({
            asset,
            intent: {
              id: "intent_synthetic",
              asset_id: asset.id,
              method: "PUT",
              upload_url: uploadUrl.toString(),
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              status: "pending",
              expected_checksum: body.checksum,
              expected_checksum_algorithm: "sha256",
              expected_size: body.size,
              required_headers: {
                "content-type": asset.content_type,
                "x-amz-checksum-sha256": Buffer.from(String(body.checksum), "hex").toString("base64"),
                "x-amz-meta-asset-id": asset.id,
                "x-amz-meta-org-id": asset.org_id,
                "x-amz-meta-app": asset.app,
                "x-amz-meta-kind": asset.kind,
                "x-amz-meta-checksum": body.checksum,
                "x-amz-meta-checksum-algorithm": "sha256",
              },
              metadata: {},
              created_at: now,
            },
          });
        }
        if (request.method === "PUT" && url.pathname === "/synthetic-upload-transport") {
          uploadReceived = true;
          uploadedHeaders = request.headers;
          uploadedBytes = Buffer.from(await request.arrayBuffer()).toString();
          successfulUpload = true;
          return new Response(null, { status: 200 });
        }
        if (request.method === "POST" && url.pathname === "/v1/evidence/upload-intents/intent_synthetic/complete") {
          completionReceived = true;
          completionAfterSuccessfulUpload = successfulUpload;
          const now = new Date().toISOString();
          return Response.json({
            ...lastAsset,
            status: "verified",
            scan_status: "skipped",
            updated_at: now,
            verified_at: now,
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const proc = Bun.spawn({
        cmd: [
          "bun",
          "run",
          cliPath,
          "evidence",
          "upload",
          fixture,
          "--org",
          "org_hasna",
          "--app",
          "iapp-accounting",
          "--kind",
          "receipt",
          "--json",
        ],
        env: {
          ...process.env,
          HASNA_FILES_STORAGE_MODE: "self_hosted",
          HASNA_FILES_API_URL: new URL("/v1", server.url).toString(),
          HASNA_FILES_API_KEY: "test-only-api-key",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const createProc = Bun.spawn({
        cmd: [
          "bun",
          "run",
          cliPath,
          "evidence",
          "create-upload",
          "--org",
          "org_hasna",
          "--app",
          "iapp-accounting",
          "--kind",
          "receipt",
          "--name",
          "receipt.txt",
          "--size",
          "1",
          "--checksum",
          "0".repeat(64),
          "--json",
        ],
        env: {
          ...process.env,
          HASNA_FILES_STORAGE_MODE: "self_hosted",
          HASNA_FILES_API_URL: new URL("/v1", server.url).toString(),
          HASNA_FILES_API_KEY: "test-only-api-key",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [createExitCode, createStdout, createStderr] = await Promise.all([
        createProc.exited,
        new Response(createProc.stdout).text(),
        new Response(createProc.stderr).text(),
      ]);

      const failingProc = Bun.spawn({
        cmd: [
          "bun",
          "run",
          cliPath,
          "evidence",
          "upload",
          `https://synthetic.invalid/transport/${failureCanary}`,
          "--org",
          "org_hasna",
          "--app",
          "iapp-accounting",
          "--kind",
          "receipt",
          "--json",
        ],
        env: {
          ...process.env,
          HASNA_FILES_STORAGE_MODE: "self_hosted",
          HASNA_FILES_API_URL: new URL("/v1", server.url).toString(),
          HASNA_FILES_API_KEY: "test-only-api-key",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [failingExitCode, failingStdout, failingStderr] = await Promise.all([
        failingProc.exited,
        new Response(failingProc.stdout).text(),
        new Response(failingProc.stderr).text(),
      ]);

      expect(exitCode).toBe(0);
      expect(createExitCode).toBe(0);
      expect(failingExitCode).toBe(1);
      expect(failingStdout).toBe("");
      expect(uploadReceived).toBe(true);
      expect(completionReceived).toBe(true);
      expect(completionAfterSuccessfulUpload).toBe(true);
      expect(uploadedBytes).toBe("synthetic receipt bytes");
      expect(uploadedHeaders?.get("content-type")).toBe("text/plain");
      expect(uploadedHeaders?.get("x-amz-meta-asset-id")).toBe("asset_synthetic");
      const output = JSON.parse(stdout) as { intent: Record<string, unknown> };
      const createOutput = JSON.parse(createStdout) as { intent: Record<string, unknown> };
      expect("upload_url" in output.intent).toBe(false);
      expect("upload_url" in createOutput.intent).toBe(false);
      const ordinaryTranscript = `${stdout}\n${stderr}\n${createStdout}\n${createStderr}\n${failingStdout}\n${failingStderr}`;
      const leaked = [
        "synthetic-upload-transport",
        "Synthetic-Credential",
        "Synthetic-Session",
        "Synthetic-Signature",
        credentialCanary,
        sessionCanary,
        signatureCanary,
        failureCanary,
      ].some((marker) => ordinaryTranscript.includes(marker));
      expect(leaked).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("uploads a local file through the registered evidence command", () => {
    testDir = mkdtempSync(join(tmpdir(), "files-evidence-cli-"));
    const dataDir = testDir;
    const evidenceRoot = join(testDir, "evidence");
    const fixture = join(testDir, "receipt.txt");
    writeFileSync(fixture, "receipt bytes");

    const upload = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        cliPath,
        "evidence",
        "upload",
        fixture,
        "--org",
        "org_hasna",
        "--company",
        "co_us",
        "--app",
        "iapp-accounting",
        "--kind",
        "receipt",
        "--storage",
        "local",
        "--local-root",
        evidenceRoot,
        "--json",
      ],
      env: isolatedLocalEnv({
        HASNA_FILES_DATA_DIR: dataDir,
        HASNA_FILES_DB_PATH: join(dataDir, "files.db"),
        HASNA_FILES_EVIDENCE_STORAGE: "local",
        HASNA_FILES_EVIDENCE_LOCAL_ROOT: evidenceRoot,
      }),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(upload.exitCode).toBe(0);
    const output = JSON.parse(new TextDecoder().decode(upload.stdout)) as {
      asset: { status: string; scan_status: string; storage_provider: string };
    };
    expect(output.asset).toMatchObject({
      status: "verified",
      scan_status: "skipped",
      storage_provider: "local",
    });
  });

  test("verify locates bytes via the persisted root when --local-root is not re-passed", () => {
    testDir = mkdtempSync(join(tmpdir(), "files-evidence-root-"));
    const dataDir = testDir;
    // A custom root that is NOT the default (<dataDir>/evidence) and is NOT set
    // via the env fallback — the only way verify can find the bytes is if the
    // upload persisted the resolved root on the asset.
    const customRoot = join(testDir, "custom-vault");
    const fixture = join(testDir, "receipt.txt");
    writeFileSync(fixture, "receipt bytes for persisted-root regression");

    // Env deliberately omits HASNA_FILES_EVIDENCE_LOCAL_ROOT so nothing but the
    // persisted asset root can point verify at the custom vault.
    const env = isolatedLocalEnv({
      HASNA_FILES_DATA_DIR: dataDir,
      HASNA_FILES_DB_PATH: join(dataDir, "files.db"),
      HASNA_FILES_EVIDENCE_STORAGE: "local",
    });
    delete (env as Record<string, string | undefined>).HASNA_FILES_EVIDENCE_LOCAL_ROOT;

    const upload = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "evidence", "upload", fixture,
        "--org", "org_hasna", "--app", "iapp-accounting", "--kind", "receipt",
        "--storage", "local", "--local-root", customRoot, "--json"],
      env, stdout: "pipe", stderr: "pipe",
    });
    expect(upload.exitCode).toBe(0);
    const uploaded = JSON.parse(new TextDecoder().decode(upload.stdout)) as { asset: { id: string } };

    // Separate invocation, NO --local-root: verify must still find the object.
    const verify = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "evidence", "verify", uploaded.asset.id, "--json"],
      env, stdout: "pipe", stderr: "pipe",
    });
    expect(verify.exitCode).toBe(0);
    const verified = JSON.parse(new TextDecoder().decode(verify.stdout)) as { ok: boolean; diagnostics: string[] };
    expect(verified.diagnostics).toEqual([]);
    expect(verified.ok).toBe(true);
  });
});

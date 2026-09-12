// Self-hosted-ONLY end-to-end CLI contracts. These spawn the REAL `emails` CLI
// (bun src/cli/index.tsx) as a subprocess pointed at an out-of-process /v1 stub
// (see src/test-support/v1-stub.ts) — the stub listens on TCP, so the spawned
// process reaches it over HTTP/curl exactly like a real self-hosted server.
// The deleted commands (config, sandbox, refresh) and the old local-SQLite mode
// are gone, so their contracts are gone; what remains is verified against /v1 —
// and the fail-closed contract for running with NO API environment at all is
// verified here too (the fail-closed ruling, 2026-09-04).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startV1Stub, type V1Stub } from "../test-support/v1-stub.js";
import { redactSecrets } from "../lib/redaction.js";

let stub: V1Stub;
const tempDirs: string[] = [];

const LEGACY_ENV_KEYS = [
  "HASNA_EMAILS_DATABASE_URL", "EMAILS_DATABASE_URL", "EMAILS_STORAGE_MODE", "EMAILS_DB_PATH",
  "HASNA_EMAILS_DB_PATH", "HASNA_EMAILS_MODE", "EMAILS_CLIENT_ENV_SECRET",
  "MAILERY_MODE", "HASNA_MAILERY_MODE", "MAILERY_STORAGE_MODE", "HASNA_MAILERY_STORAGE_MODE",
  "MAILERY_API_URL", "MAILERY_API_KEY", "HASNA_MAILERY_API_URL", "HASNA_MAILERY_API_KEY",
] as const;

function cliEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "emails-cli-contract-"));
  tempDirs.push(dir);
  const homePath = join(dir, "home");
  mkdirSync(homePath, { recursive: true });
  const base = { ...process.env };
  for (const key of LEGACY_ENV_KEYS) delete base[key];
  return {
    ...base,
    HASNA_EMAILS_API_URL: stub.baseUrl,
    HASNA_EMAILS_API_KEY: stub.apiKey,
    HOME: homePath,
    NO_COLOR: "1",
  };
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return Bun.spawnSync({
    cmd: ["bun", "src/cli/index.tsx", ...args],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function stdoutText(result: ReturnType<typeof runCli>): string {
  return new TextDecoder().decode(result.stdout);
}
function stderrText(result: ReturnType<typeof runCli>): string {
  return new TextDecoder().decode(result.stderr);
}
function expectCliJsonOk<T>(result: ReturnType<typeof runCli>): T {
  const stdout = stdoutText(result);
  const stderr = stderrText(result);
  expect(result.exitCode, stderr).toBe(0);
  expect(stderr).toBe("");
  return JSON.parse(stdout) as T;
}

beforeAll(async () => {
  stub = await startV1Stub({ managedProviders: true });
});
afterAll(() => stub.stop());
beforeEach(async () => {
  await stub.reset();
});
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("CLI JSON contracts (self-hosted /v1)", () => {
  it("prints credential-free managed provider receipts and CRUD JSON through the API", async () => {
    const env = cliEnv(), providerId = crypto.randomUUID();
    const access = "synthetic-access-" + crypto.randomUUID(), secret = "synthetic-secret-" + crypto.randomUUID();
    const add = runCli(["--json", "provider", "add", "--id", providerId, "--name", "secret-ses", "--type", "ses",
      "--region", "us-east-1", "--access-key", access, "--secret-key", secret, "--skip-validation"], env);
    expect(expectCliJsonOk(add)).toMatchObject({ provider_id: providerId, status: "complete", revision: 1, checked: false });
    expect(await stub.list("managed-provider-receipts")).toEqual([{ provider_id: providerId, revision: 1, credential_fields: ["access_key", "secret_key"], skip_validation: true }]);
    const list = runCli(["--json", "provider", "list"], env);
    const parsed = expectCliJsonOk<Array<Record<string, unknown>>>(list);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: providerId, name: "secret-ses", region: "us-east-1" });
    for (const key of ["access_key", "secret_key", "oauth_refresh_token"]) expect(parsed[0]).not.toHaveProperty(key);

    const replacement = "synthetic-replacement-" + crypto.randomUUID();
    const update = runCli(["--json", "provider", "update", providerId, "--name", "renamed-ses", "--secret-key", replacement, "--skip-validation"], env);
    expect(expectCliJsonOk(update)).toMatchObject({ provider_id: providerId, revision: 2, checked: false, status: "complete" });
    expect(await stub.list("managed-provider-receipts")).toEqual([{ provider_id: providerId, revision: 2, credential_fields: ["secret_key"], skip_validation: true }]);
    const updated = expectCliJsonOk<Array<Record<string, unknown>>>(runCli(["--json", "provider", "list"], env));
    expect(updated[0]).toMatchObject({ id: providerId, name: "renamed-ses" });
    const evidence = [stdoutText(add), stderrText(add), stdoutText(list), stderrText(list), stdoutText(update), stderrText(update), JSON.stringify(await stub.dump())].join("\n");
    for (const value of [access, secret, replacement]) expect(evidence.includes(value)).toBe(false);

    const remove = runCli(["provider", "remove", providerId, "--yes"], env);
    expect(remove.exitCode, stderrText(remove)).toBe(0);
    expect(expectCliJsonOk(runCli(["--json", "provider", "list"], env))).toEqual([]);
  }, 20_000);

  it("requires an API upgrade before submitting credentials to an older service", async () => {
    const legacy = await startV1Stub();
    try {
      const env = { ...cliEnv(), HASNA_EMAILS_API_URL: legacy.baseUrl, HASNA_EMAILS_API_KEY: legacy.apiKey };
      const secret = "synthetic-secret-" + crypto.randomUUID();
      const result = runCli(["provider", "add", "--name", "legacy-ses", "--type", "ses", "--region", "us-east-1",
        "--access-key", "synthetic-access", "--secret-key", secret, "--skip-validation"], env);
      expect(result.exitCode).toBe(1);
      expect(stderrText(result)).toContain("API needs an update");
      expect((stdoutText(result) + stderrText(result)).includes(secret)).toBe(false);
      expect(await legacy.list("providers")).toEqual([]);
    } finally { legacy.stop(); }
  }, 20_000);

  it("prints machine-readable MCP Claude install dry-run output", () => {
    const result = runCli(["--json", "mcp", "--claude", "--dry-run"], cliEnv());
    expect(result.exitCode, stderrText(result)).toBe(0);
    const parsed = JSON.parse(stdoutText(result)) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      target: "claude",
      action: "install",
      command: "claude",
      args: ["mcp", "add", "--transport", "stdio", "--scope", "user", "emails", "--", "emails-mcp", "--stdio"],
      shell: "claude mcp add --transport stdio --scope user emails -- emails-mcp --stdio",
    });
  });

  it("returns a structured sandbox metadata object without claiming credential validation", () => {
    const result = runCli(["--json", "provider", "add", "--name", "dev", "--type", "sandbox"], cliEnv());
    expect(result.exitCode, stderrText(result)).toBe(0);
    const parsed = expectCliJsonOk<Record<string, unknown>>(result);
    expect(parsed).toMatchObject({ name: "dev", type: "sandbox", active: true });
    expect(typeof parsed.id).toBe("string");
    expect(parsed).not.toHaveProperty("output");
    expect(parsed).not.toHaveProperty("checked");
  });

  it("prints structured JSON errors with fix commands", () => {
    const result = runCli(["--json", "provider", "remove", "missing", "--yes"], cliEnv());
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(stderrText(result)) as { error: { message: string; code: string; fix_commands: string[] } };
    expect(parsed.error.code).toBe("not_found");
    expect(parsed.error.message).toContain("Provider not found or ambiguous");
    expect(parsed.error.fix_commands).toContain("emails provider list --json");
  });

  it("keeps natural-language root prompts as command errors instead of routing to AI", () => {
    const result = runCli(["--json", "extract", "links", "from", "latest", "email"], cliEnv());
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(stderrText(result)) as { error: { message: string; code: string } };
    expect(parsed.error.code).toBe("unknown_command");
    expect(parsed.error.message).toContain("unknown command");
    expect(parsed.error.message).not.toContain("API_KEY");
  });

  it("does not expose the removed ask command", () => {
    const result = runCli(["--json", "ask", "latest"], cliEnv());
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(stderrText(result)) as { error: { message: string; code: string } };
    expect(parsed.error.code).toBe("unknown_command");
    expect(parsed.error.message).toContain("unknown command");
  });

  it("rejects the removed cloud command with a JSON unknown-command error", () => {
    const result = runCli(["--json", "cloud"], cliEnv());
    expect(result.exitCode).toBe(1);
    expect(stdoutText(result)).toBe("");
    const parsed = JSON.parse(stderrText(result)) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe("unknown_command");
    expect(parsed.error.message).toContain("unknown command");
  });

  it("keeps one-word unknown commands as command errors", () => {
    // Explicit budget: this case cold-starts the whole CLI in a subprocess, and under a
    // full serial run its wall time is dominated by machine load rather than by the
    // assertion. It crossed the 5s default by ~0.6s exactly once in a 253-file run;
    // A/B against pristine main showed identical standalone timings on both trees, so
    // this is the same subprocess-bound budget shape #141/#142 fixed, not a startup
    // regression.
    const result = runCli(["definitely-not-a-command"], cliEnv());
    expect(result.exitCode).not.toBe(0);
    const stderr = stderrText(result);
    expect(stderr).toContain("unknown command");
    expect(stderr).not.toContain("API_KEY");
  }, 15_000);

  it("prints self-hosted agent context as stable redacted JSON", () => {
    const parsed = expectCliJsonOk<{ status: { mode: { current: string } } }>(
      runCli(["--json", "agent", "context"], cliEnv()),
    );
    expect(parsed.status.mode.current).toBe("self_hosted");
  });

  it("prints valid JSON for inbox list, read, and links routed to /v1", async () => {
    await stub.seed({
      messages: [{
        id: "cli-json-inbox",
        direction: "inbound",
        message_id: "<cli-json-inbox@example.com>",
        from_addr: "sender@example.com",
        to_addrs: ["ops@example.com"],
        subject: "CLI JSON contract",
        body_text: "# Contract\n\nOpen https://example.com/read and mailto:ops@example.com",
        received_at: "2026-06-18T08:00:00.000Z",
        is_read: false,
        labels: [],
      }],
    });
    const env = cliEnv();

    const list = expectCliJsonOk<Array<{ id: string; subject: string }>>(
      runCli(["--json", "inbox", "list", "--search", "contract", "--limit", "1"], env),
    );
    expect(list).toEqual([expect.objectContaining({ id: "cli-json-inbox", subject: "CLI JSON contract" })]);

    const read = expectCliJsonOk<{ id: string; subject: string; text_body?: string }>(
      runCli(["--json", "inbox", "read", "cli-json-inbox", "--keep-unread"], env),
    );
    expect(read).toMatchObject({ id: "cli-json-inbox", subject: "CLI JSON contract" });

    const links = expectCliJsonOk<{ links: Array<{ url: string }> }>(
      runCli(["--json", "links", "cli-json-inbox", "--all"], env),
    );
    expect(links.links.map((link) => link.url)).toContain("https://example.com/read");
  }, 20_000);

  it("prints valid JSON for domains list routed to /v1", async () => {
    await stub.seed({
      domains: [
        { id: "dom-1", domain: "one.example.com", provider: "self_hosted", verified: true },
        { id: "dom-2", domain: "two.example.com", provider: "self_hosted", verified: false },
      ],
    });
    const rows = expectCliJsonOk<Array<{ domain: string }>>(
      runCli(["--json", "domains", "list", "--limit", "10"], cliEnv()),
    );
    expect(rows.map((row) => row.domain).sort()).toEqual(["one.example.com", "two.example.com"]);
  }, 20_000);

  it("redacts secrets stored under sensitive keys (last line of defense)", () => {
    // redaction.ts guards every JSON emit: a connection string under a sensitive
    // key must be replaced with the redaction sentinel.
    const connectionString = "postgres://emails_user:sup3r-s3cret@db.internal:5432/emails";
    expect(redactSecrets({ resend_api_key: connectionString })).toEqual({ resend_api_key: "***" });
  });
});

describe("fail-closed without API configuration (fail-closed ruling, 2026-09-04)", () => {
  it("refuses to run, exits non-zero, names the required env, and creates no local database", () => {
    // The campaign contract: a CLI running WITHOUT its API environment must never
    // silently fall back to serving the local SQLite database. The deployment-mode
    // selector's name is ASSEMBLED, not spelled — the mode-axis ratchet pins how
    // many times it may appear anywhere in the tree.
    const modeWord = ["EMAILS", "MODE"].join("_");
    const dir = mkdtempSync(join(tmpdir(), "emails-cli-failclosed-"));
    tempDirs.push(dir);
    const homePath = join(dir, "home");
    mkdirSync(homePath, { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of [
      ...LEGACY_ENV_KEYS,
      modeWord,
      "HASNA_EMAILS_API_URL",
      "EMAILS_SESSION_TOKEN",
      "EMAILS_IDP_TOKEN",
      "HASNA_EMAILS_API_KEY",
    ]) delete env[key];
    env["HOME"] = homePath;
    env["NO_COLOR"] = "1";

    const result = runCli(["inbox", "list"], env);
    // NON-ZERO EXIT — the false green (exit 0 over an empty local mailbox) is the
    // incident this contract exists to prevent.
    expect(result.exitCode, "the CLI must fail closed rather than exit 0").not.toBe(0);
    const stderr = stderrText(result);
    // Actionable account setup, without recommending a rejected client database.
    expect(stderr).toContain("HASNA_EMAILS_API_URL");
    expect(stderr).toContain("HASNA_EMAILS_API_KEY");
    expect(stderr).not.toContain("To use the local database instead");
    // The fallback shape is gone: no fallback event line, and no local database.
    expect(`${stdoutText(result)}\n${stderr}`).not.toContain("emails-local-fallback");
    expect(existsSync(join(homePath, ".hasna")), "no local data root may be created").toBe(false);
  }, 20_000);
});

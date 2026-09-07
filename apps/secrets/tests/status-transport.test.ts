// `secrets status` names WHERE its hosted transport came from (hasna/apps#1720
// validation): the resolver's `apiUrlSource` / `apiKeySource` / `apiKeyTier`,
// as NAMES only — an env key name, a Keychain item reference, a file path with
// the home prefix folded to `~`, or "default". Never a value. A local-vault run
// reports `transport: null`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSecretReferenceStatus } from "../src/status.js";
import type { KeychainCommandRunner } from "../src/store/client.js";

const FIXTURE_KEY = "hasna_secrets_fixture_key_status_0004";

let server: ReturnType<typeof Bun.serve>;
let apiUrl: string;
let testDir: string;

beforeAll(() => {
  testDir = join(tmpdir(), `secrets-status-transport-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (req.headers.get("x-api-key") !== FIXTURE_KEY) return Response.json({ error: "unauthorized" }, { status: 401 });
      if (url.pathname === "/v1/secrets") return Response.json({ secrets: [{ key: "a", type: "token", created_at: "", updated_at: "" }] });
      if (url.pathname === "/v1/users") return Response.json({ users: [{ id: "u", name: "U", type: "agent" }] });
      if (url.pathname === "/v1/audit") return Response.json({ entries: [] });
      return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
    },
  });
  apiUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(testDir, { recursive: true, force: true });
});

function fakeKeychain(items: Record<string, string>): KeychainCommandRunner {
  return (argv) => {
    const service = argv[argv.indexOf("-s") + 1] ?? "";
    const value = items[service];
    if (value === undefined) return { status: 44, stdout: "", stderr: "not found" };
    return { status: 0, stdout: `${value}\n`, stderr: "" };
  };
}

describe("status transport provenance", () => {
  it("names the env tier for a URL + key pair from the environment", async () => {
    const status = await getSecretReferenceStatus({ HASNA_SECRETS_API_URL: apiUrl, HASNA_SECRETS_API_KEY: FIXTURE_KEY });

    expect(status.mode).toBe("api");
    expect(status.transport).toEqual({
      api_url_source: "HASNA_SECRETS_API_URL",
      api_key_source: "HASNA_SECRETS_API_KEY",
      api_key_tier: "env",
    });
    expect(status.counts.secrets).toBe(1);
    expect(status.counts.users).toBe(1);
    expect(JSON.stringify(status)).not.toContain(FIXTURE_KEY);
  });

  it("names the Keychain item (never its value) when the key came from the Keychain tier", async () => {
    const run = fakeKeychain({
      "hasna.credentials.secrets.api-key": FIXTURE_KEY,
      "hasna.credentials.secrets.api-url": apiUrl,
    });
    const status = await getSecretReferenceStatus(
      { HASNA_STATION: "status-fixture-station" },
      { credentials: { keychain: { run, platform: "darwin" } } },
    );

    expect(status.mode).toBe("api");
    expect(status.transport).toEqual({
      api_url_source: "keychain:hasna.credentials.secrets.api-url@status-fixture-station",
      api_key_source: "keychain:hasna.credentials.secrets.api-key@status-fixture-station",
      api_key_tier: "keychain",
    });
    expect(JSON.stringify(status)).not.toContain(FIXTURE_KEY);
  });

  it("folds the home prefix of a credentials-file source to ~", async () => {
    const home = join(testDir, "home");
    const hasnaHome = join(home, ".hasna");
    const configDir = join(hasnaHome, "secrets", "config");
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(configDir, "credentials"),
      `HASNA_SECRETS_API_URL="${apiUrl}"\nHASNA_SECRETS_API_KEY="${FIXTURE_KEY}"\n`,
      { mode: 0o600 },
    );
    const status = await getSecretReferenceStatus({ HOME: home });

    expect(status.transport?.api_key_tier).toBe("disk");
    // The resolver names the file; status must not spell the operator's home.
    expect(status.transport?.api_key_source).toBe(
      home === process.env.HOME ? "~/.hasna/secrets/config/credentials" : join(configDir, "credentials"),
    );
    expect(JSON.stringify(status)).not.toContain(FIXTURE_KEY);
  });

  it("reports transport: null for an opted-in local run", async () => {
    const status = await getSecretReferenceStatus({
      HASNA_SECRETS_LOCAL_VAULT: "1",
      HASNA_HOME: join(testDir, "empty-hasna-home"),
      HASNA_SECRETS_DB_PATH: join(testDir, "local-vault.db"),
      HASNA_SECRETS_KEY_DIR: join(testDir, "local-keys"),
    });
    expect(status.mode).toBe("local");
    expect(status.transport).toBeNull();
  });
});

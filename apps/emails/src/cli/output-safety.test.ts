import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startV1Stub, type V1Stub } from "../test-support/v1-stub.js";

let stub: V1Stub;
const tempDirs: string[] = [];

const SCRUBBED_ENV_KEYS = [
  "EMAILS_CLIENT_ENV_SECRET",
  "HASNA_EMAILS_API_URL",
  "HASNA_EMAILS_API_KEY",
  "EMAILS_SESSION_TOKEN",
  "MAILERY_API_URL",
  "MAILERY_API_KEY",
  "HASNA_MAILERY_API_URL",
  "HASNA_MAILERY_API_KEY",
] as const;

function isolatedEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "emails-cli-output-safety-"));
  tempDirs.push(dir);
  const homePath = join(dir, "home");
  // 0700, not the umask default: the store-seam selection resolves the default
  // database path under HOME, and the SQLite directory-safety check refuses a
  // world-writable tmp ancestor.
  mkdirSync(homePath, { recursive: true, mode: 0o700 });
  const env = { ...process.env };
  for (const key of SCRUBBED_ENV_KEYS) delete env[key];
  return {
    ...env,
    HOME: homePath,
    NO_COLOR: "1",
  };
}

function selfHostedEnv(): NodeJS.ProcessEnv {
  return {
    ...isolatedEnv(),
    HASNA_EMAILS_API_URL: stub.baseUrl,
    HASNA_EMAILS_API_KEY: stub.apiKey,
  };
}

function rejectedClientEnvPointer(): { env: NodeJS.ProcessEnv; sentinel: string } {
  const env = isolatedEnv();
  const binDir = mkdtempSync(join(tmpdir(), "emails-cli-client-env-rejection-"));
  tempDirs.push(binDir);
  const secretsBin = join(binDir, "secrets");
  writeFileSync(secretsBin, "#!/bin/sh\nexit 2\n");
  chmodSync(secretsBin, 0o700);
  const sentinel = "OPE105_00301_SYNTHETIC_SENTINEL";
  return {
    env: {
      ...env,
      PATH: `${binDir}:${env.PATH ?? ""}`,
      EMAILS_CLIENT_ENV_SECRET: JSON.stringify({ fixture: sentinel }),
    },
    sentinel,
  };
}

function loadedClientEnvWithInvalidApiUrl(): {
  env: NodeJS.ProcessEnv;
  sentinel: string;
  invalidUrl: string;
} {
  const env = isolatedEnv();
  const binDir = mkdtempSync(join(tmpdir(), "emails-cli-client-env-invalid-url-"));
  tempDirs.push(binDir);
  const secretsBin = join(binDir, "secrets");
  const sentinel = "OPE105_00301_LOADED_URL_SENTINEL";
  const invalidUrl = `ftp://${sentinel}.invalid`;
  const payload = JSON.stringify({
    HASNA_EMAILS_API_URL: invalidUrl,
    HASNA_EMAILS_API_KEY: "not-a-real-key",
  });
  writeFileSync(secretsBin, `#!/bin/sh
if [ "$1" = "get" ]; then
  printf '%s\\n' ${JSON.stringify(payload)}
  exit 0
fi
exit 2
`);
  chmodSync(secretsBin, 0o700);
  return {
    env: {
      ...env,
      PATH: `${binDir}:${env.PATH ?? ""}`,
      EMAILS_CLIENT_ENV_SECRET: "hasna/test/opensource/emails/prod/client-env",
    },
    sentinel,
    invalidUrl,
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

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function largeDomains(): Array<Record<string, unknown>> {
  return Array.from({ length: 1000 }, (_, index) => {
    const serial = String(index).padStart(4, "0");
    return {
      id: `slow-pipe-${serial}-${"i".repeat(72)}`,
      domain: `${serial}.${"d".repeat(180)}.example`,
      provider_id: "self-hosted",
      verified: false,
      dkim_status: "pending",
      spf_status: "pending",
      dmarc_status: "pending",
      created_at: "2026-07-24T00:00:00.000Z",
      updated_at: "2026-07-24T00:00:00.000Z",
    };
  });
}

beforeAll(async () => {
  stub = await startV1Stub();
});

afterAll(() => stub.stop());

beforeEach(async () => {
  await stub.reset();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("CLI JSON output safety", () => {
  it("fully drains a large JSON document to a slow pipe identically to a regular file", async () => {
    await stub.seed({ domains: largeDomains() });
    const env = selfHostedEnv();
    const outputDir = mkdtempSync(join(tmpdir(), "emails-cli-output-files-"));
    tempDirs.push(outputDir);
    const regularPath = join(outputDir, "regular.json");
    const slowPath = join(outputDir, "slow.json");
    const args = "--json domains list --limit 1000";

    const regular = spawnSync("bash", ["-lc", `bun src/cli/index.tsx ${args} > "$REGULAR_OUT"`], {
      cwd: process.cwd(),
      env: { ...env, REGULAR_OUT: regularPath },
      encoding: "utf8",
    });
    expect(regular.status, regular.stderr).toBe(0);
    expect(regular.stderr).toBe("");

    const slowConsumer = [
      "const reader = Bun.stdin.stream().getReader();",
      "const writer = Bun.file(process.env.SLOW_OUT).writer();",
      "while (true) {",
      "  const { done, value } = await reader.read();",
      "  if (done) break;",
      "  writer.write(value);",
      "  await Bun.sleep(2);",
      "}",
      "await writer.end();",
    ].join(" ");
    const slow = spawnSync(
      "bash",
      ["-lc", `set -o pipefail; bun src/cli/index.tsx ${args} | bun -e "$SLOW_CONSUMER"`],
      {
        cwd: process.cwd(),
        env: { ...env, SLOW_OUT: slowPath, SLOW_CONSUMER: slowConsumer },
        encoding: "utf8",
      },
    );
    expect(slow.status, slow.stderr).toBe(0);
    expect(slow.stderr).toBe("");

    const regularJson = readFileSync(regularPath, "utf8");
    const slowJson = readFileSync(slowPath, "utf8");
    expect(slowJson).toBe(regularJson);
    const parsed = JSON.parse(slowJson) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1000);
  }, 30_000);

  it("exits nonzero without a Bun stack when the JSON pipe closes early", async () => {
    await stub.seed({ domains: largeDomains() });
    const result = spawnSync(
      "bash",
      ["-lc", "set -o pipefail; bun src/cli/index.tsx --json domains list --limit 1000 | head -c 1 >/dev/null"],
      {
        cwd: process.cwd(),
        env: selfHostedEnv(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe("output_closed");
    expect(parsed.error.message).toContain("closed before the JSON document was fully written");
    expect(result.stderr).not.toContain("\n      at ");
    expect(result.stderr).not.toContain("Bun v");
  }, 20_000);
});

describe("CLI self-hosted bootstrap failures", () => {
  it("redacts an invalid API URL loaded from client-env on human and JSON stderr", () => {
    for (const json of [false, true]) {
      const { env, sentinel, invalidUrl } = loadedClientEnvWithInvalidApiUrl();
      const result = runCli(json ? ["--json", "status"] : ["status"], env);
      const stdout = text(result.stdout);
      const stderr = text(result.stderr);

      expect(result.exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).not.toContain(sentinel);
      expect(stderr).not.toContain(invalidUrl);

      if (json) {
        const parsed = JSON.parse(stderr) as { error: { message: string } };
        expect(parsed.error.message).toContain("must be an http or https URL");
      } else {
        expect(stderr).toContain("must be an http or https URL");
      }
    }
  });

  it("ignores a leftover selector variable and reports the local backend on human and JSON stdout", () => {
    for (const json of [false, true]) {
      // The child env is pinned to the all-unset default row: sibling test
      // files may set a database-path var in the shared process env, which
      // would silently select the configured-store path and change which
      // stderr contract this test asserts.
      const env = { ...isolatedEnv(), [["EMAILS", "MODE"].join("_")]: "self-hosted" };
      for (const key of ["HASNA_EMAILS_DB_PATH", "EMAILS_DB_PATH"]) delete env[key];
      const result = runCli(json ? ["--json", "status"] : ["status"], env);
      const stdout = text(result.stdout);
      const stderr = text(result.stderr);

      expect(result.exitCode, stderr).toBe(0);
      // main's 1.4.0 fallback-notice contract (incident 715712): the all-unset
      // default row names the local-SQLite fallback on stderr in machine-readable
      // JSON. The leftover selector variable still selects nothing. In --json
      // mode the CLI JSON runtime reroutes console.error into the structured
      // document and emits no raw stderr, so the notice is absent there by design.
      if (json) expect(stderr).toBe("");
      else expect(stderr).toContain("emails-local-fallback");
      expect(stdout).not.toContain("self-hosted");

      if (json) {
        const parsed = JSON.parse(stdout) as { backend: string };
        expect(parsed.backend).toBe("sqlite");
      } else {
        expect(stdout).toContain("Backend:");
      }
    }
  });

  it("redacts rejected client-env input from human and JSON stderr", () => {
    for (const json of [false, true]) {
      const { env, sentinel } = rejectedClientEnvPointer();
      const result = runCli(json ? ["--json", "status"] : ["status"], env);
      const stdout = text(result.stdout);
      const stderr = text(result.stderr);

      expect(result.exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).not.toContain(sentinel);
      expect(stderr).not.toContain(env.EMAILS_CLIENT_ENV_SECRET!);

      if (json) {
        const parsed = JSON.parse(stderr) as {
          error: { code: string; message: string; fix_commands: string[] };
        };
        expect(parsed.error.code).toBe("error");
        expect(parsed.error.message).toContain("EMAILS_CLIENT_ENV_SECRET failed to load from the secrets vault");
        expect(parsed.error.fix_commands).toContain("emails --help");
      } else {
        expect(stderr).toContain("EMAILS_CLIENT_ENV_SECRET failed to load from the secrets vault");
      }
    }
  });

  it("keeps ordinary nonsecret configuration diagnostics descriptive", () => {
    for (const json of [false, true]) {
      const result = runCli(
        json ? ["--json", "status"] : ["status"],
        { ...isolatedEnv(), HASNA_EMAILS_API_URL: "not a url" },
      );
      const stderr = text(result.stderr);

      expect(result.exitCode).toBe(1);
      expect(text(result.stdout)).toBe("");
      if (json) {
        const parsed = JSON.parse(stderr) as { error: { code: string; message: string } };
        expect(parsed.error.code).toBe("auth_error");
        expect(parsed.error.message).toContain("is not a URL");
      } else {
        expect(stderr).toContain("is not a URL");
      }
    }
  });

  it("returns one structured JSON error and creates no local SQLite state for missing or invalid configuration", () => {
    const cases = [
      {
        name: "missing",
        env: { HASNA_EMAILS_API_URL: "https://emails.example.invalid" },
        message: "no credential is set",
      },
      {
        name: "invalid",
        env: {
          HASNA_EMAILS_API_URL: "ftp://emails.example.invalid",
          HASNA_EMAILS_API_KEY: "not-a-real-key",
        },
        message: "must be an http or https URL",
      },
    ] as const;

    for (const testCase of cases) {
      const env = isolatedEnv();
      // No database path is configured for either case: a local database path
      // beside a configured API URL is itself a boot refusal, which fires before
      // URL validation and would mask the diagnostic under test.
      const result = runCli(["--json", "inbox", "list"], { ...env, ...testCase.env });

      expect(result.exitCode, `${testCase.name}: ${text(result.stderr)}`).toBe(1);
      expect(text(result.stdout)).toBe("");
      const stderr = text(result.stderr);
      const parsed = JSON.parse(stderr) as { error: { code: string; message: string } };
      expect(parsed.error.message).toContain(testCase.message);
      expect(stderr).not.toContain("\n      at ");
      expect(stderr).not.toContain("Bun v");
      // Boot refused before any SQLite state existed: the default database path
      // under HOME must not exist either.
      expect(existsSync(join(env.HOME!, ".hasna", "emails", "emails.db"))).toBe(false);
    }
  }, 20_000);
});

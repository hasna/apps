import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  SelfHostedHttpError,
  SelfHostedTransportError,
  selfHostedApiRequest,
  selfHostedProbe,
  selfHostedStoreFor,
  isSelfHostedMode,
  resetSelfHostedConfigCache,
  resolveSelfHostedConfig,
} from "./self-hosted-store.js";
import { EMAILS_SELF_HOSTED_API_KEY_ENV, EMAILS_SESSION_TOKEN_ENV } from "../lib/client-env.js";
import {
  CLIENT_DATABASE_SETTINGS, EMAILS_API_KEY_SETTINGS, EMAILS_API_URL_SETTINGS,
  RETIRED_EMAILS_SELECTOR_SETTINGS,
} from "../lib/client-settings.js";
import { SelfHostedWireResponseError } from "../lib/self-hosted-wire.js";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let INHERITED_PROCESS_ENV: NodeJS.ProcessEnv;
let ORIGINAL_PATH: string | undefined;
function captureInheritedProcessEnv(): void {
  INHERITED_PROCESS_ENV = { ...process.env };
  ORIGINAL_PATH = process.env["PATH"];
}
function restoreInheritedProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(INHERITED_PROCESS_ENV, key)) delete process.env[key];
  }
  Object.assign(process.env, INHERITED_PROCESS_ENV);
}

const KEYS = [
  ...RETIRED_EMAILS_SELECTOR_SETTINGS,
  ...CLIENT_DATABASE_SETTINGS,
  ...EMAILS_API_URL_SETTINGS,
  ...EMAILS_API_KEY_SETTINGS,
  "EMAILS_CLIENT_ENV_SECRET",
  "EMAILS_IDP_TOKEN",
  EMAILS_SESSION_TOKEN_ENV,
  "EMAILS_SELF_HOSTED_HTTP_CONNECT_TIMEOUT",
  "EMAILS_SELF_HOSTED_HTTP_TIMEOUT",
  "EMAILS_SELF_HOSTED_HTTP_MAX_RESPONSE_BYTES",
  "EMAILS_API_SIGNING_KEY",
  "HASNA_MAILERY_API_SIGNING_KEY",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "HASNA_MAILERY_API_URL",
  "HASNA_MAILERY_API_KEY",
  "MAILERY_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "CLOUDFLARE_API_KEY",
];
let tempDirs: string[] = [];

function configureClient(url = "https://emails.example", key = "test-key"): void {
  process.env["HASNA_EMAILS_API_URL"] = url;
  process.env["HASNA_EMAILS_API_KEY"] = key;
}

function clearEnv(): void {
  for (const key of KEYS) delete process.env[key];
  if (ORIGINAL_PATH === undefined) delete process.env["PATH"];
  else process.env["PATH"] = ORIGINAL_PATH;
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
  resetSelfHostedConfigCache();
}

function installFakeSecrets(payload: string): void {
  const dir = mkdtempSync(join(tmpdir(), "emails-client-env-test-"));
  tempDirs.push(dir);
  const bin = join(dir, "secrets");
  writeFileSync(bin, `#!/bin/sh
if [ "$1" = "get" ] && [ "$2" = "hasna/test/opensource/emails/prod/client-env" ]; then
  printf '%s\\n' '${payload}'
  exit 0
fi
exit 2
`);
  chmodSync(bin, 0o700);
  process.env["PATH"] = `${dir}:${ORIGINAL_PATH ?? ""}`;
  process.env["EMAILS_CLIENT_ENV_SECRET"] = "hasna/test/opensource/emails/prod/client-env";
}

function installFakeCurl(
  response: { body?: string; status?: number } = {},
): { argsPath: string; stdinPath: string; envPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "emails-curl-test-"));
  tempDirs.push(dir);
  const argsPath = join(dir, "curl-args.txt");
  const stdinPath = join(dir, "curl-stdin.txt");
  const envPath = join(dir, "curl-env.txt");
  const responsePath = join(dir, "curl-response.txt");
  const bin = join(dir, "curl");
  writeFileSync(
    responsePath,
    response.body
      ?? '{"domain":{"id":"domain-1","domain":"example.com","status":"pending","provider":null,"verified":false,"notes":null,"provisioning_status":"none","purchase_provider":null,"dns_provider":"cloudflare","send_provider":null,"cf_zone_id":null,"registrar":null,"nameservers_json":[],"mail_from_domain":null,"last_error":null,"next_check_at":null,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}}',
  );
  writeFileSync(bin, `#!/bin/sh
ARGS_PATH=${JSON.stringify(argsPath)}
STDIN_PATH=${JSON.stringify(stdinPath)}
ENV_PATH=${JSON.stringify(envPath)}
RESPONSE_PATH=${JSON.stringify(responsePath)}
STATUS=${JSON.stringify(String(response.status ?? 201))}
printf '%s\\n' "$@" > "$ARGS_PATH"
env | sort > "$ENV_PATH"
cat > "$STDIN_PATH"
cat "$RESPONSE_PATH"
printf '\\n%s' "$STATUS"
`);
  chmodSync(bin, 0o700);
  process.env["PATH"] = `${dir}:${process.env["PATH"] ?? ORIGINAL_PATH ?? ""}`;
  return { argsPath, stdinPath, envPath };
}

function installFakeCurlSessionFallback(
  first: { body: string; status: number },
  second: { body: string; status: number },
): { stdinForCall: (call: number) => string; callsPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "emails-curl-fallback-test-"));
  tempDirs.push(dir);
  const callsPath = join(dir, "curl-calls.txt");
  const countPath = join(dir, "curl-count.txt");
  const bin = join(dir, "curl");
  writeFileSync(bin, `#!/bin/sh
COUNT_PATH=${JSON.stringify(countPath)}
CALLS_PATH=${JSON.stringify(callsPath)}
COUNT="$(cat "$COUNT_PATH" 2>/dev/null || printf '0')"
COUNT=$((COUNT + 1))
printf '%s' "$COUNT" > "$COUNT_PATH"
STDIN_PATH=${JSON.stringify(join(dir, "curl-stdin"))}-$COUNT.txt
cat > "$STDIN_PATH"
printf '%s\\n' "$COUNT" >> "$CALLS_PATH"
if [ "$COUNT" = "1" ]; then
  printf '%s\\n' ${JSON.stringify(first.body)}
  printf '\\n%s' ${JSON.stringify(String(first.status))}
  exit 0
fi
printf '%s\\n' ${JSON.stringify(second.body)}
printf '\\n%s' ${JSON.stringify(String(second.status))}
`);
  chmodSync(bin, 0o700);
  process.env["PATH"] = `${dir}:${process.env["PATH"] ?? ORIGINAL_PATH ?? ""}`;
  return {
    callsPath,
    stdinForCall: (call) => join(dir, `curl-stdin-${call}.txt`),
  };
}

describe("Emails self-hosted client resolver", () => {
  beforeEach(() => {
    captureInheritedProcessEnv();
    clearEnv();
  });
  afterEach(() => {
    clearEnv();
    restoreInheritedProcessEnv();
  });

  test("unset API configuration fails loud without selecting local storage", () => {
    expect(() => isSelfHostedMode()).toThrow("HASNA_EMAILS_API_URL is required");
    expect(() => resolveSelfHostedConfig()).toThrow("HASNA_EMAILS_API_URL is required");
    expect(() => selfHostedStoreFor("domains")).toThrow("HASNA_EMAILS_API_URL is required");
  });

  test("requires an explicit URL and credential without a mode selector", () => {
    expect(() => resolveSelfHostedConfig()).toThrow("HASNA_EMAILS_API_URL is required");
    process.env["HASNA_EMAILS_API_URL"] = "https://emails.example";
    resetSelfHostedConfigCache();
    expect(() => resolveSelfHostedConfig()).toThrow("An Emails API credential is required");
    process.env["HASNA_EMAILS_API_KEY"] = "test-key";
    resetSelfHostedConfigCache();
    expect(resolveSelfHostedConfig()?.baseUrl).toBe("https://emails.example/v1");
  });

  test("EMAILS_CLIENT_ENV_SECRET configures direct self-hosted resource resolution", () => {
    installFakeSecrets('{"HASNA_EMAILS_API_URL":"https://emails.example","HASNA_EMAILS_API_KEY":"test-token"}');

    expect(resolveSelfHostedConfig()?.baseUrl).toBe("https://emails.example/v1");
    expect(isSelfHostedMode()).toBe(true);
    expect(selfHostedStoreFor("domains")).not.toBeNull();
  });

  test.each(["local", "self_hosted", "cloud", ""])("rejects retired selector %j without loading EMAILS_CLIENT_ENV_SECRET", (mode) => {
    installFakeSecrets('{"HASNA_EMAILS_API_URL":"https://emails.example","HASNA_EMAILS_API_KEY":"test-token"}');
    process.env["EMAILS_MODE"] = mode;

    expect(() => resolveSelfHostedConfig()).toThrow(/EMAILS_MODE.*retired/);
    // Rejected configuration never loads the pointer or changes the environment.
    expect(process.env["HASNA_EMAILS_API_URL"]).toBeUndefined();
    expect(process.env["HASNA_EMAILS_API_KEY"]).toBeUndefined();
  });

  test("legacy Mailery client env is rejected (never configures the client)", () => {
    process.env["HASNA_MAILERY_API_URL"] = "https://legacy-mailery.example";
    process.env["HASNA_MAILERY_API_KEY"] = "legacy-token";

    expect(() => resolveSelfHostedConfig()).toThrow(/HASNA_MAILERY_API_URL.*retired/);
    expect(() => selfHostedStoreFor("domains")).toThrow(/HASNA_MAILERY_API_URL.*retired/);
  });

  test("retained endpoint and credential aliases configure the API without a mode selector", () => {
    process.env["EMAILS_SELF_HOSTED_URL"] = "https://emails.example";
    process.env["EMAILS_SELF_HOSTED_API_KEY"] = "test-key";
    expect(resolveSelfHostedConfig().baseUrl).toBe("https://emails.example/v1");
    expect(resolveSelfHostedConfig().credential).toBe("test-key");
    expect(isSelfHostedMode()).toBe(true);
  });

  test("rejects the removed 'local' mode even when credentials are present", () => {
    process.env["EMAILS_MODE"] = "local";
    process.env["EMAILS_SELF_HOSTED_URL"] = "https://stale-emails.example";
    process.env["EMAILS_SELF_HOSTED_API_KEY"] = "stale-key";
    expect(() => resolveSelfHostedConfig()).toThrow(/EMAILS_MODE.*retired/);

    clearEnv();
    process.env["HASNA_EMAILS_MODE"] = "local";
    process.env["EMAILS_SELF_HOSTED_URL"] = "https://stale-emails.example";
    process.env["EMAILS_SELF_HOSTED_API_KEY"] = "stale-key";
    expect(() => resolveSelfHostedConfig()).toThrow(/HASNA_EMAILS_MODE.*retired/);
  });

  test("rejects removed mode aliases and non-loopback plaintext HTTP", () => {
    process.env["EMAILS_MODE"] = "cloud";
    expect(() => resolveSelfHostedConfig()).toThrow(/EMAILS_MODE.*retired/);
    delete process.env["EMAILS_MODE"];
    configureClient("http://192.0.2.1:8080");
    resetSelfHostedConfigCache();
    expect(() => resolveSelfHostedConfig()).toThrow("must be an HTTPS URL");
  });

  test("transport fails fast and never includes the API key", () => {
    configureClient("http://127.0.0.1:9", "test-secret-value");
    process.env["EMAILS_SELF_HOSTED_HTTP_CONNECT_TIMEOUT"] = "1";
    process.env["EMAILS_SELF_HOSTED_HTTP_TIMEOUT"] = "2";
    resetSelfHostedConfigCache();
    const store = selfHostedStoreFor("domains")!;
    let thrown: unknown;
    try {
      store.list({ limit: 1 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SelfHostedTransportError);
    expect(String(thrown)).not.toContain("test-secret-value");
  });

  test("curl bridge passes API key and request body through stdin config instead of temp files or argv", () => {
    configureClient("https://emails.example", "test-secret-value");
    process.env["EMAILS_CLIENT_ENV_SECRET"] = "hasna/test/opensource/emails/prod/client-env";
    process.env["DATABASE_URL"] = "postgres://database-url-must-not-pass";
    process.env["EMAILS_DATABASE_URL"] = "postgres://emails-database-url-must-not-pass";
    process.env["HASNA_EMAILS_DATABASE_URL"] = "postgres://hasna-emails-database-url-must-not-pass";
    process.env["EMAILS_API_SIGNING_KEY"] = "signing-key-must-not-pass";
    process.env["HASNA_MAILERY_API_SIGNING_KEY"] = "legacy-signing-key-must-not-pass";
    process.env["RESEND_API_KEY"] = "provider-key-must-not-pass";
    process.env["RESEND_WEBHOOK_SECRET"] = "provider-webhook-secret-must-not-pass";
    process.env["MAILERY_API_KEY"] = "legacy-provider-key-must-not-pass";
    process.env["HASNA_MAILERY_API_KEY"] = "legacy-hasna-provider-key-must-not-pass";
    process.env["AWS_ACCESS_KEY_ID"] = "aws-access-key-must-not-pass";
    process.env["AWS_SECRET_ACCESS_KEY"] = "aws-secret-key-must-not-pass";
    process.env["AWS_SESSION_TOKEN"] = "aws-session-token-must-not-pass";
    process.env["AWS_PROFILE"] = "aws-profile-must-not-pass";
    process.env["CLOUDFLARE_API_KEY"] = "dns-provider-key-must-not-pass";
    resetSelfHostedConfigCache();
    const capture = installFakeCurl();

    // Forbidden store/selector inputs must prevent dispatch altogether. Once
    // removed, unrelated provider credentials must still be stripped by curl.
    expect(() => selfHostedStoreFor("domains")).toThrow(/retired/);
    expect(existsSync(capture.argsPath)).toBe(false);
    for (const key of RETIRED_EMAILS_SELECTOR_SETTINGS) delete process.env[key];
    expect(() => selfHostedStoreFor("domains")).toThrow(/cannot configure an Emails client/);
    expect(existsSync(capture.argsPath)).toBe(false);
    for (const key of CLIENT_DATABASE_SETTINGS) delete process.env[key];

    const created = selfHostedStoreFor("domains")!.create({ domain: "example.com", note: "line\nbreak" });

    expect(created).toMatchObject({ id: "domain-1", domain: "example.com" });
    const args = readFileSync(capture.argsPath, "utf8");
    const stdin = readFileSync(capture.stdinPath, "utf8");
    const argv = args.split(/\r?\n/).filter(Boolean);
    expect(argv.slice(0, 3)).toEqual(["-q", "-K", "-"]);
    expect(args).not.toContain("test-secret-value");
    expect(args).not.toContain("emails-self-hosted");
    expect(stdin).toContain("Authorization: Bearer test-secret-value");
    expect(stdin).toContain("data-binary = ");
    expect(stdin).toContain("example.com");
    expect(stdin).not.toContain("body.json");
    expect(stdin).not.toContain("data-binary = \"@");

    const childEnvKeys = new Set(
      readFileSync(capture.envPath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.split("=", 1)[0]),
    );
    for (const key of [
      "HASNA_EMAILS_API_KEY",
      "EMAILS_SELF_HOSTED_API_KEY",
      "EMAILS_CLIENT_ENV_SECRET",
      "DATABASE_URL",
      "EMAILS_DATABASE_URL",
      "HASNA_EMAILS_DATABASE_URL",
      "EMAILS_API_SIGNING_KEY",
      "HASNA_MAILERY_API_SIGNING_KEY",
      "RESEND_API_KEY",
      "RESEND_WEBHOOK_SECRET",
      "MAILERY_API_KEY",
      "HASNA_MAILERY_API_KEY",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_PROFILE",
      "CLOUDFLARE_API_KEY",
    ]) {
      expect(childEnvKeys.has(key)).toBe(false);
    }
  });

  test.each(["environment", "vault"] as const)("requireCredential=false never sends an existing %s credential", (source) => {
    installFakeSecrets(
      `{"HASNA_EMAILS_API_URL":"https://emails.example","HASNA_EMAILS_API_KEY":"vault-api-key-marker","${EMAILS_SESSION_TOKEN_ENV}":"vault-session-marker"}`,
    );
    if (source === "environment") {
      configureClient("https://emails.example", "environment-api-key-marker");
      process.env[EMAILS_SESSION_TOKEN_ENV] = "environment-session-marker";
    }
    const capture = installFakeCurl({
      status: 200,
      body: JSON.stringify({
        status: "verification_required",
        email: "user@example.com",
        verification_required: true,
      }),
    });

    const result = selfHostedApiRequest(
      "POST",
      "/auth/signup",
      {
        email: "user@example.com",
        password: "correct horse battery staple",
        tenant_name: "Example",
      },
      { requireCredential: false },
    );

    expect(result.status).toBe(200);
    expect(process.env["HASNA_EMAILS_API_KEY"]).toBe(`${source}-api-key-marker`);
    expect(process.env[EMAILS_SESSION_TOKEN_ENV]).toBe(`${source}-session-marker`);
    const args = readFileSync(capture.argsPath, "utf8");
    const stdin = readFileSync(capture.stdinPath, "utf8");
    const childEnv = readFileSync(capture.envPath, "utf8");
    const transportInputs = `${args}\n${stdin}\n${childEnv}`;
    expect(args.split(/\r?\n/).filter(Boolean)).toEqual([
      "-q",
      "-K",
      "-",
      "-w",
      "%{http_code}",
    ]);
    expect(transportInputs).not.toContain("Authorization:");
    expect(transportInputs.toLowerCase()).not.toContain("x-api-key");
    for (const marker of [
      "environment-api-key-marker",
      "environment-session-marker",
      "vault-api-key-marker",
      "vault-session-marker",
    ]) {
      expect(transportInputs).not.toContain(marker);
    }
  });

  test("falls back to the API key after a selected session token needs reauthentication", () => {
    process.env["HASNA_EMAILS_API_URL"] = "https://emails.example";
    process.env[EMAILS_SESSION_TOKEN_ENV] = "session-token-placeholder";
    process.env[EMAILS_SELF_HOSTED_API_KEY_ENV] = "api-key-placeholder";
    const capture = installFakeCurlSessionFallback(
      {
        status: 401,
        body: JSON.stringify({ error: "session is invalid or expired", reason: "reauthenticate" }),
      },
      {
        status: 200,
        body: JSON.stringify({ domains: [] }),
      },
    );

    const rows = selfHostedStoreFor("domains").list();

    expect(rows).toEqual([]);
    expect(readFileSync(capture.callsPath, "utf8").trim().split(/\r?\n/)).toEqual(["1", "2"]);
    const first = readFileSync(capture.stdinForCall(1), "utf8");
    const second = readFileSync(capture.stdinForCall(2), "utf8");
    expect(first).toContain("session-token-placeholder");
    expect(first).not.toContain("api-key-placeholder");
    expect(second).toContain("api-key-placeholder");
    expect(second).not.toContain("session-token-placeholder");
  });

  test("does not fall back from a live session with insufficient scope", () => {
    process.env["HASNA_EMAILS_API_URL"] = "https://emails.example";
    process.env[EMAILS_SESSION_TOKEN_ENV] = "session-token-placeholder";
    process.env[EMAILS_SELF_HOSTED_API_KEY_ENV] = "api-key-placeholder";
    const capture = installFakeCurlSessionFallback(
      {
        status: 403,
        body: JSON.stringify({ error: "insufficient scope for this operation", reason: "insufficient_scope" }),
      },
      {
        status: 200,
        body: JSON.stringify({ domains: [] }),
      },
    );

    expect(() => selfHostedStoreFor("domains").list()).toThrow(SelfHostedHttpError);

    expect(readFileSync(capture.callsPath, "utf8").trim()).toBe("1");
    expect(readFileSync(capture.stdinForCall(1), "utf8")).toContain("session-token-placeholder");
  });

  test("root health probe validates a declared 200 response without exposing raw body text", () => {
    configureClient();
    const body = {
      status: "ok",
      version: "1.3.2",
      mode: "self_hosted",
      name: "emails",
      db: { ok: true, latencyMs: 2 },
    };
    const capture = installFakeCurl({ status: 200, body: JSON.stringify(body) });

    const result = selfHostedProbe("/health");

    expect(result).toEqual({ status: 200, json: body });
    expect(Object.keys(result).sort()).toEqual(["json", "status"]);
    const stdin = readFileSync(capture.stdinPath, "utf8");
    expect(stdin).toContain('url = "https://emails.example/health"');
    expect(stdin).not.toContain("/v1/health");
  });

  test("root readiness probe validates a declared 503 response and returns only its safe projection", () => {
    configureClient();
    installFakeCurl({
      status: 503,
      body: JSON.stringify({
        status: "not_ready",
        version: "1.3.2",
        mode: "self_hosted",
        db: { ok: false, latencyMs: 3 },
        pendingMigrations: ["0007_add_delivery_events"],
        migrationIssues: [],
      }),
    });

    const result = selfHostedProbe("/ready");

    expect(result).toEqual({ status: 503, json: undefined });
    expect(Object.keys(result).sort()).toEqual(["json", "status"]);
  });

  test("root probe rejects malformed JSON without leaking the response body", () => {
    configureClient();
    const body = '{"status":"response-secret-probe-marker"';
    installFakeCurl({ status: 200, body });

    let thrown: unknown;
    try {
      selfHostedProbe("/health");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SelfHostedWireResponseError);
    expect(String(thrown)).toContain("body is not valid JSON");
    expect(String(thrown)).not.toContain("response-secret-probe-marker");
    expect(String(thrown)).not.toContain(body);
  });

  test("root probe falls back to the API key after a selected session token needs reauthentication", () => {
    process.env["HASNA_EMAILS_API_URL"] = "https://emails.example";
    process.env[EMAILS_SESSION_TOKEN_ENV] = "session-token-placeholder";
    process.env[EMAILS_SELF_HOSTED_API_KEY_ENV] = "api-key-placeholder";
    const capture = installFakeCurlSessionFallback(
      {
        status: 401,
        body: JSON.stringify({ error: "session is invalid or expired", reason: "reauthenticate" }),
      },
      {
        status: 200,
        body: JSON.stringify({ status: "ok", version: "1.3.2", mode: "self_hosted", name: "emails", db: { ok: true, latencyMs: 2 } }),
      },
    );

    const result = selfHostedProbe("/health");

    expect(result.status).toBe(200);
    expect(readFileSync(capture.callsPath, "utf8").trim().split(/\r?\n/)).toEqual(["1", "2"]);
    const first = readFileSync(capture.stdinForCall(1), "utf8");
    const second = readFileSync(capture.stdinForCall(2), "utf8");
    expect(first).toContain("session-token-placeholder");
    expect(first).not.toContain("api-key-placeholder");
    expect(second).toContain("api-key-placeholder");
    expect(second).not.toContain("session-token-placeholder");
  });

  test("generic get and delete validate a declared 404 before returning absence", () => {
    configureClient();
    installFakeCurl({ status: 404, body: '{"error":"domain not found"}' });

    const store = selfHostedStoreFor("domains");
    expect(store.get("missing")).toBeNull();
    expect(store.del("missing")).toBe(false);
  });

  test("priority-sender-rules get and delete of a missing rule return absence, not a throw", () => {
    // Regression: the serve's 404 text used to diverge from the declared
    // contract ("priority sender rule not found" vs the generated
    // "priority-sender-rules not found"), so the strict 404-body validation
    // made the client THROW on a missing rule instead of returning null/false.
    configureClient();
    installFakeCurl({ status: 404, body: '{"error":"priority-sender-rules not found"}' });

    const store = selfHostedStoreFor("priority-sender-rules");
    expect(store.get("priority:address:missing@example.com")).toBeNull();
    expect(store.del("priority:address:missing@example.com")).toBe(false);
  });

  for (const [label, body] of [
    ["HTML", "<html>response-secret-html-marker</html>"],
    ["malformed JSON", '{"error":"response-secret-json-marker"'],
    ["the wrong envelope", '{"message":"response-secret-envelope-marker"}'],
  ] as const) {
    test(`generic get and delete reject a 404 with ${label} without leaking its body`, () => {
      configureClient();
      installFakeCurl({ status: 404, body });

      const store = selfHostedStoreFor("domains");
      for (const operation of [
        () => store.get("missing"),
        () => store.del("missing"),
      ]) {
        let thrown: unknown;
        try {
          operation();
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(SelfHostedWireResponseError);
        expect(String(thrown)).not.toContain("response-secret");
        expect(String(thrown)).not.toContain(body);
      }
    });
  }

  test("generic get and delete reject an undeclared 404 contract", () => {
    configureClient();
    installFakeCurl({ status: 404, body: '{"error":"response-secret-undeclared-marker"}' });

    const store = selfHostedStoreFor("not-a-resource");
    for (const operation of [
      () => store.get("missing"),
      () => store.del("missing"),
    ]) {
      let thrown: unknown;
      try {
        operation();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(SelfHostedWireResponseError);
      expect(String(thrown)).toContain("HTTP 404 is not declared");
      expect(String(thrown)).not.toContain("response-secret-undeclared-marker");
    }
  });
});

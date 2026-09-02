import { describe, expect, test } from "bun:test";
import { planEmailStore } from "./store-resolution.js";
import { resolveServerStorageBackend } from "./server/storage-backend.js";
import { resolveEmailsClientConfig } from "./lib/client-config.js";
import { resolveSelfHostedConfig } from "./db/self-hosted-store.js";
import { createTransport } from "./store-http/wire.js";
import { mkdtempSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// These are synthetic settings only. The suite performs no network request and
// must run with a private HOME/XDG root, before any live client is configured.
const client = {
  EMAILS_SELF_HOSTED_URL: "https://emails.example.test",
  EMAILS_SELF_HOSTED_API_KEY: "fixture-token",
};

describe("canonical Emails client boundary", () => {
  test.each([
    {},
    { EMAILS_SELF_HOSTED_URL: "" },
    { EMAILS_SELF_HOSTED_URL: "   " },
    { EMAILS_SELF_HOSTED_API_KEY: "fixture-token" },
    { EMAILS_DB_PATH: ":memory:" },
    { HASNA_EMAILS_DB_PATH: ":memory:" },
    { EMAILS_DATABASE_URL: "postgresql://fixture:fixture@invalid.example.test/emails" },
    { HASNA_EMAILS_DATABASE_URL: "postgresql://fixture:fixture@invalid.example.test/emails" },
  ])("refuses incomplete or database client configuration without local fallback: %j", (env) => {
    expect(() => planEmailStore(env)).toThrow();
  });

  test("a complete authenticated HTTPS configuration uses the API without a selector", () => {
    expect(planEmailStore(client).store).toBe("api");
  });

  test.each(["EMAILS_MODE", "HASNA_EMAILS_MODE", "EMAILS_STORAGE_MODE", "HASNA_EMAILS_STORAGE_MODE"])(
    "a retired %s selector cannot alter or silently accompany client routing",
    (key) => {
      for (const value of ["local", "self_hosted", "cloud", " "]) {
        expect(() => planEmailStore({ ...client, [key]: value })).toThrow();
      }
    },
  );

  test.each([
    "https://fixture:synthetic-regression-credential@emails.example.test",
    "https://emails.example.test?token=synthetic-regression-credential",
    "https://emails.example.test#synthetic-regression-credential",
  ])("refuses ambiguous endpoint credentials instead of silently stripping them", (url) => {
    expect(() => planEmailStore({ ...client, EMAILS_SELF_HOSTED_URL: url })).toThrow();
  });

  test.each(["EMAILS_DATABASE_URL", "HASNA_EMAILS_DATABASE_URL", "EMAILS_DB_PATH", "HASNA_EMAILS_DB_PATH"])(
    "a complete API client still refuses the forbidden database setting %s",
    (key) => {
      expect(() => planEmailStore({ ...client, [key]: "synthetic-database-setting" })).toThrow();
    },
  );
});

describe("canonical client aliases and credentials", () => {
  const canonical = { HASNA_EMAILS_API_URL: "https://emails.example.test/base/v1", HASNA_EMAILS_API_KEY: "synthetic-key-one" };
  test("canonical names and matching legacy endpoint aliases share one transport", () => {
    const config = resolveEmailsClientConfig({ ...canonical, EMAILS_SELF_HOSTED_URL: canonical.HASNA_EMAILS_API_URL });
    expect(config.baseUrl).toBe(canonical.HASNA_EMAILS_API_URL);
    expect(config.credential).toBe("synthetic-key-one");
    expect(config.credentialSetting).toBe("HASNA_EMAILS_API_KEY");
    expect(JSON.stringify(config)).not.toContain("synthetic-key-one");
    expect(JSON.stringify(planEmailStore(canonical))).not.toContain("synthetic-key-one");
  });
  test.each([
    { EMAILS_API_URL: "https://different.example.test" },
    { EMAILS_SELF_HOSTED_URL: " " },
    { EMAILS_API_KEY: "synthetic-key-two" },
    { EMAILS_SELF_HOSTED_API_KEY: "" },
    { EMAILS_SESSION_TOKEN: "malformed embedded space" },
  ])("rejects alias conflicts or malformed credentials", (extra) => {
    expect(() => resolveEmailsClientConfig({ ...canonical, ...extra })).toThrow();
  });
  test("session, IdP and API key authority order stays explicit", () => {
    const config = resolveEmailsClientConfig({ ...canonical, EMAILS_SESSION_TOKEN: "synthetic-session", EMAILS_IDP_TOKEN: "synthetic-idp" });
    expect(config.credentialSetting).toBe("EMAILS_SESSION_TOKEN");
    expect(config.credentialFallbacks.map((item) => item.setting)).toEqual(["EMAILS_IDP_TOKEN", "HASNA_EMAILS_API_KEY"]);
    expect(JSON.stringify(config)).not.toContain("synthetic-");
  });
  test("rotating the same credential setting cannot reuse a cached bearer", () => {
    const env = { ...canonical };
    expect(resolveSelfHostedConfig(env).credential).toBe("synthetic-key-one");
    env.HASNA_EMAILS_API_KEY = "synthetic-key-two";
    expect(resolveSelfHostedConfig(env).credential).toBe("synthetic-key-two");
  });
  test("direct async transport validates configuration before invoking fetch", () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return new Response("{}"); };
    expect(() => createTransport({ baseUrl: "http://invalid.example.test", credential: "synthetic-key", fetchImpl })).toThrow();
    expect(() => createTransport({ baseUrl: canonical.HASNA_EMAILS_API_URL, credential: "", fetchImpl })).toThrow();
    expect(calls).toBe(0);
  });
  test("async requests refuse redirects and do not reflect transport exceptions", async () => {
    const requests: unknown[] = [];
    const transport = createTransport({ ...{ baseUrl: canonical.HASNA_EMAILS_API_URL, credential: "synthetic-key" },
      fetchImpl: async (url, init) => {
        requests.push({ url, redirect: init?.redirect, auth: init?.headers?.Authorization });
        throw new Error("synthetic-private-transport-detail");
      },
    });
    await expect(transport.request("GET", "/messages")).rejects.toThrow("could not reach the Emails API.");
    expect(requests).toEqual([{ url: "https://emails.example.test/base/v1/messages", redirect: "error", auth: "Bearer synthetic-key" }]);
  });
});

describe("actual source entrypoints with no configured service", () => {
  test.each([
    ...["src/cli/index.tsx", "src/mcp/index.ts", "src/server/index.ts"].flatMap((entry) =>
      ["--help", "--version"].map((flag) => ({ args: [entry, flag] }))),
    ...["index", "storage", "inbound", "selfhost"].map((entry) => ({
      args: ["--eval", `await import("./src/${entry}.ts"); console.log("import-ok")`],
    })),
  ])("help, version and public imports create no home or XDG application state: %j", ({ args }) => {
    const root = mkdtempSync(join(tmpdir(), "emails-stateless-entrypoint-"));
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH, AWS_EC2_METADATA_DISABLED: "true", NO_COLOR: "1",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "bun-transpiler-cache"),
    };
    for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "TMPDIR"]) {
      env[key] = join(root, key);
      mkdirSync(env[key]!);
    }
    const child = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 15000 });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout.length).toBeGreaterThan(0);
    for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
      expect(readdirSync(env[key]!)).toEqual([]);
    }
  });

  test.each([
    ["src/cli/index.tsx", "inbox", "list", "--json"],
    ["src/mcp/index.ts", "--stdio"],
    ["src/server/index.ts"],
  ].map((args) => ({ args })))("refuses before creating client state or starting a service: %j", ({ args }) => {
    const root = mkdtempSync(join(tmpdir(), "emails-entrypoint-"));
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH, AWS_EC2_METADATA_DISABLED: "true", NO_COLOR: "1",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "bun-transpiler-cache"),
    };
    for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "TMPDIR"]) {
      env[key] = join(root, key);
      mkdirSync(env[key]!);
    }
    const child = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 15000 });
    expect(child.error).toBeUndefined();
    expect(child.status).not.toBe(0);
    expect(`${child.stdout}${child.stderr}`).toMatch(/HASNA_EMAILS_(API_URL|DATABASE_URL)/);
    for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
      expect(readdirSync(env[key]!)).toEqual([]);
    }
  });
});

describe("canonical Emails service boundary", () => {
  test.each([{}, { EMAILS_DATABASE_URL: "" }, { EMAILS_DATABASE_URL: "   " }])(
    "an absent PostgreSQL URL cannot select a SQLite dashboard",
    (env) => {
      expect(() => resolveServerStorageBackend(env)).toThrow();
    },
  );

  test("explicit server PostgreSQL remains the service backend", () => {
    expect(resolveServerStorageBackend({
      EMAILS_DATABASE_URL: "postgresql://fixture:fixture@invalid.example.test/emails",
    })).toBe("postgresql");
  });

  test.each(["sqlite:fixture.db", "https://invalid.example.test/emails", "not-a-database-url"])(
    "rejects non-PostgreSQL configuration before connection or listener startup",
    (url) => {
      expect(() => resolveServerStorageBackend({ EMAILS_DATABASE_URL: url })).toThrow();
    },
  );
});

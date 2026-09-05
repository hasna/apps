// The `emails alias` commands over the collapsed alias family.
//
// `src/db/aliases.ts` used to be a facade over two arm modules, and which one served a command
// depended on the process-wide deployment word. It is now one implementation over the store
// seam. Both variants now drive the REAL commands through authenticated `/v1` HTTP:
// the primary API-key setting and its documented alias. They carry the SAME synthetic
// bearer, not different production principal classes. SQLite backs only the explicit
// in-memory fixture service, never configured client storage.
//
// WHY THE COMMANDS HAD TO CHANGE AT ALL: every export on the seam is asynchronous, so each
// action handler now awaits. That is the shape of bug this suite exists to catch — an
// un-awaited promise is TRUTHY, so a missed `await` in the `resolve` handler would print a
// target for a recipient that has none, and the structured payload would carry a promise. The
// `resolve` cases below assert the payload exactly rather than merely that something printed.
//
// `src/test-support/v1-stub.ts` IS DELIBERATELY NOT USED any more. Its generic list handler
// ignores equality filters and it serves `/v1/openapi.json` only on request, and the real HTTP
// store validates every filter and every write column against that document — so a suite built
// on it cannot exercise the filter push-down or the write-column contract that this family now
// depends on. `src/test-support/v1-store-api.ts` translates HTTP into the same store seam
// instead, so a mis-mapped field fails rather than being handed back.
//
// THE SQLITE MIGRATION SEEDS A PROTECTED GLOBAL CATCH-ALL and the self-hosted schema does not.
// Here both variants reach one explicit SQLite fixture over HTTP, so the
// seeded row is present either way, and `alias list` calls `ensureDefaultCatchAll()` itself.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, type Database } from "../../db/database.js";
import { resetSelfHostedConfigCache } from "../../db/self-hosted-store.js";
import { createAlias, ensureDefaultCatchAll } from "../../db/aliases.js";
import { createSqliteEmailStore } from "../../store-sqlite/index.js";
import type { EmailStore } from "../../store/email-store.js";
import { startV1StoreApi, type V1StoreApi } from "../../test-support/v1-store-api.js";
import {
  API_BASE_URL_SETTING,
  API_CREDENTIAL_SETTINGS,
  API_SETTINGS_POINTER,
  DATABASE_PATH_SETTINGS,
} from "../../store-resolution.js";
import { EMAILS_API_KEY_ENV, EMAILS_API_KEY_SETTINGS, EMAILS_API_URL_SETTINGS,
  RETIRED_EMAILS_SELECTOR_SETTINGS } from "../../lib/client-settings.js";
import { registerAliasCommands } from "./alias.js";

let INHERITED_PROCESS_ENV: NodeJS.ProcessEnv;
let db: Database;
let api: V1StoreApi;
let root: string;
let stateRoots: string[];
let originalFetch: typeof fetch;
let observingFetch: typeof fetch;
let originalExit: typeof process.exit;
let originalError: typeof console.error;
let resourceAccesses: string[];
let commandOutputs: Array<{ data: unknown; out: string }>;
interface HttpObservation {
  method: string; path: string; query: Record<string, string>; authenticated: boolean;
  status: number; body: unknown;
}
let requests: HttpObservation[];
const KEY_VARIANTS = [EMAILS_API_KEY_ENV, "EMAILS_SELF_HOSTED_API_KEY"] as const;
const WRONG_KEY = "fixture-alias-wrong-key";
const PRIVATE_TARGET = "private-fixture-target@example.test";

function captureInheritedProcessEnv(): void {
  INHERITED_PROCESS_ENV = { ...process.env };
}

function restoreInheritedProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(INHERITED_PROCESS_ENV, key)) delete process.env[key];
  }
  Object.assign(process.env, INHERITED_PROCESS_ENV);
}

function clearStoreSettings(): void {
  for (const setting of [...EMAILS_API_URL_SETTINGS, API_SETTINGS_POINTER,
    ...API_CREDENTIAL_SETTINGS, ...RETIRED_EMAILS_SELECTOR_SETTINGS]) {
    delete process.env[setting];
  }
  for (const setting of DATABASE_PATH_SETTINGS) delete process.env[setting];
}

/** One HTTP transport; the setting spelling is the only variant. */
function configureApiStore(setting: (typeof KEY_VARIANTS)[number] = EMAILS_API_KEY_ENV): void {
  clearStoreSettings();
  process.env[API_BASE_URL_SETTING] = api.baseUrl;
  process.env[setting] = api.apiKey;
}

async function runAliasCommand(
  args: string[], register: typeof registerAliasCommands = registerAliasCommands,
): Promise<{ data: unknown; out: string }> {
  const program = new Command();
  program.exitOverride();
  let data: unknown;
  const out: string[] = [];
  const originalExit = process.exit;
  process.exit = ((code?: number) => { throw new Error(`process.exit:${code ?? 0}`); }) as typeof process.exit;
  try {
    register(program, (d, formatted) => {
      data = d;
      out.push(String(formatted ?? ""));
      commandOutputs.push({ data: d, out: String(formatted ?? "") });
    });
    await program.parseAsync(["node", "emails", ...args]);
    return { data, out: out.join("\n") };
  } finally {
    process.exit = originalExit;
  }
}

/** The store the FIXTURES are written through, always the local one. */
function fixtureStore(): EmailStore {
  return createSqliteEmailStore({ database: db, detail: "alias command fixture" });
}

beforeEach(() => {
  captureInheritedProcessEnv();
  originalFetch = globalThis.fetch;
  originalExit = process.exit;
  originalError = console.error;
  root = mkdtempSync(join(tmpdir(), "emails-alias-api-"));
  stateRoots = [];
  for (const [setting, name] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config",
    XDG_DATA_HOME: "data", XDG_STATE_HOME: "state", XDG_CACHE_HOME: "cache", HASNA_EMAILS_HOME: "app" })) {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    stateRoots.push(path);
    process.env[setting] = path;
  }
  for (const [setting, name] of Object.entries({ TMPDIR: "tmp", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "compiler" })) {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    process.env[setting] = path;
  }
  for (const setting of ["EMAILS_HOME", "HASNA_HOME", "HASNA_DATA_HOME", "CODEWITH_HOME"]) delete process.env[setting];
  clearStoreSettings();
  closeDatabase();
  db = getDatabase(":memory:");
  resourceAccesses = [];
  commandOutputs = [];
  requests = [];
  const store = fixtureStore();
  api = startV1StoreApi({ store: { ...store, aliases: { ...store.aliases,
    list(options) { resourceAccesses.push("list"); return store.aliases.list(options); },
    get(id) { resourceAccesses.push(`get:${id}`); return store.aliases.get(id); },
    create(input) { resourceAccesses.push("create"); return store.aliases.create(input); },
    update(id, patch) { resourceAccesses.push(`update:${id}`); return store.aliases.update(id, patch); },
    remove(id) { resourceAccesses.push(`remove:${id}`); return store.aliases.remove(id); },
  } } });
  // Observe real network/response objects without replacing the service or its rows.
  observingFetch = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== api.baseUrl) throw new Error("alias fixture attempted a non-fixture request");
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const response = await originalFetch(...args);
    requests.push({ method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      path: url.pathname, query: Object.fromEntries(url.searchParams),
      authenticated: headers.get("authorization") === `Bearer ${api.apiKey}`, status: response.status,
      body: typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null });
    return response;
  }) as typeof fetch;
  globalThis.fetch = observingFetch;
  configureApiStore();
  resetSelfHostedConfigCache();
});

afterEach(() => {
  try {
    for (const path of stateRoots) expect(readdirSync(path)).toEqual([]);
    for (const output of commandOutputs) {
      for (const value of [api.apiKey, WRONG_KEY, "fixture-inherited"]) {
        expect(JSON.stringify(output)).not.toContain(value);
      }
    }
    expect(process.exit).toBe(originalExit);
    expect(console.error).toBe(originalError);
    expect(globalThis.fetch).toBe(observingFetch);
  } finally {
    globalThis.fetch = originalFetch;
    process.exit = originalExit;
    console.error = originalError;
    try {
      api?.stop();
    } finally {
      try {
        closeDatabase();
      } finally {
        resetSelfHostedConfigCache();
        restoreInheritedProcessEnv();
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

const STORE_VARIANTS: ReadonlyArray<[string, () => void]> = KEY_VARIANTS.map(setting =>
  [`authenticated /v1 using ${setting}`, () => configureApiStore(setting)]);

async function storedAliases(): Promise<unknown[]> {
  const result = await fixtureStore().aliases.list({ limit: 500 });
  if (!result.ok) throw new Error("explicit alias fixture could not be read");
  return result.value;
}

async function expectCommandRefusal(args: string[]): Promise<string> {
  const savedError = console.error;
  const savedExit = process.exit;
  const errors: string[] = [];
  const beforeOutputs = commandOutputs.length;
  console.error = (...values: unknown[]) => { errors.push(values.map(String).join(" ")); };
  try {
    await expect(runAliasCommand(args)).rejects.toThrow("process.exit:1");
  } finally {
    console.error = savedError;
  }
  expect(process.exit).toBe(savedExit);
  expect(commandOutputs.slice(beforeOutputs)).toEqual([]);
  const diagnostic = errors.join("\n");
  for (const value of [api.apiKey, WRONG_KEY, PRIVATE_TARGET, "fixture-inherited"]) {
    expect(diagnostic).not.toContain(value);
  }
  return diagnostic;
}

async function expectConfigurationRefusal(setting: string): Promise<void> {
  const beforeRows = await storedAliases();
  const beforeRequests = api.requestCount();
  const beforeAccesses = [...resourceAccesses];
  expect(await expectCommandRefusal(["alias", "list"])).toContain(setting);
  expect(api.requestCount()).toBe(beforeRequests);
  expect(resourceAccesses).toEqual(beforeAccesses);
  expect(await storedAliases()).toEqual(beforeRows);
}

describe("alias commands", () => {
  it("restores process.exit when command registration exits unexpectedly", async () => {
    const originalExit = process.exit;
    await expect(runAliasCommand([], () => { process.exit(92); })).rejects.toThrow("process.exit:92");
    expect(process.exit).toBe(originalExit);
  });

  for (const [name, configure] of STORE_VARIANTS) {
    it(`paginates aliases for human and structured output, on the ${name}`, async () => {
      await ensureDefaultCatchAll(fixtureStore());
      await createAlias("b@x.com", "t@x.com", fixtureStore());
      await createAlias("a@x.com", "t@x.com", fixtureStore());
      await createAlias("a@y.com", "t@y.com", fixtureStore());
      configure();

      const result = await runAliasCommand(["alias", "list", "--limit", "2", "--offset", "1"]);
      const data = result.data as Array<{ local_part: string; domain: string }>;

      expect(data.map((alias) => `${alias.local_part}@${alias.domain}`)).toEqual(["a@x.com", "b@x.com"]);
      expect(result.out).toContain("a@x.com");
      expect(result.out).not.toContain("*@*");
    });

    it(`paginates domain-filtered aliases, on the ${name}`, async () => {
      for (const alias of ["c@x.com", "a@x.com", "b@x.com"]) {
        await createAlias(alias, "t@x.com", fixtureStore());
      }
      await createAlias("a@y.com", "t@y.com", fixtureStore());
      configure();

      const result = await runAliasCommand(["alias", "list", "--domain", "x.com", "--limit", "2", "--offset", "1"]);
      const data = result.data as Array<{ local_part: string; domain: string }>;

      expect(data.map((alias) => `${alias.local_part}@${alias.domain}`)).toEqual(["b@x.com", "c@x.com"]);
      expect(result.out).not.toContain("a@y.com");
    });

    it(`adds, resolves and removes an alias, on the ${name}`, async () => {
      configure();
      const created = await runAliasCommand(["alias", "add", "hello@acme.com", "ops@acme.com"]);
      const alias = created.data as { id: string; target_address: string };
      expect(alias.target_address).toBe("ops@acme.com");
      expect(alias.id).toBeTruthy();

      // THE MISSED-AWAIT DETECTOR. A promise is truthy, so an un-awaited resolution would take
      // the "found" branch and print an object; the structured payload is asserted exactly.
      const resolved = await runAliasCommand(["alias", "resolve", "hello@acme.com"]);
      expect(resolved.data).toEqual({ recipient: "hello@acme.com", target: "ops@acme.com" });
      expect(resolved.out).toContain("ops@acme.com");

      const missing = await runAliasCommand(["alias", "resolve", "nobody@nowhere.example"]);
      expect(missing.data).toEqual({ recipient: "nobody@nowhere.example", target: null });
      expect(missing.out).toContain("no alias");

      await runAliasCommand(["alias", "remove", alias.id]);
      const gone = await runAliasCommand(["alias", "resolve", "hello@acme.com"]);
      expect(gone.data).toEqual({ recipient: "hello@acme.com", target: null });
    });

    it(`sets a domain catch-all and the protected global one, on the ${name}`, async () => {
      configure();
      const catchAll = await runAliasCommand(["alias", "catch-all", "acme.com", "inbox@acme.com"]);
      expect(catchAll.data).toMatchObject({ domain: "acme.com", local_part: "*", target_address: "inbox@acme.com" });
      expect(catchAll.out).toContain("catch-all *@acme.com");

      const global = await runAliasCommand(["alias", "global", "inbox@hq.com"]);
      expect(global.data).toMatchObject({ domain: "*", local_part: "*", target_address: "inbox@hq.com" });

      // A recipient with no specific alias lands on the domain catch-all, and one on an unknown
      // domain lands on the global one.
      expect((await runAliasCommand(["alias", "resolve", "whoever@acme.com"])).data)
        .toEqual({ recipient: "whoever@acme.com", target: "inbox@acme.com" });
      expect((await runAliasCommand(["alias", "resolve", "whoever@other.example"])).data)
        .toEqual({ recipient: "whoever@other.example", target: "inbox@hq.com" });
    });
  }

  // Replaces the retired successful-local-transport witness, not a behavior case.
  // Both settings MUST reach authenticated HTTP and mutate the actual backing row.
  for (const setting of KEY_VARIANTS) {
    it(`persists and reports real HTTP mutations using ${setting}`, async () => {
      configureApiStore(setting);
      const created = await runAliasCommand(["alias", "add", "evidence@example.test", PRIVATE_TARGET]);
      const alias = created.data as { id: string; target_address: string };
      expect(alias.target_address).toBe(PRIVATE_TARGET);
      expect(created.out).toContain(PRIVATE_TARGET);
      expect(requests).toContainEqual(expect.objectContaining({ method: "POST", path: "/v1/aliases",
        status: 201, authenticated: true, body: { domain: "example.test", local_part: "evidence",
          target_address: PRIVATE_TARGET, protected: false } }));
      expect(resourceAccesses.filter(operation => operation === "create")).toHaveLength(1);
      expect((await storedAliases())).toContainEqual(expect.objectContaining({ id: alias.id, target_address: PRIVATE_TARGET }));
      const found = await runAliasCommand(["alias", "resolve", "evidence@example.test"]);
      expect(found.data).toEqual({ recipient: "evidence@example.test", target: PRIVATE_TARGET });
      await runAliasCommand(["alias", "remove", alias.id]);
      expect(resourceAccesses).toContain(`remove:${alias.id}`);
      expect(requests).toContainEqual(expect.objectContaining({ method: "DELETE", path: `/v1/aliases/${alias.id}`,
        status: 200, authenticated: true }));
      expect(await storedAliases()).not.toContainEqual(expect.objectContaining({ id: alias.id }));
      const empty = await runAliasCommand(["alias", "list", "--domain", "example.test"]);
      expect(empty.data).toEqual([]);
      expect(requests.filter(request => request.path !== "/v1/openapi.json").every(request => request.authenticated)).toBe(true);
      expect(requests.some(request => request.path === "/v1/openapi.json" && request.status === 200)).toBe(true);
    });

    it(`refuses real HTTP401 without leaking or mutating populated aliases using ${setting}`, async () => {
      await createAlias("private@example.test", PRIVATE_TARGET, fixtureStore());
      const beforeRows = await storedAliases();
      configureApiStore(setting);
      process.env[setting] = WRONG_KEY;
      for (const args of [["alias", "list"], ["alias", "add", "forbidden@example.test", "target@example.test"]]) {
        const before = requests.length;
        await expectCommandRefusal(args);
        const observed = requests.slice(before);
        expect(observed).toContainEqual(expect.objectContaining({ path: "/v1/aliases", status: 401, authenticated: false }));
        // Public contract reads are not authenticated resource access.
        expect(observed.filter(request => request.path === "/v1/openapi.json").every(request => request.status === 200)).toBe(true);
        expect(resourceAccesses).toEqual([]);
        expect(await storedAliases()).toEqual(beforeRows);
      }
    });
  }

  it("accepts matching documented URL and key aliases through real HTTP", async () => {
    for (const setting of EMAILS_API_URL_SETTINGS) process.env[setting] = ` ${api.baseUrl} `;
    for (const setting of EMAILS_API_KEY_SETTINGS) process.env[setting] = ` ${api.apiKey} `;
    const created = await runAliasCommand(["alias", "add", "matching@example.test", PRIVATE_TARGET]);
    expect(created.data).toMatchObject({ target_address: PRIVATE_TARGET });
    expect(await storedAliases()).toContainEqual(expect.objectContaining({ local_part: "matching", target_address: PRIVATE_TARGET }));
    expect(requests.some(request => request.method === "POST" && request.status === 201 && request.authenticated)).toBe(true);
  });

  for (const settings of [EMAILS_API_KEY_SETTINGS, EMAILS_API_URL_SETTINGS]) {
    for (const setting of settings) {
      for (const invalid of ["blank", "conflicting"] as const) {
        it(`rejects ${invalid} ${setting} before requests or alias access`, async () => {
          await createAlias("private@example.test", PRIVATE_TARGET, fixtureStore());
          const value = settings === EMAILS_API_KEY_SETTINGS ? api.apiKey : api.baseUrl;
          for (const key of settings) process.env[key] = value;
          process.env[setting] = invalid === "blank" ? " " : `${value}-conflict`;
          await expectConfigurationRefusal(setting);
        });
      }
    }
  }

  it("rejects missing credentials before requests or alias access", async () => {
    await createAlias("private@example.test", PRIVATE_TARGET, fixtureStore());
    for (const setting of API_CREDENTIAL_SETTINGS) delete process.env[setting];
    await expectConfigurationRefusal(EMAILS_API_KEY_ENV);
  });

  for (const setting of DATABASE_PATH_SETTINGS) {
    it(`rejects ${setting}, including blank, without local fallback or alias access`, async () => {
      await createAlias("private@example.test", PRIVATE_TARGET, fixtureStore());
      for (const value of [":memory:", ""]) {
        configureApiStore();
        process.env[setting] = value;
        await expectConfigurationRefusal(setting);
      }
    });
  }

  it("restores exit and output hooks after asynchronous action failure", async () => {
    const savedExit = process.exit;
    const failure = new Error("fixture asynchronous action failure");
    await expect(runAliasCommand(["throw-witness"], program => {
      program.command("throw-witness").action(async () => { await Promise.resolve(); throw failure; });
    })).rejects.toBe(failure);
    expect(process.exit).toBe(savedExit);
    await expect(runAliasCommand(["exit-witness"], program => {
      program.command("exit-witness").action(async () => { await Promise.resolve(); process.exit(87); });
    })).rejects.toThrow("process.exit:87");
    expect(process.exit).toBe(savedExit);
  });
});

// SELECTORS THE CLI PRINTS BUT REFUSES TO ACCEPT (task 55c19dde).
//
// Every list in this CLI displays 8-character id prefixes, and several verbs
// also accept human selectors (an address's email, a domain's name) — but the
// remove/revoke/mutate verbs of six families refused exactly those selectors:
//
//  * `alias remove <8-char id>` and `alias remove <alias address>` — not found;
//    only the full UUID worked, and the full UUID is only visible via --json.
//  * `sendkey revoke <8-char id>` — not found.
//  * `sequence step remove <8-char id>` — not found, and the full id was
//    UNOBTAINABLE: `step add` prints the short id and `step list --json`
//    emitted prose lines, so the command was unusable from the CLI.
//  * `domain remove <domain-name>` — not found, though every sibling domain
//    verb takes the name.
//  * `address remove|activate|quota <email>` — not found/could-not-resolve,
//    though sibling address verbs accept the email.
//
// A CLI that prints a handle must accept that handle back.
//
// Real CLI children use an authenticated loopback API backed by an explicit
// in-memory test adapter. No client database or provider delivery is selected.
// The single-key fixture is not evidence of production role or tenant isolation.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { closeDatabase, getDatabase } from "../../db/database.js";
import { createSqliteEmailStore } from "../../store-sqlite/index.js";
import { startV1StoreApi, type V1StoreApi } from "../../test-support/v1-store-api.js";
import { EMAILS_API_KEY_ENV, EMAILS_API_URL_ENV } from "../../lib/client-settings.js";

const APP_ROOT = resolve(import.meta.dir, "../../..");
const WRONG_KEY = "fixture-wrong-key";
let inheritedEnv: NodeJS.ProcessEnv;
let root: string;
let stateEnv: NodeJS.ProcessEnv;
let db: ReturnType<typeof getDatabase>;
let api: V1StoreApi;
let omitProviderTenant: boolean;
let providerCreates: number;
let providerGets: string[];
let providerLists: number;
const children = new Set<ReturnType<typeof Bun.spawn>>();

// The PG resources/OpenAPI include tenant_id; SQLite has no tenant column.
// Project only the synthetic API response, retaining each actual CLI-created ID.
// This fixture shape correction does not prove production tenant isolation.
function providerWireRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id, ...(omitProviderTenant ? {} : { tenant_id: "00000000-0000-4000-8000-000000000001" }),
    name: row.name, type: row.type, region: row.region ?? null, active: Boolean(row.active),
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

beforeEach(() => {
  inheritedEnv = { ...process.env };
  root = mkdtempSync(join(tmpdir(), "emails-selector-"));
  stateEnv = {};
  for (const [setting, name] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config",
    XDG_DATA_HOME: "data", XDG_STATE_HOME: "state", XDG_CACHE_HOME: "cache", HASNA_EMAILS_HOME: "app" })) {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    stateEnv[setting] = path;
  }
  for (const name of ["tmp", "transpiler"]) mkdirSync(join(root, name), { mode: 0o700 });
  closeDatabase();
  db = getDatabase(":memory:");
  omitProviderTenant = false;
  providerCreates = 0;
  providerGets = [];
  providerLists = 0;
  const store = createSqliteEmailStore({ database: db });
  api = startV1StoreApi({ store: { ...store, providers: { ...store.providers,
    async create(input) {
      providerCreates++;
      const result = await store.providers.create(input);
      return result.ok ? { ...result, value: providerWireRow(result.value) } : result;
    },
    async get(id) {
      providerGets.push(id);
      const result = await store.providers.get(id);
      return result.ok && result.value !== null ? { ...result, value: providerWireRow(result.value) } : result;
    },
    async list(options) {
      providerLists++;
      const result = await store.providers.list(options);
      return result.ok ? { ...result, value: result.value.map(providerWireRow) } : result;
    },
  } } });
});

afterEach(async () => {
  try {
    for (const path of Object.values(stateEnv)) expect(readdirSync(path!)).toEqual([]);
  } finally {
    for (const child of children) {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
    }
    children.clear();
    api?.stop();
    closeDatabase();
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(inheritedEnv, key)) delete process.env[key];
    Object.assign(process.env, inheritedEnv);
    rmSync(root, { recursive: true, force: true });
  }
  expect({ ...process.env }).toEqual(inheritedEnv);
});

function localEnv(): NodeJS.ProcessEnv {
  // Allowlist only: no inherited provider credentials, DB settings or pointers.
  return { ...stateEnv, PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    TMPDIR: join(root, "tmp"), BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "transpiler"),
    [EMAILS_API_URL_ENV]: api.baseUrl, [EMAILS_API_KEY_ENV]: api.apiKey,
    AWS_EC2_METADATA_DISABLED: "true", NO_COLOR: "1", TZ: "UTC",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
}

interface CliRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<CliRun> {
  const child = Bun.spawn({
    cmd: [process.execPath, "--no-env-file", "--no-install", join(APP_ROOT, "src/cli/index.tsx"), ...args],
    cwd: APP_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  children.add(child);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 30_000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect(timedOut, "CLI child exceeded the fixture transport deadline").toBe(false);
    for (const output of [stdout, stderr]) {
      for (const value of [api.apiKey, WRONG_KEY, "fixture-inherited"]) expect(output).not.toContain(value);
    }
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
    children.delete(child);
  }
}

function ok(run: CliRun, what: string): CliRun {
  expect(run.exitCode, `${what} failed: ${run.stderr}\n${run.stdout}`).toBe(0);
  return run;
}

function rows(run: CliRun, what: string): Array<Record<string, unknown>> {
  return JSON.parse(ok(run, what).stdout) as Array<Record<string, unknown>>;
}

async function seedProvider(env: NodeJS.ProcessEnv): Promise<string> {
  ok(await runCli(["--json", "provider", "add", "--name", "selector-sandbox", "--type", "sandbox"], env), "provider add");
  const providers = rows(await runCli(["--json", "provider", "list"], env), "provider list");
  const provider = providers.find((row) => row["name"] === "selector-sandbox");
  expect(provider, "seed provider missing").toBeDefined();
  return String((provider as Record<string, unknown>)["id"]);
}

describe("alias remove accepts what alias list prints", () => {
  // The list also carries the protected default catch-all row, so the cases
  // target the alias they created rather than "the only row".
  async function aliasRow(env: NodeJS.ProcessEnv, localPart: string): Promise<Record<string, unknown> | undefined> {
    return rows(await runCli(["--json", "alias", "list"], env), "alias list")
      .find((row) => row["local_part"] === localPart);
  }

  it("removes by 8-char id prefix", async () => {
    const env = localEnv();
    ok(await runCli(["alias", "add", "hello@acme.example", "ops@acme.example"], env), "alias add");
    const added = await aliasRow(env, "hello");
    expect(added, "the added alias is not in alias list").toBeDefined();
    const shortId = String(added?.["id"]).slice(0, 8);

    ok(await runCli(["alias", "remove", shortId], env), `alias remove ${shortId}`);
    expect(await aliasRow(env, "hello")).toBeUndefined();
  }, 120_000);

  it("removes by the alias address", async () => {
    const env = localEnv();
    ok(await runCli(["alias", "add", "hola@acme.example", "ops@acme.example"], env), "alias add");
    expect(await aliasRow(env, "hola"), "the added alias is not in alias list").toBeDefined();

    ok(await runCli(["alias", "remove", "hola@acme.example"], env), "alias remove by address");
    expect(await aliasRow(env, "hola")).toBeUndefined();
  }, 120_000);
});

describe("sendkey revoke accepts the short id sendkey list prints", () => {
  it("revokes by 8-char id prefix", async () => {
    const env = localEnv();
    ok(await runCli(["owner", "register", "robot", "--type", "agent"], env), "owner register");
    ok(await runCli(["sendkey", "create", "robot"], env), "sendkey create");
    const keys = rows(await runCli(["--json", "sendkey", "list"], env), "sendkey list");
    const shortId = String(keys[0]?.["id"]).slice(0, 8);

    ok(await runCli(["sendkey", "revoke", shortId], env), `sendkey revoke ${shortId}`);
    const after = rows(await runCli(["--json", "sendkey", "list"], env), "sendkey list after");
    expect(after[0]?.["revoked_at"], "the key must actually be revoked").toBeTruthy();
  }, 120_000);
});

describe("sequence step remove is usable from the CLI", () => {
  it("step list --json emits rows, and step remove accepts the printed short id", async () => {
    const env = localEnv();
    ok(await runCli(["template", "add", "step-tpl", "--subject", "s", "--text", "b"], env), "template add");
    ok(await runCli(["sequence", "create", "drip"], env), "sequence create");
    ok(await runCli(["sequence", "step", "add", "drip", "--step", "1", "--delay", "24", "--template", "step-tpl"], env), "step add");

    const steps = rows(await runCli(["--json", "sequence", "step", "list", "drip"], env), "step list");
    expect(steps).toHaveLength(1);
    const shortId = String(steps[0]?.["id"]).slice(0, 8);
    expect(shortId.length).toBe(8);

    ok(await runCli(["sequence", "step", "remove", shortId], env), `step remove ${shortId}`);
    expect(rows(await runCli(["--json", "sequence", "step", "list", "drip"], env), "step list after")).toHaveLength(0);
  }, 120_000);
});

describe("domain remove accepts the domain name like its sibling verbs", () => {
  it("removes by name", async () => {
    const env = localEnv();
    const providerId = await seedProvider(env);
    // --send-only ON PURPOSE: this test covers the remove-by-name selector, not
    // inbound provisioning. Default `domain add` now provisions the SES receipt
    // rule too (and refuses when it cannot) — covered in
    // domain.inbound-provisioning.test.ts.
    ok(await runCli(["domain", "add", "acme.example", "--provider", providerId, "--send-only"], env), "domain add");

    ok(await runCli(["domain", "remove", "acme.example", "--yes"], env), "domain remove by name");
    const after = await runCli(["--json", "domain", "list"], env);
    expect(ok(after, "domain list after").stdout).not.toContain("acme.example");
  }, 120_000);
});

describe("address verbs accept the email like their siblings", () => {
  async function seedAddress(env: NodeJS.ProcessEnv, providerId: string): Promise<void> {
    ok(await runCli(["address", "add", "sender@acme.example", "--provider", providerId], env), "address add");
  }

  it("address remove <email>", async () => {
    const env = localEnv();
    const providerId = await seedProvider(env);
    await seedAddress(env, providerId);

    ok(await runCli(["address", "remove", "sender@acme.example", "--yes"], env), "address remove by email");
    const after = await runCli(["--json", "address", "list"], env);
    expect(ok(after, "address list after").stdout).not.toContain("sender@acme.example");
  }, 120_000);

  it("address quota <email> and activate <email>", async () => {
    const env = localEnv();
    const providerId = await seedProvider(env);
    await seedAddress(env, providerId);

    const quota = ok(await runCli(["--json", "address", "quota", "sender@acme.example", "5"], env), "address quota by email");
    expect((JSON.parse(quota.stdout) as Record<string, unknown>)["daily_quota"]).toBe(5);

    const activated = ok(await runCli(["--json", "address", "activate", "sender@acme.example"], env), "address activate by email");
    expect((JSON.parse(activated.stdout) as Record<string, unknown>)["email"]).toBe("sender@acme.example");
  }, 120_000);

  // The complement: an ambiguous or unknown selector must refuse, not guess.
  it("refuses an unknown selector with a resolvable error", async () => {
    const env = localEnv();
    await seedProvider(env);

    const run = await runCli(["--json", "address", "remove", "nobody@acme.example", "--yes"], env);
    expect(run.exitCode).not.toBe(0);
    const failure = JSON.parse(run.stderr) as { error: { message: string } };
    expect(failure.error.message.toLowerCase()).toContain("not found");
  }, 120_000);
});

describe("selector fixture transport and mutation controls", () => {
  function persistedRows() {
    return {
      providers: db.query("SELECT id, name, type, region, active FROM providers ORDER BY id").all(),
      addresses: db.query("SELECT id, provider_id, email, status, daily_quota FROM addresses ORDER BY id").all(),
    };
  }

  async function populatedAddress(env: NodeJS.ProcessEnv) {
    const providerId = await seedProvider(env);
    ok(await runCli(["address", "add", "private-sender@acme.example", "--provider", providerId], env), "populated address add");
    const listed = rows(await runCli(["--json", "address", "list"], env), "populated address list");
    expect(listed).toHaveLength(1);
    return { providerId, addressId: String(listed[0]!.id) };
  }

  it("retains real provider identity and mutates only the selected populated address", async () => {
    const env = localEnv();
    const { providerId, addressId } = await populatedAddress(env);
    expect(providerCreates).toBe(1);
    expect(providerLists).toBeGreaterThan(0);
    expect(persistedRows().providers).toEqual([{ id: providerId, name: "selector-sandbox", type: "sandbox", region: null, active: 1 }]);
    ok(await runCli(["address", "add", "sibling@acme.example", "--provider", providerId], env), "sibling address add");
    const before = persistedRows();
    expect(before.addresses).toHaveLength(2);
    const requests = api.requestCount();
    const quota = ok(await runCli(["--json", "address", "quota", addressId, "7"], env), "full-ID quota");
    expect(JSON.parse(quota.stdout).daily_quota).toBe(7);
    expect(api.requestCount()).toBeGreaterThan(requests);
    expect(db.query("SELECT daily_quota FROM addresses WHERE id = ?").get(addressId)).toEqual({ daily_quota: 7 });
    const sibling = db.query("SELECT id, email, daily_quota FROM addresses WHERE email = ?").get("sibling@acme.example");
    ok(await runCli(["address", "remove", addressId, "--yes"], env), "full-ID removal");
    expect(db.query("SELECT id FROM addresses WHERE id = ?").get(addressId)).toBeNull();
    expect(db.query("SELECT id, email, daily_quota FROM addresses WHERE email = ?").get("sibling@acme.example")).toEqual(sibling);
    const after = ok(await runCli(["--json", "address", "list"], env), "remaining address list");
    expect(JSON.parse(after.stdout)).toHaveLength(1);
    expect(after.stdout).not.toContain("private-sender@acme.example");
    expect(persistedRows().providers).toEqual(before.providers);
  }, 120_000);

  for (const setting of ["wrong key", "missing key", "client database"] as const) {
    it(`refuses ${setting} without exposing or mutating populated rows`, async () => {
      const env = localEnv();
      const { addressId } = await populatedAddress(env);
      const before = persistedRows();
      const requests = api.requestCount();
      const invalid = { ...env };
      if (setting === "wrong key") invalid[EMAILS_API_KEY_ENV] = WRONG_KEY;
      if (setting === "missing key") delete invalid[EMAILS_API_KEY_ENV];
      if (setting === "client database") invalid.HASNA_EMAILS_DB_PATH = ":memory:";
      const run = await runCli(["--json", "address", "remove", addressId, "--yes"], invalid);
      expect(run.exitCode).not.toBe(0);
      expect(run.stdout).toBe("");
      expect(run.stderr).not.toContain("private-sender@acme.example");
      expect(run.stderr).not.toContain("selector-sandbox");
      expect(run.stderr).toMatch(setting === "wrong key" ? /401|authentication required/ : setting === "missing key" ? /API_KEY|credential/ : /HASNA_EMAILS_DB_PATH/);
      expect(persistedRows()).toEqual(before);
      if (setting === "wrong key") expect(api.requestCount()).toBeGreaterThan(requests);
      else expect(api.requestCount()).toBe(requests);
    }, 120_000);
  }

  it("refuses ambiguous and unknown selectors without guessing or changing populated rows", async () => {
    const env = localEnv();
    const providerId = await seedProvider(env);
    // The shared fixture omits provider_id on address create; its adapter chooses
    // the domain/active provider. Do not claim provider-binding parity here.
    // Seventeen genuine UUID rows guarantee a one-hex-prefix collision without
    // overwriting IDs or seeding completed operations. The CLI accepts any prefix.
    for (let index = 0; index < 17; index++) {
      ok(await runCli(["address", "add", `distinct-${index}@acme.example`, "--provider", providerId], env), "distinct address add");
    }
    const before = persistedRows();
    expect(before.addresses).toHaveLength(17);
    const addresses = rows(await runCli(["--json", "address", "list"], env), "complete ambiguity list");
    expect(addresses).toHaveLength(17);
    const ids = addresses.map(row => String(row.id));
    expect(new Set(ids).size).toBe(17);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const prefix = ids.map(id => id[0]!).find(value => ids.filter(id => id.startsWith(value)).length > 1)!;
    expect(prefix).toMatch(/^[0-9a-f]$/);
    for (const [selector, diagnostic] of [[prefix, "ambiguous"], ["absent@acme.example", "not found"]] as const) {
      const requests = api.requestCount();
      const run = await runCli(["--json", "address", "remove", selector, "--yes"], env);
      expect(run.exitCode).not.toBe(0);
      expect(run.stdout).toBe("");
      expect(JSON.parse(run.stderr).error.message.toLowerCase()).toContain(diagnostic);
      expect(api.requestCount()).toBeGreaterThan(requests);
      expect(persistedRows()).toEqual(before);
    }
  }, 120_000);

  it("rejects a successful provider response missing required tenant metadata", async () => {
    omitProviderTenant = true;
    const run = await runCli(["--json", "provider", "add", "--name", "malformed-wire", "--type", "sandbox"], localEnv());
    expect(run.exitCode).not.toBe(0);
    expect(run.stdout).toBe("");
    expect(JSON.parse(run.stderr).error.message).toContain("body.tenant_id is required");
    expect(providerCreates).toBe(1);
    // A malformed success response does NOT undo the genuine server-side write.
    // This negative control proves strict validation, not transaction rollback.
    expect(db.query("SELECT name FROM providers").all()).toEqual([{ name: "malformed-wire" }]);
  }, 120_000);
});

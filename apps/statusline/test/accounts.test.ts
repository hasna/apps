import { describe, expect, test, beforeEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sessionAccount,
  sessionAccountEmail,
  sessionAccountUuid,
  sessionConfigDir,
  sessionStateFile,
  sessionUsage,
} from "../src/accounts";

let home: string;

/** A fake accounts home: registry file plus managed profile dirs. */
function accountsHome(profiles: { name: string; tool: string; email?: string; dir?: string }[]) {
  const root = mkdtempSync(join(tmpdir(), "statusline-accounts-"));
  const entries = profiles.map((p) => {
    const dir = p.dir ?? join(root, "profiles", p.tool, p.name);
    mkdirSync(dir, { recursive: true });
    return { ...p, dir };
  });
  writeFileSync(join(root, "accounts.json"), JSON.stringify({ version: 1, profiles: entries }));
  return { root, entries };
}

function env(root: string, configDir: string) {
  return { ACCOUNTS_HOME: root, CLAUDE_CONFIG_DIR: configDir };
}

/** Write the agent's own account record into a config dir. */
function login(configDir: string, emailAddress: string, file = ".claude.json") {
  writeFileSync(join(configDir, file), JSON.stringify({ oauthAccount: { emailAddress } }));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "statusline-home-"));
});

describe("sessionConfigDir", () => {
  test("uses CLAUDE_CONFIG_DIR when set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-cfg-"));
    expect(sessionConfigDir({ CLAUDE_CONFIG_DIR: dir })).toBe(sessionConfigDir({ CLAUDE_CONFIG_DIR: dir }));
    expect(sessionConfigDir({ CLAUDE_CONFIG_DIR: dir })).toContain("statusline-cfg-");
  });

  test("falls back to the default config dir when unset", async () => {
    expect(sessionConfigDir({})).toContain(".claude");
  });

  test("ignores a blank CLAUDE_CONFIG_DIR", async () => {
    expect(sessionConfigDir({ CLAUDE_CONFIG_DIR: "   " })).toContain(".claude");
  });
});

describe("sessionAccount", () => {
  test("resolves the profile owning this session from the registry", async () => {
    const { root, entries } = accountsHome([
      { name: "account001", tool: "claude", email: "one@example.com" },
      { name: "account088", tool: "claude", email: "two@example.com" },
    ]);
    const account = await sessionAccount(env(root, entries[1]!.dir));
    expect(account.profile).toBe("account088");
    expect(account.tool).toBe("claude");
    expect(account.source).toBe("registry");
  });

  test("two config dirs resolve to their own profiles, not a shared pointer", async () => {
    const { root, entries } = accountsHome([
      { name: "account001", tool: "claude" },
      { name: "account088", tool: "claude" },
    ]);
    const first = await sessionAccount(env(root, entries[0]!.dir));
    const second = await sessionAccount(env(root, entries[1]!.dir));
    expect(first.profile).toBe("account001");
    expect(second.profile).toBe("account088");
  });

  test("falls back to the managed layout when the registry has no entry", async () => {
    const { root } = accountsHome([{ name: "account001", tool: "claude" }]);
    const unregistered = join(root, "profiles", "claude", "account042");
    mkdirSync(unregistered, { recursive: true });
    const account = await sessionAccount(env(root, unregistered));
    expect(account.profile).toBe("account042");
    expect(account.tool).toBe("claude");
    expect(account.source).toBe("layout");
  });

  test("does not name a profile for a config dir that does not exist", async () => {
    const { root } = accountsHome([{ name: "account001", tool: "claude" }]);
    const ghost = join(root, "profiles", "claude", "never-created");
    const account = await sessionAccount(env(root, ghost));
    expect(account.profile).toBeNull();
    expect(account.source).toBeNull();
  });

  test("does not guess for a dir outside the managed layout", async () => {
    const { root } = accountsHome([{ name: "account001", tool: "claude" }]);
    const outside = mkdtempSync(join(tmpdir(), "statusline-outside-"));
    const account = await sessionAccount(env(root, outside));
    expect(account.profile).toBeNull();
    expect(account.source).toBeNull();
  });

  test("matches a registry entry reached through a symlink", async () => {
    const { root, entries } = accountsHome([{ name: "account001", tool: "claude" }]);
    const link = join(mkdtempSync(join(tmpdir(), "statusline-link-")), "live");
    symlinkSync(entries[0]!.dir, link);
    expect((await sessionAccount(env(root, link))).profile).toBe("account001");
  });

  test("resolves a registry entry with a home-relative dir", async () => {
    const root = mkdtempSync(join(tmpdir(), "statusline-accounts-"));
    const dir = join(home, "custom-profile");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(root, "accounts.json"),
      JSON.stringify({ profiles: [{ name: "imported", tool: "claude", dir: "~/custom-profile" }] }),
    );
    expect((await sessionAccount({ ...env(root, dir), HOME: home })).profile).toBe("imported");
  });

  test("degrades to unresolved when the registry is missing", async () => {
    const missing = join(tmpdir(), `statusline-absent-${Date.now()}`);
    const account = await sessionAccount({ ACCOUNTS_HOME: missing, CLAUDE_CONFIG_DIR: home });
    expect(account.profile).toBeNull();
    expect(account.configDir).toContain("statusline-home-");
  });

  test("degrades to unresolved when the registry is corrupt", async () => {
    const root = mkdtempSync(join(tmpdir(), "statusline-accounts-"));
    writeFileSync(join(root, "accounts.json"), "{not json");
    expect((await sessionAccount(env(root, home))).profile).toBeNull();
  });

  test("ignores registry entries missing a name or dir", async () => {
    const root = mkdtempSync(join(tmpdir(), "statusline-accounts-"));
    writeFileSync(
      join(root, "accounts.json"),
      JSON.stringify({ profiles: [{ tool: "claude", dir: home }, { name: "nodir", tool: "claude" }] }),
    );
    expect((await sessionAccount(env(root, home))).profile).toBeNull();
  });
});

/** Simulate `accounts switch-account`: the dir's live auth now carries another account. */
function switchTo(configDir: string, profile: string | null, email: string | null) {
  const authDir = join(configDir, ".accounts-auth");
  mkdirSync(authDir, { recursive: true });
  writeFileSync(
    join(authDir, "switched-account.json"),
    JSON.stringify({ profile, email, switchedAt: new Date().toISOString() }),
  );
}

describe("sessionAccount after an in-place switch-account", () => {
  test("shows the occupant, not the dir owner — and flips when the switch lands", async () => {
    const { root, entries } = accountsHome([
      { name: "account088", tool: "claude", email: "owner@example.com" },
      { name: "account033", tool: "claude", email: "occupant@example.com" },
    ]);
    const dir = entries[0]!.dir;
    // positive control: before the switch this same input resolves to the owner
    expect((await sessionAccount(env(root, dir))).profile).toBe("account088");
    switchTo(dir, "account033", "occupant@example.com");
    const after = await sessionAccount(env(root, dir));
    expect(after.profile).toBe("account033");
    expect(after.source).toBe("switched");
  });

  test("the occupant also wins over the layout name for an unregistered dir", async () => {
    const { root } = accountsHome([{ name: "account001", tool: "claude" }]);
    const unregistered = join(root, "profiles", "claude", "account042");
    mkdirSync(unregistered, { recursive: true });
    switchTo(unregistered, "account007", "occupant@example.com");
    const account = await sessionAccount(env(root, unregistered));
    expect(account.profile).toBe("account007");
    expect(account.source).toBe("switched");
  });

  test("a nameless occupant yields no profile rather than the stale owner name", async () => {
    const { root, entries } = accountsHome([{ name: "account088", tool: "claude" }]);
    switchTo(entries[0]!.dir, null, "occupant@example.com");
    const account = await sessionAccount(env(root, entries[0]!.dir));
    expect(account.profile).toBeNull();
    expect(account.source).toBe("switched");
  });

  test("clearing the marker restores the owner, so a switch back is visible too", async () => {
    const { root, entries } = accountsHome([{ name: "account088", tool: "claude" }]);
    const dir = entries[0]!.dir;
    switchTo(dir, "account033", "occupant@example.com");
    expect((await sessionAccount(env(root, dir))).profile).toBe("account033");
    rmSync(join(dir, ".accounts-auth", "switched-account.json"));
    const restored = await sessionAccount(env(root, dir));
    expect(restored.profile).toBe("account088");
    expect(restored.source).toBe("registry");
  });

  test("a corrupt marker degrades to the owner instead of failing", async () => {
    const { root, entries } = accountsHome([{ name: "account088", tool: "claude" }]);
    const dir = entries[0]!.dir;
    mkdirSync(join(dir, ".accounts-auth"), { recursive: true });
    writeFileSync(join(dir, ".accounts-auth", "switched-account.json"), "{not json");
    expect((await sessionAccount(env(root, dir))).profile).toBe("account088");
  });

  test("two dirs render different occupants simultaneously", async () => {
    const { root, entries } = accountsHome([
      { name: "account001", tool: "claude" },
      { name: "account088", tool: "claude" },
    ]);
    switchTo(entries[0]!.dir, "account010", "ten@example.com");
    switchTo(entries[1]!.dir, "account033", "occupant@example.com");
    expect((await sessionAccount(env(root, entries[0]!.dir))).profile).toBe("account010");
    expect((await sessionAccount(env(root, entries[1]!.dir))).profile).toBe("account033");
  });
});

describe("sessionAccount ignores a STALE in-place switch marker (bug 2089be70)", () => {
  // The marker is left behind by a past in-place switch that has since been
  // undone: the dir's live login is its own owner again, but accounts did not
  // clear the marker. The dir's live oauthAccount is authoritative about who is
  // logged in now, so a marker it contradicts must not mask the real identity.
  test("a stale marker is ignored when the dir's live login is its own owner", async () => {
    const { root, entries } = accountsHome([{ name: "account088", tool: "claude", email: "owner@example.com" }]);
    const dir = entries[0]!.dir;
    login(dir, "owner@example.com"); // live login == the dir's own owner
    switchTo(dir, "account039", "jeannie@example.com"); // stale: names a different account
    const account = await sessionAccount(env(root, dir));
    expect(account.profile).toBe("account088");
    expect(account.source).toBe("registry");
  });

  // The measured incident: two panes, each with a live login as its own owner,
  // both carrying a stale marker pointing at the same third profile. Each pane
  // must show its own identity, never the shared stale pointer.
  test("two dirs with the same stale marker each resolve to their own owner", async () => {
    const { root, entries } = accountsHome([
      { name: "account005", tool: "claude", email: "andrei@example.com" },
      { name: "account038", tool: "claude", email: "matt@example.com" },
    ]);
    login(entries[0]!.dir, "andrei@example.com");
    login(entries[1]!.dir, "matt@example.com");
    switchTo(entries[0]!.dir, "account039", "jeannie@example.com");
    switchTo(entries[1]!.dir, "account039", "jeannie@example.com");
    const first = await sessionAccount(env(root, entries[0]!.dir));
    const second = await sessionAccount(env(root, entries[1]!.dir));
    expect(first.profile).toBe("account005");
    expect(second.profile).toBe("account038");
  });

  // The guard must still let a genuine, current in-place switch through — the
  // dir's live login matches the occupant the marker names. Proving the guard
  // can PASS as well as fail keeps it from being a blanket "ignore all markers".
  test("a current switch is still honored when the live login matches the marker", async () => {
    const { root, entries } = accountsHome([{ name: "account088", tool: "claude", email: "owner@example.com" }]);
    const dir = entries[0]!.dir;
    login(dir, "occupant@example.com"); // live login == the occupant the marker names
    switchTo(dir, "account033", "occupant@example.com");
    const account = await sessionAccount(env(root, dir));
    expect(account.profile).toBe("account033");
    expect(account.source).toBe("switched");
  });
});

describe("sessionAccountEmail", () => {
  test("prefers the agent's own record over the registry copy", async () => {
    const { root, entries } = accountsHome([{ name: "account006", tool: "claude", email: "stale@example.com" }]);
    login(entries[0]!.dir, "live@example.com");
    expect(await sessionAccountEmail(env(root, entries[0]!.dir))).toBe("live@example.com");
  });

  test("after a switch, the occupant's email beats the owner's registry copy", async () => {
    const { root, entries } = accountsHome([{ name: "account088", tool: "claude", email: "owner@example.com" }]);
    switchTo(entries[0]!.dir, "account033", "occupant@example.com");
    expect(await sessionAccountEmail(env(root, entries[0]!.dir))).toBe("occupant@example.com");
  });

  test("the agent's own record still wins over the switch marker", async () => {
    // the live state file is what the session actually authenticates as
    const { root, entries } = accountsHome([{ name: "account088", tool: "claude", email: "owner@example.com" }]);
    login(entries[0]!.dir, "live@example.com");
    switchTo(entries[0]!.dir, "account033", "marker@example.com");
    expect(await sessionAccountEmail(env(root, entries[0]!.dir))).toBe("live@example.com");
  });

  test("falls back to the registry when the agent has no record", async () => {
    const { root, entries } = accountsHome([{ name: "account006", tool: "claude", email: "registry@example.com" }]);
    expect(await sessionAccountEmail(env(root, entries[0]!.dir))).toBe("registry@example.com");
  });

  test("null when neither source knows", async () => {
    const { root } = accountsHome([{ name: "account006", tool: "claude" }]);
    expect(await sessionAccountEmail(env(root, home))).toBeNull();
  });

  test("null when the agent record is corrupt", async () => {
    const { root, entries } = accountsHome([{ name: "account006", tool: "claude" }]);
    writeFileSync(join(entries[0]!.dir, ".claude.json"), "{broken");
    expect(await sessionAccountEmail(env(root, entries[0]!.dir))).toBeNull();
  });
});

describe("sessionStateFile", () => {
  test("reads the record inside the isolated config dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-state-"));
    login(dir, "iso@example.com");
    expect(sessionStateFile({ CLAUDE_CONFIG_DIR: dir })).toBe(join(dir, ".claude.json"));
  });

  test("without CLAUDE_CONFIG_DIR the record is a sibling of the config dir, not inside it", () => {
    // the host writes ~/.claude.json, NOT ~/.claude/.claude.json
    const h = mkdtempSync(join(tmpdir(), "statusline-home-"));
    mkdirSync(join(h, ".claude"), { recursive: true });
    login(h, "home@example.com");
    login(join(h, ".claude"), "wrong@example.com");
    expect(sessionStateFile({ HOME: h })).toBe(join(h, ".claude.json"));
    expect(sessionAccountEmail({ HOME: h, ACCOUNTS_HOME: join(h, "none") })).resolves.toBe("home@example.com");
  });

  test("a .config.json in the dir takes precedence", () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-state-"));
    login(dir, "claude-json@example.com");
    login(dir, "config-json@example.com", ".config.json");
    expect(sessionStateFile({ CLAUDE_CONFIG_DIR: dir })).toBe(join(dir, ".config.json"));
  });

  test("finds a non-production oauth variant", () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-state-"));
    login(dir, "staging@example.com", ".claude-staging-oauth.json");
    expect(sessionStateFile({ CLAUDE_CONFIG_DIR: dir })).toBe(join(dir, ".claude-staging-oauth.json"));
  });

  test("null when the dir holds no record", () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-state-"));
    expect(sessionStateFile({ CLAUDE_CONFIG_DIR: dir })).toBeNull();
  });
});

describe("config dirs claimed by more than one tool", () => {
  test("picks the entry belonging to the tool being rendered", async () => {
    const root = mkdtempSync(join(tmpdir(), "statusline-accounts-"));
    const dir = join(root, "profiles", "claude", "shared");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(root, "accounts.json"),
      JSON.stringify({
        profiles: [
          { name: "cw-entry", tool: "codewith", dir },
          { name: "claude-entry", tool: "claude", dir },
        ],
      }),
    );
    const account = await sessionAccount(env(root, dir), "claude");
    expect(account.profile).toBe("claude-entry");
    expect(account.tool).toBe("claude");
  });

  test("never adopts another tool's entry, falling back to the layout", async () => {
    const root = mkdtempSync(join(tmpdir(), "statusline-accounts-"));
    const dir = join(root, "profiles", "claude", "account042");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(root, "accounts.json"),
      JSON.stringify({ profiles: [{ name: "cw-only", tool: "codewith", dir }] }),
    );
    const account = await sessionAccount(env(root, dir), "claude");
    expect(account.profile).toBe("account042");
    expect(account.source).toBe("layout");
  });

  test("an entry that claims no tool is still usable", async () => {
    const root = mkdtempSync(join(tmpdir(), "statusline-accounts-"));
    const dir = mkdtempSync(join(tmpdir(), "statusline-untyped-"));
    writeFileSync(join(root, "accounts.json"), JSON.stringify({ profiles: [{ name: "untyped", dir }] }));
    expect((await sessionAccount(env(root, dir), "claude")).profile).toBe("untyped");
  });
});

/** Write a usage-warmer cache entry for an account uuid under an accounts home. */
function writeUsageCache(
  root: string,
  uuid: string,
  windows: unknown[],
  opts: { fetchedAt?: string; headroom?: number; bindingWindow?: string } = {},
) {
  const dir = join(root, "cache", "usage");
  mkdirSync(dir, { recursive: true });
  const fetchedAt = opts.fetchedAt ?? new Date().toISOString();
  writeFileSync(
    join(dir, `${uuid}.json`),
    JSON.stringify({
      accountUuid: uuid,
      fetchedAt,
      usage: { windows, headroom: opts.headroom ?? 0, bindingWindow: opts.bindingWindow ?? "weekly_all", fetchedAt },
    }),
  );
}

/** Log the config dir in as an account carrying a uuid, the way the live agent records it. */
function loginUuid(configDir: string, uuid: string | null, email = "agent@example.com") {
  const oauthAccount: Record<string, unknown> = { emailAddress: email };
  if (uuid !== null) oauthAccount.accountUuid = uuid;
  writeFileSync(join(configDir, ".claude.json"), JSON.stringify({ oauthAccount }));
}

const UUID = "3ea5952d-28c7-4179-9371-5028123478a4";
const futureIso = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

describe("sessionAccountUuid", () => {
  test("reads the live account uuid the agent recorded for this config dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-uuid-"));
    loginUuid(dir, UUID);
    expect(sessionAccountUuid({ CLAUDE_CONFIG_DIR: dir })).toBe(UUID);
  });

  test("null when the config dir has no account record", () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-uuid-"));
    expect(sessionAccountUuid({ CLAUDE_CONFIG_DIR: dir })).toBeNull();
  });

  test("null when the record carries no uuid", () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-uuid-"));
    loginUuid(dir, null);
    expect(sessionAccountUuid({ CLAUDE_CONFIG_DIR: dir })).toBeNull();
  });

  test("rejects a uuid that is not a safe cache key", () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-uuid-"));
    loginUuid(dir, "../../etc/passwd");
    expect(sessionAccountUuid({ CLAUDE_CONFIG_DIR: dir })).toBeNull();
  });
});

describe("sessionUsage", () => {
  function fixtureEnv() {
    const root = mkdtempSync(join(tmpdir(), "statusline-usage-"));
    const dir = mkdtempSync(join(tmpdir(), "statusline-usage-cfg-"));
    loginUuid(dir, UUID);
    return { root, dir, env: { ACCOUNTS_HOME: root, CLAUDE_CONFIG_DIR: dir } };
  }

  test("reports session and weekly headroom as percent remaining for the pane's account", () => {
    const { root, env } = fixtureEnv();
    writeUsageCache(root, UUID, [
      { id: "session", group: "session", scoped: false, utilization: 13, resetsAt: futureIso() },
      { id: "weekly_all", group: "weekly", scoped: false, utilization: 8, resetsAt: futureIso() },
      { id: "weekly_scoped", group: "weekly", scoped: true, utilization: 90, resetsAt: futureIso() },
    ]);
    const usage = sessionUsage(env);
    expect(usage.sessionHeadroom).toBe(87);
    expect(usage.weeklyHeadroom).toBe(92); // the scoped weekly window is ignored, exactly as accounts does
  });

  test("a used-up window reads zero remaining rather than dropping out", () => {
    const { root, env } = fixtureEnv();
    writeUsageCache(root, UUID, [
      { id: "session", group: "session", scoped: false, utilization: 100, resetsAt: futureIso() },
      { id: "weekly_all", group: "weekly", scoped: false, utilization: 0, resetsAt: futureIso() },
    ]);
    const usage = sessionUsage(env);
    expect(usage.sessionHeadroom).toBe(0);
    expect(usage.weeklyHeadroom).toBe(100);
  });

  test("a window past its reset reads as fully replenished, never a stale high utilization", () => {
    const { root, env } = fixtureEnv();
    const fetchedAt = new Date(Date.now() - 60 * 1000).toISOString();
    writeUsageCache(
      root,
      UUID,
      [
        { id: "session", group: "session", scoped: false, utilization: 95, resetsAt: new Date(Date.now() - 30 * 1000).toISOString() },
        { id: "weekly_all", group: "weekly", scoped: false, utilization: 20, resetsAt: futureIso() },
      ],
      { fetchedAt },
    );
    expect(sessionUsage(env).sessionHeadroom).toBe(100);
  });

  test("no cache for this account yields no numbers, so the segment can show a neutral marker", () => {
    const { env } = fixtureEnv(); // account home exists but no cache file was written
    const usage = sessionUsage(env);
    expect(usage.sessionHeadroom).toBeNull();
    expect(usage.weeklyHeadroom).toBeNull();
  });

  test("stale cache is refused — with a positive control proving the same data reads fresh", () => {
    const { root, env } = fixtureEnv();
    const windows = [
      { id: "session", group: "session", scoped: false, utilization: 13, resetsAt: futureIso() },
      { id: "weekly_all", group: "weekly", scoped: false, utilization: 8, resetsAt: futureIso() },
    ];
    // fresh: reads
    writeUsageCache(root, UUID, windows);
    expect(sessionUsage(env).sessionHeadroom).toBe(87);
    // stale: same windows, an hour old -> refused
    writeUsageCache(root, UUID, windows, { fetchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    const usage = sessionUsage(env);
    expect(usage.sessionHeadroom).toBeNull();
    expect(usage.weeklyHeadroom).toBeNull();
  });

  test("an error entry (provider rate-limited) reads as no numbers, never a stale one", () => {
    // Observed live: when the usage endpoint 429s the warmer overwrites the
    // entry with { accountUuid, fetchedAt, error } and no `usage` field.
    const { root, env } = fixtureEnv();
    const dir = join(root, "cache", "usage");
    mkdirSync(dir, { recursive: true });
    const fetchedAt = new Date().toISOString();
    writeFileSync(
      join(dir, `${UUID}.json`),
      JSON.stringify({ accountUuid: UUID, fetchedAt, error: { kind: "http", status: 429 } }),
    );
    const usage = sessionUsage(env);
    expect(usage.sessionHeadroom).toBeNull();
    expect(usage.weeklyHeadroom).toBeNull();
  });

  test("a corrupt cache file degrades to no numbers rather than crashing", () => {
    const { root, env } = fixtureEnv();
    const dir = join(root, "cache", "usage");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${UUID}.json`), "{not json");
    expect(sessionUsage(env).sessionHeadroom).toBeNull();
  });

  test("a cache entry keyed to a different account is not used for this one", () => {
    const { root, env } = fixtureEnv();
    // file lives at UUID.json but its body claims another account -> reject
    const dir = join(root, "cache", "usage");
    mkdirSync(dir, { recursive: true });
    const fetchedAt = new Date().toISOString();
    writeFileSync(
      join(dir, `${UUID}.json`),
      JSON.stringify({
        accountUuid: "11111111-2222-3333-4444-555555555555",
        fetchedAt,
        usage: { windows: [{ id: "session", group: "session", scoped: false, utilization: 5 }], fetchedAt },
      }),
    );
    expect(sessionUsage(env).sessionHeadroom).toBeNull();
  });

  test("no numbers when the pane's config dir carries no account uuid", () => {
    const root = mkdtempSync(join(tmpdir(), "statusline-usage-"));
    const dir = mkdtempSync(join(tmpdir(), "statusline-usage-cfg-"));
    loginUuid(dir, null);
    writeUsageCache(root, UUID, [{ id: "session", group: "session", scoped: false, utilization: 5 }]);
    const usage = sessionUsage({ ACCOUNTS_HOME: root, CLAUDE_CONFIG_DIR: dir });
    expect(usage.sessionHeadroom).toBeNull();
    expect(usage.weeklyHeadroom).toBeNull();
  });
});

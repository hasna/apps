import { describe, expect, test, beforeEach } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionAccount, sessionAccountEmail, sessionConfigDir, sessionStateFile } from "../src/accounts";

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

describe("sessionAccountEmail", () => {
  test("prefers the agent's own record over the registry copy", async () => {
    const { root, entries } = accountsHome([{ name: "account006", tool: "claude", email: "stale@example.com" }]);
    login(entries[0]!.dir, "live@example.com");
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

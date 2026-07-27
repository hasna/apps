import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import {
  resolveIdentity,
  requireIdentity,
  getAutoName,
  isSelfRename,
  readPersistedIdentity,
  updateCachedAutoName,
  _resetAutoName,
} from "./identity";
import { AGENT_NAMES } from "./names";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { getDataDir } from "./db";

/**
 * These tests unlink and rewrite the identity file. They used to do that to the
 * path derived from the developer's REAL $HOME — so running `bun test` clobbered
 * the machine's actual identity (and, if an operator had pinned the file
 * read-only, failed with EACCES). That is the very failure mode this module was
 * fixed for, so the suite now runs against a throwaway HOME.
 */
const savedEnv = process.env.CONVERSATIONS_AGENT_ID;
let savedHome: string | undefined;
let savedUserProfile: string | undefined;
let tempHome: string;

function agentIdFile(): string {
  return join(getDataDir(), "agent-id");
}

beforeEach(() => {
  savedHome = process.env.HOME;
  savedUserProfile = process.env.USERPROFILE;
  tempHome = mkdtempSync(join(tmpdir(), "conversations-identity-test-"));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  _resetAutoName();
});

afterEach(() => {
  // Restore env
  if (savedEnv !== undefined) {
    process.env.CONVERSATIONS_AGENT_ID = savedEnv;
  } else {
    delete process.env.CONVERSATIONS_AGENT_ID;
  }

  if (savedHome !== undefined) process.env.HOME = savedHome;
  else delete process.env.HOME;
  if (savedUserProfile !== undefined) process.env.USERPROFILE = savedUserProfile;
  else delete process.env.USERPROFILE;

  try { rmSync(tempHome, { recursive: true, force: true }); } catch {}
  _resetAutoName();
});

describe("resolveIdentity", () => {
  test("returns explicit value when provided", () => {
    expect(resolveIdentity("alice")).toBe("alice");
  });

  test("returns env var when no explicit value", () => {
    process.env.CONVERSATIONS_AGENT_ID = "env-agent";
    expect(resolveIdentity()).toBe("env-agent");
  });

  test("explicit takes priority over env", () => {
    process.env.CONVERSATIONS_AGENT_ID = "env-agent";
    expect(resolveIdentity("explicit")).toBe("explicit");
  });

  test("falls back to auto-generated name when nothing set", () => {
    delete process.env.CONVERSATIONS_AGENT_ID;
    // Remove the persisted file so a fresh name is generated
    try { unlinkSync(agentIdFile()); } catch {}
    _resetAutoName();
    const name = resolveIdentity();
    expect(name).not.toBe("user");
    expect(AGENT_NAMES).toContain(name as any);
  });

  test("auto-generated name is consistent across calls", () => {
    delete process.env.CONVERSATIONS_AGENT_ID;
    try { unlinkSync(agentIdFile()); } catch {}
    _resetAutoName();
    const name1 = resolveIdentity();
    const name2 = resolveIdentity();
    expect(name1).toBe(name2);
  });
});

describe("getAutoName", () => {
  test("returns a name from the pool", () => {
    try { unlinkSync(agentIdFile()); } catch {}
    _resetAutoName();
    const name = getAutoName();
    expect(AGENT_NAMES).toContain(name as any);
  });

  test("persists name to file", () => {
    try { unlinkSync(agentIdFile()); } catch {}
    _resetAutoName();
    const name = getAutoName();
    const persisted = readFileSync(agentIdFile(), "utf-8").trim();
    expect(persisted).toBe(name);
  });

  test("reads persisted name on subsequent calls", () => {
    const { writeFileSync, mkdirSync } = require("fs");
    const { dirname } = require("path");
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    writeFileSync(agentIdFile(), "custom-persisted-name\n", "utf-8");
    _resetAutoName();
    const name = getAutoName();
    expect(name).toBe("custom-persisted-name");
  });

  test("is cached in memory after first call", () => {
    try { unlinkSync(agentIdFile()); } catch {}
    _resetAutoName();
    const name1 = getAutoName();
    // Even if we delete the file, cached value persists
    try { unlinkSync(agentIdFile()); } catch {}
    const name2 = getAutoName();
    expect(name1).toBe(name2);
  });
});

describe("updateCachedAutoName", () => {
  function writeIdentity(name: string): void {
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    writeFileSync(agentIdFile(), name + "\n", "utf-8");
  }

  test("adopts the name in memory and on disk when the write succeeds", () => {
    writeIdentity("augustus");
    _resetAutoName();

    expect(updateCachedAutoName("beatrix")).toBe(true);
    expect(readPersistedIdentity()).toBe("beatrix");
    expect(getAutoName()).toBe("beatrix");
    expect(resolveIdentity()).toBe("beatrix");
  });

  test("leaves the in-memory identity alone when the file cannot be written", () => {
    writeIdentity("augustus");
    _resetAutoName();
    chmodSync(agentIdFile(), 0o444);

    try {
      expect(updateCachedAutoName("would-be-usurper")).toBe(false);

      // Nothing was adopted, so every reader must still say "augustus".
      // Moving the cache first is what made the CLI report the opposite of
      // the truth, and left the MCP daemon stuck on the rejected name.
      expect(readPersistedIdentity()).toBe("augustus");
      expect(getAutoName()).toBe("augustus");
      expect(resolveIdentity()).toBe("augustus");
    } finally {
      chmodSync(agentIdFile(), 0o644);
    }
  });
});

describe("readPersistedIdentity", () => {
  test("follows the file when the in-process cache has gone stale", () => {
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    writeFileSync(agentIdFile(), "augustus\n", "utf-8");
    _resetAutoName();
    expect(getAutoName()).toBe("augustus");

    // Another process on this box repoints the machine identity. A long-lived
    // daemon keeps serving the cached name; only the file is current.
    writeFileSync(agentIdFile(), "beatrix\n", "utf-8");

    expect(getAutoName()).toBe("augustus");
    expect(readPersistedIdentity()).toBe("beatrix");

    // Which is why rename decides self-ness from the file: the cache would
    // both miss the real identity and claim one that moved on.
    expect(isSelfRename("beatrix", readPersistedIdentity())).toBe(true);
    expect(isSelfRename("beatrix", getAutoName())).toBe(false);
    expect(isSelfRename("augustus", readPersistedIdentity())).toBe(false);
    expect(isSelfRename("augustus", getAutoName())).toBe(true);
  });
});

describe("AGENT_NAMES", () => {
  test("has at least 200 names", () => {
    expect(AGENT_NAMES.length).toBeGreaterThanOrEqual(200);
  });

  test("all names are unique", () => {
    const unique = new Set(AGENT_NAMES);
    expect(unique.size).toBe(AGENT_NAMES.length);
  });

  test("all names are lowercase kebab-case", () => {
    for (const name of AGENT_NAMES) {
      expect(name).toMatch(/^[a-z]+-[a-z]+$/);
    }
  });
});

describe("requireIdentity", () => {
  test("returns explicit value when provided", () => {
    expect(requireIdentity("alice")).toBe("alice");
  });

  test("returns env var when no explicit value", () => {
    process.env.CONVERSATIONS_AGENT_ID = "env-agent";
    expect(requireIdentity()).toBe("env-agent");
  });

  test("throws when no identity available", () => {
    delete process.env.CONVERSATIONS_AGENT_ID;
    expect(() => requireIdentity()).toThrow("Agent identity required");
  });
});

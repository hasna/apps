import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import {
  resolveIdentity,
  requireIdentity,
  getAutoName,
  isSelfRename,
  readPersistedIdentity,
  updateCachedAutoName,
  _resetAutoName,
  describeIdentitySource,
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
  // These suites exercise the machine-identity FILE path, which is now opt-in.
  // The suites below that assert the refusal delete this in their own
  // beforeEach (inner hooks run after outer ones).
  process.env.CONVERSATIONS_USE_MACHINE_IDENTITY = "1";
  _resetAutoName();
});

afterEach(() => {
  // Restore env
  if (savedEnv !== undefined) {
    process.env.CONVERSATIONS_AGENT_ID = savedEnv;
  } else {
    delete process.env.CONVERSATIONS_AGENT_ID;
  }

  delete process.env.CONVERSATIONS_USE_MACHINE_IDENTITY;
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

  test("throws instead of falling back to a made-up name when nothing is set", () => {
    delete process.env.CONVERSATIONS_AGENT_ID;
    try { unlinkSync(agentIdFile()); } catch {}
    _resetAutoName();
    expect(() => resolveIdentity()).toThrow(/no agent identity/i);
  });

  test("opted-in machine identity is consistent across calls", () => {
    delete process.env.CONVERSATIONS_AGENT_ID;
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    writeFileSync(agentIdFile(), "persisted-seat\n", "utf-8");
    _resetAutoName();
    expect(resolveIdentity()).toBe("persisted-seat");
    expect(resolveIdentity()).toBe("persisted-seat");
  });
});

describe("getAutoName", () => {
  test("throws rather than minting a name when no identity file exists", () => {
    try { unlinkSync(agentIdFile()); } catch {}
    _resetAutoName();
    expect(() => getAutoName()).toThrow(/no agent identity/i);
  });

  test("never writes an identity file of its own accord", () => {
    try { unlinkSync(agentIdFile()); } catch {}
    _resetAutoName();
    try { getAutoName(); } catch {}
    expect(readPersistedIdentity()).toBeNull();
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
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    writeFileSync(agentIdFile(), "cached-seat\n", "utf-8");
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

/**
 * Regression tests for the machine-wide identity defect (todos 0edfdc8d).
 *
 * Two failure modes, one root cause: identity resolution had a *guessing*
 * fallback with no failure mode, so a session that never declared who it was
 * still got an answer.
 *
 *   - Silent INHERITANCE: $HOME/.hasna/conversations/agent-id is a single
 *     machine-level file. On 2026-07-30 the CEO seat wrote "agent-ceo" into it
 *     (correct for that seat) and every other seat on the box then posted as
 *     agent-ceo — an entire day of attribution across seven tmux seats was
 *     collapsed onto one identity.
 *   - Silent INVENTION: with no file at all, resolution minted a random name
 *     from the pool and *persisted it as the machine identity*, so a name
 *     nobody chose became every other process's identity too.
 *
 * Both are fixed by refusing to answer. The file is still usable by the
 * single-identity contexts that legitimately want it (cron, loops, hooks, a
 * one-seat box), but only when the process opts in explicitly.
 */
describe("machine identity is never inherited or invented silently", () => {
  beforeEach(() => {
    delete process.env.CONVERSATIONS_AGENT_ID;
    delete process.env.CONVERSATIONS_USE_MACHINE_IDENTITY;
    _resetAutoName();
  });

  test("throws instead of inventing a name when nothing is set anywhere", () => {
    try { unlinkSync(agentIdFile()); } catch {}
    _resetAutoName();
    expect(() => resolveIdentity()).toThrow(/no agent identity/i);
  });

  test("does not write an invented identity to disk when resolution fails", () => {
    try { unlinkSync(agentIdFile()); } catch {}
    _resetAutoName();
    try { resolveIdentity(); } catch {}
    // The old code persisted the name it invented, silently changing the
    // identity of every other process on the box.
    expect(() => readFileSync(agentIdFile(), "utf-8")).toThrow();
    expect(readPersistedIdentity()).toBeNull();
  });

  test("does NOT inherit the machine identity file by default", () => {
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    writeFileSync(agentIdFile(), "agent-ceo\n", "utf-8");
    _resetAutoName();
    // This is the exact incident: another seat's file must not become our name.
    expect(() => resolveIdentity()).toThrow(/agent-ceo/);
  });

  test("names the owning identity and the remedies when it refuses", () => {
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    writeFileSync(agentIdFile(), "agent-ceo\n", "utf-8");
    _resetAutoName();
    let message = "";
    try { resolveIdentity(); } catch (err) { message = (err as Error).message; }
    expect(message).toContain("agent-ceo");
    expect(message).toContain("CONVERSATIONS_AGENT_ID");
    expect(message).toContain("--from");
    expect(message).toContain("CONVERSATIONS_USE_MACHINE_IDENTITY");
  });

  test("serves the machine identity when the process opts in explicitly", () => {
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    writeFileSync(agentIdFile(), "agent-ceo\n", "utf-8");
    _resetAutoName();
    process.env.CONVERSATIONS_USE_MACHINE_IDENTITY = "1";
    expect(resolveIdentity()).toBe("agent-ceo");
  });

  test("opt-in still refuses to invent when the file is absent", () => {
    try { unlinkSync(agentIdFile()); } catch {}
    _resetAutoName();
    process.env.CONVERSATIONS_USE_MACHINE_IDENTITY = "1";
    expect(() => resolveIdentity()).toThrow(/no agent identity/i);
  });

  test("a durable seat keeps its identity across sessions via the env var", () => {
    // Seat A and seat B on the SAME machine, same identity file present.
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    writeFileSync(agentIdFile(), "agent-ceo\n", "utf-8");

    process.env.CONVERSATIONS_AGENT_ID = "agent-ceo";
    _resetAutoName();
    expect(resolveIdentity()).toBe("agent-ceo");

    process.env.CONVERSATIONS_AGENT_ID = "agent-harness";
    _resetAutoName();
    expect(resolveIdentity()).toBe("agent-harness");
  });

  test("a cached identity does not survive the opt-in gate (long-lived daemon)", () => {
    // THE REGRESSION THIS EXISTS FOR. register_agent's seed-if-absent and
    // rename's self-adoption both call updateCachedAutoName(), which writes an
    // in-process cache. getAutoName() used to check that cache BEFORE the
    // opt-in gate, so in a long-lived daemon one seat's deliberate identity
    // write became every later undeclared caller's identity — the original
    // defect relocated from the file into process memory. The MCP HTTP server
    // builds a fresh McpServer per request (sessionIdGenerator: undefined), so
    // its per-connection rung is inert and callers fall straight to here.
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    expect(updateCachedAutoName("agent-ceo")).toBe(true);

    // A later caller in the SAME process that declared nothing must still be refused.
    expect(() => resolveIdentity()).toThrow(/no agent identity/i);
  });

  test("the refusal still names the cached identity it declined to hand over", () => {
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    updateCachedAutoName("agent-ceo");
    let message = "";
    try { resolveIdentity(); } catch (err) { message = (err as Error).message; }
    expect(message).toContain("agent-ceo");
  });

  test("explicit --from still wins over everything", () => {
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    writeFileSync(agentIdFile(), "agent-ceo\n", "utf-8");
    process.env.CONVERSATIONS_AGENT_ID = "agent-harness";
    _resetAutoName();
    expect(resolveIdentity("agent-shipping")).toBe("agent-shipping");
  });
});

describe("describeIdentitySource", () => {
  beforeEach(() => {
    delete process.env.CONVERSATIONS_AGENT_ID;
    delete process.env.CONVERSATIONS_USE_MACHINE_IDENTITY;
    _resetAutoName();
  });

  test("reports the file as the source when the file is what answered", () => {
    // The old `whoami` printed "auto-generated (<path>)" even when the value was
    // READ from the file, making inheritance indistinguishable from invention in
    // the one diagnostic an operator would reach for.
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    writeFileSync(agentIdFile(), "agent-ceo\n", "utf-8");
    process.env.CONVERSATIONS_USE_MACHINE_IDENTITY = "1";
    _resetAutoName();
    const source = describeIdentitySource();
    expect(source).toContain("machine identity file");
    expect(source).not.toContain("auto-generated");
  });

  test("reports the env var when the env var answered", () => {
    process.env.CONVERSATIONS_AGENT_ID = "agent-harness";
    expect(describeIdentitySource()).toContain("CONVERSATIONS_AGENT_ID");
  });

  test("reports the flag when an explicit name answered", () => {
    expect(describeIdentitySource("agent-shipping")).toContain("--from");
  });
});

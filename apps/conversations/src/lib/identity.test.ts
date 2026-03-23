import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { resolveIdentity, requireIdentity, getAutoName, _resetAutoName } from "./identity";
import { AGENT_NAMES } from "./names";
import { unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { getDataDir } from "./db";

const AGENT_ID_FILE = join(getDataDir(), "agent-id");
const savedEnv = process.env.CONVERSATIONS_AGENT_ID;
let savedAgentId: string | null = null;

beforeEach(() => {
  // Save existing agent-id file if present
  try {
    savedAgentId = readFileSync(AGENT_ID_FILE, "utf-8");
  } catch {
    savedAgentId = null;
  }
  _resetAutoName();
});

afterEach(() => {
  // Restore env
  if (savedEnv !== undefined) {
    process.env.CONVERSATIONS_AGENT_ID = savedEnv;
  } else {
    delete process.env.CONVERSATIONS_AGENT_ID;
  }

  // Restore agent-id file
  if (savedAgentId !== null) {
    const { writeFileSync } = require("fs");
    writeFileSync(AGENT_ID_FILE, savedAgentId, "utf-8");
  }
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
    try { unlinkSync(AGENT_ID_FILE); } catch {}
    _resetAutoName();
    const name = resolveIdentity();
    expect(name).not.toBe("user");
    expect(AGENT_NAMES).toContain(name as any);
  });

  test("auto-generated name is consistent across calls", () => {
    delete process.env.CONVERSATIONS_AGENT_ID;
    try { unlinkSync(AGENT_ID_FILE); } catch {}
    _resetAutoName();
    const name1 = resolveIdentity();
    const name2 = resolveIdentity();
    expect(name1).toBe(name2);
  });
});

describe("getAutoName", () => {
  test("returns a name from the pool", () => {
    try { unlinkSync(AGENT_ID_FILE); } catch {}
    _resetAutoName();
    const name = getAutoName();
    expect(AGENT_NAMES).toContain(name as any);
  });

  test("persists name to file", () => {
    try { unlinkSync(AGENT_ID_FILE); } catch {}
    _resetAutoName();
    const name = getAutoName();
    const persisted = readFileSync(AGENT_ID_FILE, "utf-8").trim();
    expect(persisted).toBe(name);
  });

  test("reads persisted name on subsequent calls", () => {
    const { writeFileSync, mkdirSync } = require("fs");
    const { dirname } = require("path");
    mkdirSync(dirname(AGENT_ID_FILE), { recursive: true });
    writeFileSync(AGENT_ID_FILE, "custom-persisted-name\n", "utf-8");
    _resetAutoName();
    const name = getAutoName();
    expect(name).toBe("custom-persisted-name");
  });

  test("is cached in memory after first call", () => {
    try { unlinkSync(AGENT_ID_FILE); } catch {}
    _resetAutoName();
    const name1 = getAutoName();
    // Even if we delete the file, cached value persists
    try { unlinkSync(AGENT_ID_FILE); } catch {}
    const name2 = getAutoName();
    expect(name1).toBe(name2);
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

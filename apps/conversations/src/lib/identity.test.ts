import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveIdentity, requireIdentity } from "./identity";

const savedEnv = process.env.CONVERSATIONS_AGENT_ID;

afterEach(() => {
  if (savedEnv !== undefined) {
    process.env.CONVERSATIONS_AGENT_ID = savedEnv;
  } else {
    delete process.env.CONVERSATIONS_AGENT_ID;
  }
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

  test("falls back to 'user' when nothing set", () => {
    delete process.env.CONVERSATIONS_AGENT_ID;
    expect(resolveIdentity()).toBe("user");
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

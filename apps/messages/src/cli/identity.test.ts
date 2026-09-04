/**
 * Identity resolution: explicit flag → station env → fail closed
 * (hasna/apps#1602). Unit-level; the CLI-level behaviour is covered in
 * cli.test.ts by spawning the real binary.
 */
import { describe, expect, test } from "bun:test";
import { AGENT_DEFAULT_HINT, MESSAGES_AGENT_ID_ENV_KEYS, envAgentId, requireAgent } from "./identity";

describe("envAgentId", () => {
  test("prefers the canonical key, then the short alias, then the conversations identity", () => {
    expect(
      envAgentId({
        HASNA_MESSAGES_AGENT_ID: "canonical",
        MESSAGES_AGENT_ID: "short",
        CONVERSATIONS_AGENT_ID: "conversations",
      }),
    ).toBe("canonical");
    expect(envAgentId({ MESSAGES_AGENT_ID: "short", CONVERSATIONS_AGENT_ID: "conversations" })).toBe("short");
    expect(envAgentId({ CONVERSATIONS_AGENT_ID: "conversations" })).toBe("conversations");
  });

  test("a blank or whitespace value is absent, not an empty identity", () => {
    expect(envAgentId({ HASNA_MESSAGES_AGENT_ID: "   ", MESSAGES_AGENT_ID: "short" })).toBe("short");
    expect(envAgentId({ HASNA_MESSAGES_AGENT_ID: "" })).toBeUndefined();
    expect(envAgentId({})).toBeUndefined();
  });
});

describe("requireAgent", () => {
  test("the explicit flag outranks the environment", () => {
    expect(requireAgent("flag", "--agent", { HASNA_MESSAGES_AGENT_ID: "env" })).toBe("flag");
  });

  test("falls back to the environment when the flag is absent or blank", () => {
    expect(requireAgent(undefined, "--agent", { MESSAGES_AGENT_ID: "env" })).toBe("env");
    expect(requireAgent("  ", "--agent", { CONVERSATIONS_AGENT_ID: "env" })).toBe("env");
  });

  test("fails closed, naming the flag and every env key, when nothing resolves", () => {
    expect(() => requireAgent(undefined, "--from", {})).toThrow(/--from is required/);
    for (const key of MESSAGES_AGENT_ID_ENV_KEYS) {
      expect(() => requireAgent(undefined, "--agent", {})).toThrow(new RegExp(key));
    }
  });

  test("the help hint names the same keys the resolver reads", () => {
    for (const key of MESSAGES_AGENT_ID_ENV_KEYS) expect(AGENT_DEFAULT_HINT).toContain(`$${key}`);
  });
});

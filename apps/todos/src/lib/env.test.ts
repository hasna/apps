import { afterEach, describe, expect, test } from "bun:test";
import { env } from "./env.js";

/**
 * Every canonical/legacy pair the module reads. Keep in lockstep with env.ts:
 * the tests below pin the alias order (canonical wins, legacy fallback) and
 * the empty-string semantics of the shared `??` helper.
 */
const CASES: Array<{ read: () => string | undefined; canonical: string; legacy: string }> = [
  { read: () => env.apiKey(), canonical: "HASNA_TODOS_API_KEY", legacy: "TODOS_API_KEY" },
  { read: () => env.profile(), canonical: "HASNA_TODOS_PROFILE", legacy: "TODOS_PROFILE" },
  { read: () => env.toolGroups(), canonical: "HASNA_TODOS_TOOL_GROUPS", legacy: "TODOS_TOOL_GROUPS" },
  { read: () => env.machineId(), canonical: "HASNA_TODOS_MACHINE_ID", legacy: "TODOS_MACHINE_ID" },
  { read: () => env.machineName(), canonical: "HASNA_TODOS_MACHINE_NAME", legacy: "TODOS_MACHINE_NAME" },
  { read: () => env.rateLimitMax(), canonical: "HASNA_TODOS_RATE_LIMIT_MAX", legacy: "TODOS_RATE_LIMIT_MAX" },
  { read: () => env.trustProxy(), canonical: "HASNA_TODOS_TRUST_PROXY", legacy: "TODOS_TRUST_PROXY" },
  { read: () => env.autoProject(), canonical: "HASNA_TODOS_AUTO_PROJECT", legacy: "TODOS_AUTO_PROJECT" },
  { read: () => env.aiFormat(), canonical: "HASNA_TODOS_AI_FORMAT", legacy: "TODOS_AI_FORMAT" },
  { read: () => env.syncAgents(), canonical: "HASNA_TODOS_SYNC_AGENTS", legacy: "TODOS_SYNC_AGENTS" },
  { read: () => env.taskListId(), canonical: "HASNA_TODOS_TASK_LIST_ID", legacy: "TODOS_TASK_LIST_ID" },
  { read: () => env.claudeTaskList(), canonical: "HASNA_TODOS_CLAUDE_TASK_LIST", legacy: "TODOS_CLAUDE_TASK_LIST" },
  { read: () => env.sandboxProfilesPath(), canonical: "HASNA_TODOS_SANDBOX_PROFILES_PATH", legacy: "TODOS_SANDBOX_PROFILES_PATH" },
  { read: () => env.seatRosterPath(), canonical: "HASNA_TODOS_SEAT_ROSTER_PATH", legacy: "TODOS_SEAT_ROSTER_PATH" },
  { read: () => env.delegateNoticeChannel(), canonical: "HASNA_TODOS_DELEGATE_NOTICE_CHANNEL", legacy: "TODOS_DELEGATE_NOTICE_CHANNEL" },
  { read: () => env.delegateNotifyBin(), canonical: "HASNA_TODOS_DELEGATE_NOTIFY_BIN", legacy: "TODOS_DELEGATE_NOTIFY_BIN" },
];

const SAVED = new Map<string, string | undefined>();
for (const { canonical, legacy } of CASES) {
  SAVED.set(canonical, process.env[canonical]);
  SAVED.set(legacy, process.env[legacy]);
}
afterEach(() => {
  for (const [key, value] of SAVED) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("env alias resolution", () => {
  test("reads the legacy name when the canonical one is unset", () => {
    for (const { read, canonical, legacy } of CASES) {
      delete process.env[canonical];
      process.env[legacy] = `legacy-${legacy}`;
      expect(read(), legacy).toBe(`legacy-${legacy}`);
    }
  });

  test("canonical wins when both are set", () => {
    for (const { read, canonical, legacy } of CASES) {
      process.env[canonical] = `canonical-${canonical}`;
      process.env[legacy] = `legacy-${legacy}`;
      expect(read(), canonical).toBe(`canonical-${canonical}`);
    }
  });

  test("an empty canonical value still wins (`??` never falls back past it)", () => {
    for (const { read, canonical, legacy } of CASES) {
      process.env[canonical] = "";
      process.env[legacy] = `legacy-${legacy}`;
      expect(read(), canonical).toBe("");
    }
  });

  test("undefined when neither name is set", () => {
    for (const { read, canonical, legacy } of CASES) {
      delete process.env[canonical];
      delete process.env[legacy];
      expect(read(), `${canonical} / ${legacy}`).toBeUndefined();
    }
  });
});

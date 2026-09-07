// Suggestion availability follows actual CLI implementations, not old deployment stubs.
import { describe, expect, it } from "bun:test";
import { isCommandAvailableInMode, keepAvailableCommands, LOCAL_REFUSED_COMMANDS, NEVER_AVAILABLE_COMMANDS, SELF_HOSTED_REFUSED_COMMANDS } from "./status-commands.js";

describe("command suggestion availability", () => {
  it("keeps restored API commands and selectors available", () => {
    for (const command of [
      "emails stats --json", "emails analytics", "emails batch", "emails test", "emails monitor",
      "emails provider sync", "emails pull", "emails doctor delivery ops@example.com",
      "emails inbox explain ops@example.com", "emails inbox open abc", "emails inbox realtime-status",
      "emails inbox setup-realtime example.com --source source", "emails inbox sync-s3 --source source", "emails inbox watch --all-buckets",
      "emails inbox clear --provider p1 --limit 10", "emails inbox unread-count --by-address",
      "emails schedule run", "emails scheduler", "emails provision status",
      "emails domain status example.com", "emails domain verify example.com",
      "emails domains verify example.com", "emails domains enable-inbound example.com",
      "emails domains enable-outbound example.com", "emails domains disable-outbound example.com",
      "emails doctor --json", "emails export emails --format json", "emails export events --format json",
      "emails schedule list", "emails scheduled list", "emails schedule cancel abc",
      "emails daemon status", "emails daemon restart", "emails logs tail --component scheduler",
      "emails inbox listen --port 2525", "emails webhook listen --port 9877", "emails inbox source list", "emails send --to-group ops --subject s",
    ]) expect(isCommandAvailableInMode(command, "self_hosted"), command).toBe(true);
  });

  it("has no remaining API-client-only refusal prefixes", () => {
    expect(SELF_HOSTED_REFUSED_COMMANDS).toEqual([]);
  });

  it("narrows incomplete provisioning to its missing actions while allowing status", () => {
    for (const mode of ["local", "self_hosted"] as const) {
      for (const command of ["emails provision domain example.com", "emails provision up example.com", "emails provision roundtrip", "emails provision daemon"])
        expect(isCommandAvailableInMode(command, mode), command).toBe(false);
      expect(isCommandAvailableInMode("emails provision status", mode)).toBe(true);
      expect(keepAvailableCommands(["emails provision status", "emails provision up example.com", "emails domain list --json"], mode))
        .toEqual(["emails provision status", "emails domain list --json"]);
    }
  });

  it("does not advertise the nonexistent refresh verb in either compatibility mode", () => {
    for (const mode of ["local", "self_hosted"] as const) {
      expect(isCommandAvailableInMode("emails refresh", mode)).toBe(false);
      expect(isCommandAvailableInMode("emails pull", mode)).toBe(true);
    }
  });

  it("matches command words and preserves suggestion ordering", () => {
    expect(isCommandAvailableInMode("emails provision domain-report", "self_hosted")).toBe(true);
    expect(isCommandAvailableInMode("emails provision domain example.com", "self_hosted")).toBe(false);
    expect(keepAvailableCommands(["emails status --json", "emails stats --json", "emails inbox listen", "emails provider list --json"], "self_hosted"))
      .toEqual(["emails status --json", "emails stats --json", "emails provider list --json"]);
  });

  it("keeps registry entries namespaced and disjoint", () => {
    for (const command of [...NEVER_AVAILABLE_COMMANDS, ...SELF_HOSTED_REFUSED_COMMANDS, ...LOCAL_REFUSED_COMMANDS])
      expect(command.startsWith("emails ")).toBe(true);
    for (const command of NEVER_AVAILABLE_COMMANDS) {
      expect(SELF_HOSTED_REFUSED_COMMANDS).not.toContain(command);
      expect(LOCAL_REFUSED_COMMANDS).not.toContain(command);
    }
  });
});

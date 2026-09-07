import {describe, expect, test} from "bun:test";
import {compileOpenCodeModelPolicy} from "../src/opencode-model-policy";

describe("OpenCode model policy", () => {
  test("routes built-ins and custom subagents while preserving native fields", () => {
    const result = compileOpenCodeModelPolicy({providerId: "switcher", mainModel: "opus", roles: {subagent: "cheap", planning: "planner"}, preservedAgents: [
      {name: "general", prompt: "general prompt", permissions: [{action: "read", effect: "allow"}]},
      {name: "explore", mode: "subagent", tools: {read: true}},
      {name: "plan", mode: "primary", color: "#abc123"},
      {name: "build", mode: "primary", system: "keep"},
      {name: "custom", mode: "subagent", permissions: ["native"]},
    ]});
    expect(result.model).toBe("switcher/opus");
    expect(result.config.agents.general).toEqual({prompt: "general prompt", permissions: [{action: "read", effect: "allow"}], model: "switcher/cheap"});
    expect(result.config.agents.explore).toMatchObject({mode: "subagent", tools: {read: true}, model: "switcher/cheap"});
    expect(result.config.agents.plan).toMatchObject({mode: "primary", color: "#abc123", model: "switcher/planner"});
    expect(result.config.agents.build).toMatchObject({system: "keep", model: "switcher/opus"});
    expect(result.config.agents.custom).toMatchObject({permissions: ["native"], model: "switcher/cheap"});
    expect(result.config.agents.plan).toBeDefined();
  });

  test("assigns legacy utility agents and rejects unsupported OpenCode 2 utility controls", () => {
    const legacy = compileOpenCodeModelPolicy({providerId: "switcher", mainModel: "main", format: "legacy", roles: {summary: "brief", compaction: "compact"}});
    expect(legacy.config.agent?.title.model).toBe("switcher/brief");
    expect(legacy.config.agent?.summary.model).toBe("switcher/brief");
    expect(legacy.config.agent?.compaction.model).toBe("switcher/compact");
    for (const role of ["summary", "compaction", "fast"] as const) {
      expect(() => compileOpenCodeModelPolicy({providerId: "switcher", mainModel: "main", roles: {[role]: "other"}})).toThrow("does not expose native model controls");
    }
  });

  test("pins unknown agents to main and emits the legacy native namespace", () => {
    const result = compileOpenCodeModelPolicy({providerId: "switcher", mainModel: "main", roles: {subagent: "sub"}, preservedAgents: [{name: "formatter", prompt: "native", permissions: {write: "ask"}}]});
    expect(result.config.agents.formatter).toEqual({prompt: "native", permissions: {write: "ask"}, model: "switcher/main"});
    const legacy = compileOpenCodeModelPolicy({providerId: "switcher", mainModel: "main", format: "legacy", preservedAgents: [{name: "build", prompt: "keep"}]});
    expect(legacy.config.agent?.build).toEqual({prompt: "keep", model: "switcher/main"});
    expect(legacy.config.agents).toBeUndefined();
  });
});

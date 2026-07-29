import { describe, expect, test } from "bun:test";
import {
  modelRoutingGuardrailInput,
  openActionsGuardrailInput,
  openDispatchPromptGuardrailInput,
  openMcpsToolCallGuardrailInput,
  openTerminalCommandGuardrailInput,
  promptGuardrailInput,
} from "../src";

describe("integration input builders", () => {
  test("builds complete prompt and dispatch contexts", () => {
    const prompt = promptGuardrailInput({
      prompt: "placeholder prompt",
      messages: [{ role: "user", content: "placeholder message" }],
      actorId: "actor",
      tool: "test-tool",
      target: "target",
      traceId: "trace",
      sourceTrustLevel: "internal",
      metadata: { test: true },
    });
    expect(prompt).toEqual({
      operationType: "prompt",
      subject: "target",
      actor: { id: "actor", type: "agent" },
      session: { tool: "test-tool", traceId: "trace" },
      prompt: { text: "placeholder prompt", messages: [{ role: "user", content: "placeholder message" }] },
      sourceAccess: { trustLevel: "internal" },
      metadata: { test: true },
    });

    expect(
      openDispatchPromptGuardrailInput({
        target: "worker",
        prompt: "placeholder dispatch",
        actorId: "actor",
        traceId: "trace",
        metadata: { dispatch: true },
      }),
    ).toMatchObject({ subject: "worker", session: { tool: "open-dispatch", traceId: "trace" } });
    expect(promptGuardrailInput({})).toEqual({ operationType: "prompt", session: {}, prompt: {} });
  });

  test("infers all business fields and respects explicit business context", () => {
    const inferred = openActionsGuardrailInput({
      actorId: "actor",
      traceId: "trace",
      phase: "execute",
      metadata: { test: true },
      action: {
        id: "refund-id",
        name: "Refund placeholder invoice",
        resource: "fallback-resource",
        input: {
          operation: "refund",
          resource: "invoice",
          amountUsd: 25,
          customerId: "placeholder-customer",
          accountId: "placeholder-account",
          irreversible: false,
          approvalState: "approved",
        },
      },
    });
    expect(inferred.business).toEqual({
      operation: "refund",
      resource: "invoice",
      amountUsd: 25,
      customerId: "placeholder-customer",
      accountId: "placeholder-account",
      irreversible: false,
      approvalState: "approved",
    });
    expect(inferred).toMatchObject({
      subject: "Refund placeholder invoice",
      actor: { id: "actor" },
      session: { tool: "open-actions", traceId: "trace" },
      action: { phase: "execute" },
      metadata: { test: true },
    });

    const explicit = openActionsGuardrailInput({
      action: { id: "id", input: "not-an-object" },
      business: { operation: "explicit" },
    });
    expect(explicit.business).toEqual({ operation: "explicit" });
    expect(openActionsGuardrailInput({ action: { input: [] } })).not.toHaveProperty("business");
    expect(openActionsGuardrailInput({ action: { input: { amountUsd: Number.NaN, operation: "" } } })).not.toHaveProperty(
      "business",
    );
  });

  test("builds terminal and MCP evaluate-tool contexts without dropping fields", () => {
    const terminal = openTerminalCommandGuardrailInput({
      command: "echo placeholder",
      args: ["placeholder"],
      cwd: "/tmp/placeholder",
      envKeys: ["PLACEHOLDER_ENV"],
      target: "local",
      targetKind: "shell",
      actorId: "actor",
      traceId: "trace",
      metadata: { safe: true },
    });
    expect(terminal).toMatchObject({
      subject: "echo placeholder",
      actor: { id: "actor" },
      session: { tool: "open-terminal", cwd: "/tmp/placeholder", traceId: "trace" },
      shell: {
        command: "echo placeholder",
        args: ["placeholder"],
        cwd: "/tmp/placeholder",
        envKeys: ["PLACEHOLDER_ENV"],
        target: "local",
        targetKind: "shell",
      },
      metadata: { safe: true },
    });

    const mcp = openMcpsToolCallGuardrailInput({
      toolName: "evaluate",
      serverId: "placeholder-server",
      serverName: "Placeholder MCP",
      arguments: { input: "placeholder" },
      transport: "stdio",
      registrySource: "placeholder-registry",
      actorId: "actor",
      traceId: "trace",
      metadata: { safe: true },
    });
    expect(mcp).toEqual({
      operationType: "mcp_tool_call",
      subject: "evaluate",
      actor: { id: "actor", type: "agent" },
      session: { tool: "open-mcps", traceId: "trace" },
      mcp: {
        toolName: "evaluate",
        serverId: "placeholder-server",
        serverName: "Placeholder MCP",
        arguments: { input: "placeholder" },
        transport: "stdio",
        registrySource: "placeholder-registry",
      },
      metadata: { safe: true },
    });
  });

  test("builds complete and minimal model-routing contexts", () => {
    const full = modelRoutingGuardrailInput({
      requestedModel: "placeholder-requested",
      selectedModel: "placeholder-selected",
      provider: "placeholder-provider",
      route: "placeholder-route",
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      allowTraining: false,
      allowLogging: false,
      zeroDataRetentionRequired: true,
      byokOnly: true,
      regions: ["placeholder-region"],
      capabilities: ["placeholder-capability"],
      tool: "open-gateway",
      actorId: "actor",
      traceId: "trace",
      metadata: { safe: true },
    });
    expect(full.subject).toBe("placeholder-selected");
    expect(full.session).toEqual({ tool: "open-gateway", traceId: "trace" });
    expect(full.modelRouting).toMatchObject({
      requestedModel: "placeholder-requested",
      selectedModel: "placeholder-selected",
      inputUsdPerMillionTokens: 0,
      allowTraining: false,
      byokOnly: true,
    });
    expect(modelRoutingGuardrailInput({ requestedModel: "placeholder-only" })).toMatchObject({
      subject: "placeholder-only",
      session: { tool: "open-router" },
    });
    expect(modelRoutingGuardrailInput({})).toEqual({
      operationType: "model_routing",
      session: { tool: "open-router" },
      modelRouting: {},
    });
  });
});

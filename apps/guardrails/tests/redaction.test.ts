import { describe, expect, test } from "bun:test";
import {
  collectSearchText,
  collectTextFields,
  defaultSecretRedactionRules,
  detectRedactions,
  evaluateGuardrailWithDefaultPolicy,
  sha256,
} from "../src";
import type { GuardrailInput } from "../src";

describe("redaction", () => {
  test("collects searchable text across every supported context", () => {
    // Every value below is unique to its own field so that dropping a single
    // pushText call in collectTextFields changes the collected table.
    const circular: Record<string, unknown> = { label: "marker-action-input" };
    circular.self = circular;
    const input: GuardrailInput = {
      operationType: "prompt",
      subject: "marker-subject",
      prompt: {
        text: "marker-prompt-text",
        messages: [
          { role: "user", content: "marker-message-string" },
          { role: "assistant", content: [{ type: "text", text: "marker-message-structured" }] },
          { role: "tool", content: null },
        ],
      },
      action: {
        id: "marker-action-id",
        name: "marker-action-name",
        kind: "marker-action-kind",
        input: circular,
        preview: { preview: "marker-action-preview" },
      },
      shell: { command: "marker-shell-command", args: ["marker-shell-arg-one", "marker-shell-arg-two"] },
      mcp: {
        serverId: "marker-mcp-server-id",
        serverName: "marker-mcp-server-name",
        toolName: "marker-mcp-tool-name",
        arguments: { argument: "marker-mcp-arguments" },
      },
      browser: {
        url: "https://marker-browser-url.invalid",
        domain: "marker-browser-domain.invalid",
        action: "marker-browser-action",
      },
      computer: { app: "marker-computer-app", action: "marker-computer-action", screenText: "marker-computer-screen-text" },
      runtime: { path: "/tmp/marker-runtime-path", host: "marker-runtime-host", packageName: "marker-runtime-package-name" },
      modelRouting: {
        requestedModel: "marker-requested-model",
        selectedModel: "marker-selected-model",
        provider: "marker-model-provider",
      },
      secretAccess: { secretName: "MARKER_SECRET_NAME", source: "marker-secret-access-source" },
      sourceAccess: { uri: "file:///tmp/marker-source-uri", license: "MARKER-LICENSE-1.0" },
      business: { operation: "marker-business-operation", resource: "marker-business-resource" },
      content: { text: "marker-content-text", json: { json: "marker-content-json" } },
    };

    // The complete surface fed to redaction and text matching, in collection order.
    // action.input is a circular object, so stringifyJson falls back to String(value).
    const expected = [
      { path: "subject", value: "marker-subject" },
      { path: "prompt.text", value: "marker-prompt-text" },
      { path: "prompt.messages.0.content", value: "marker-message-string" },
      { path: "prompt.messages.1.content", value: '[{"type":"text","text":"marker-message-structured"}]' },
      { path: "prompt.messages.2.content", value: "null" },
      { path: "action.id", value: "marker-action-id" },
      { path: "action.name", value: "marker-action-name" },
      { path: "action.kind", value: "marker-action-kind" },
      { path: "action.input", value: "[object Object]" },
      { path: "action.preview", value: '{"preview":"marker-action-preview"}' },
      { path: "shell.command", value: "marker-shell-command" },
      { path: "shell.args", value: "marker-shell-arg-one marker-shell-arg-two" },
      { path: "mcp.serverId", value: "marker-mcp-server-id" },
      { path: "mcp.serverName", value: "marker-mcp-server-name" },
      { path: "mcp.toolName", value: "marker-mcp-tool-name" },
      { path: "mcp.arguments", value: '{"argument":"marker-mcp-arguments"}' },
      { path: "browser.url", value: "https://marker-browser-url.invalid" },
      { path: "browser.domain", value: "marker-browser-domain.invalid" },
      { path: "browser.action", value: "marker-browser-action" },
      { path: "computer.app", value: "marker-computer-app" },
      { path: "computer.action", value: "marker-computer-action" },
      { path: "computer.screenText", value: "marker-computer-screen-text" },
      { path: "runtime.path", value: "/tmp/marker-runtime-path" },
      { path: "runtime.host", value: "marker-runtime-host" },
      { path: "runtime.packageName", value: "marker-runtime-package-name" },
      { path: "modelRouting.requestedModel", value: "marker-requested-model" },
      { path: "modelRouting.selectedModel", value: "marker-selected-model" },
      { path: "modelRouting.provider", value: "marker-model-provider" },
      { path: "secretAccess.secretName", value: "MARKER_SECRET_NAME" },
      { path: "secretAccess.source", value: "marker-secret-access-source" },
      { path: "sourceAccess.uri", value: "file:///tmp/marker-source-uri" },
      { path: "sourceAccess.license", value: "MARKER-LICENSE-1.0" },
      { path: "business.operation", value: "marker-business-operation" },
      { path: "business.resource", value: "marker-business-resource" },
      { path: "content.text", value: "marker-content-text" },
      { path: "content.json", value: '{"json":"marker-content-json"}' },
    ];

    const fields = collectTextFields(input);
    expect(fields).toEqual(expected);
    expect(collectSearchText(input)).toBe(expected.map((field) => field.value).join("\n"));
  });

  test("skips empty, missing, and undefined context values", () => {
    const fields = collectTextFields({
      operationType: "shell_command",
      subject: "",
      shell: { command: "marker-shell-command", args: [] },
      computer: {},
      content: { text: "", json: undefined },
    });

    expect(fields).toEqual([{ path: "shell.command", value: "marker-shell-command" }]);
  });

  test("honors exact, parent, and wildcard paths and records safe hashes", () => {
    const input: GuardrailInput = {
      operationType: "prompt",
      prompt: {
        text: "PLACEHOLDER_TOKEN and placeholder_token",
        messages: [{ role: "user", content: "PLACEHOLDER_TOKEN" }],
      },
      content: { text: "PLACEHOLDER_TOKEN" },
    };
    const redactions = detectRedactions(input, "redaction-policy", [
      { id: "prompt-only", pattern: "(?i)placeholder_token", replacement: "[masked]", paths: ["prompt"] },
      { pattern: "PLACEHOLDER_TOKEN", paths: ["content.text"] },
      { id: "wildcard", pattern: "does-not-match", paths: ["*"] },
    ]);

    expect(redactions).toHaveLength(4);
    expect(redactions[0]).toEqual({
      policyId: "redaction-policy",
      path: "prompt.text",
      replacement: "[masked]",
      originalSha256: sha256("PLACEHOLDER_TOKEN"),
      start: 0,
      end: 17,
      ruleId: "prompt-only",
    });
    expect(redactions.at(-1)).toMatchObject({ path: "content.text", replacement: "[redacted]" });
    expect(JSON.stringify(redactions)).not.toContain("PLACEHOLDER_TOKEN");
  });

  test("default rule pack detects representative placeholder secret formats", () => {
    const placeholderValues = [
      "sk-PLACEHOLDER0000",
      "sk_test_PLACEHOLDER0000",
      "ghp_PLACEHOLDER000000000000",
      "github_pat_PLACEHOLDER000000000000",
      "xoxb-PLACEHOLDER-0000",
      "AIzaPLACEHOLDER000000000000",
      "eyJPLACEHOLDER.eyJPLACEHOLDER.SIGNATUREPLACEHOLDER",
      "Bearer PLACEHOLDER_TOKEN_0000",
    ];
    const input: GuardrailInput = { operationType: "prompt", prompt: { text: placeholderValues.join("\n") } };
    const rules = defaultSecretRedactionRules();
    const redactions = detectRedactions(input, "default-secrets", rules);

    expect(rules).toHaveLength(8);
    expect(redactions.map((redaction) => redaction.ruleId)).toEqual(rules.map((rule) => rule.id));
    expect(redactions.every((redaction) => redaction.replacement === "[redacted-secret]")).toBe(true);
  });

  test("default policy redacts secrets carried by non-prompt contexts", () => {
    const decision = evaluateGuardrailWithDefaultPolicy({
      operationType: "shell_command",
      shell: { command: "deploy", args: ["--token", "sk-live-PLACEHOLDER0000"] },
      computer: { screenText: "ghp_PLACEHOLDER000000000000" },
      secretAccess: { secretName: "AIzaPLACEHOLDER000000000000" },
    });

    expect(decision.status).toBe("redact");
    expect(decision.redactions.map((redaction) => redaction.path)).toEqual([
      "shell.args",
      "computer.screenText",
      "secretAccess.secretName",
    ]);
    expect(decision.redactions.map((redaction) => redaction.originalSha256)).toEqual([
      sha256("sk-live-PLACEHOLDER0000"),
      sha256("ghp_PLACEHOLDER000000000000"),
      sha256("AIzaPLACEHOLDER000000000000"),
    ]);
    expect(JSON.stringify(decision)).not.toContain("PLACEHOLDER");
  });
});

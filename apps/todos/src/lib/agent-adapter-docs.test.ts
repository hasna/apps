import { describe, it, expect } from "bun:test";
import {
  AGENT_ADAPTER_DOCS,
  AGENT_ADAPTER_HOSTS,
  ADAPTER_DOCS_SCHEMA_VERSION,
  getAgentAdapterDoc,
  listAgentAdapterDocs,
  normalizeAdapterHost,
  validateAdapterDocs,
  renderAdapterDocMarkdown,
  renderAllAdapterDocsMarkdown,
  getAdapterDocsFingerprint,
} from "./agent-adapter-docs.js";

describe("agent adapter docs", () => {
  it("validates all adapter docs with no issues", () => {
    expect(validateAdapterDocs()).toEqual([]);
  });

  it("covers codex, claude-code, and takumi", () => {
    expect(AGENT_ADAPTER_HOSTS).toEqual(["codex", "claude-code", "takumi"]);
    expect(listAgentAdapterDocs()).toHaveLength(3);
    for (const host of AGENT_ADAPTER_HOSTS) {
      expect(AGENT_ADAPTER_DOCS[host].schema_version).toBe(ADAPTER_DOCS_SCHEMA_VERSION);
    }
  });

  it("normalizes host aliases", () => {
    expect(normalizeAdapterHost("claude")).toBe("claude-code");
    expect(normalizeAdapterHost("claude_code")).toBe("claude-code");
    expect(normalizeAdapterHost("CODEX")).toBe("codex");
    expect(normalizeAdapterHost("unknown")).toBeNull();
  });

  it("includes bun install commands in every doc", () => {
    for (const doc of listAgentAdapterDocs()) {
      expect(doc.install.bun).toContain("bun install -g @hasna/todos");
      expect(doc.mcp.recommended_profile).toBe("minimal");
    }
  });

  it("documents goal, verification, and handoff flows", () => {
    for (const host of AGENT_ADAPTER_HOSTS) {
      const doc = getAgentAdapterDoc(host)!;
      expect(doc.goal_commands.length).toBeGreaterThanOrEqual(4);
      expect(doc.verification.run).toContain("verify");
      expect(doc.handoff.goal).toContain("goal handoff");
      expect(doc.task_contract.complete).toContain("done");
    }
  });

  it("renders markdown without hosted platform references", () => {
    const md = renderAllAdapterDocsMarkdown();
    expect(md).toContain("# OpenAI Codex CLI");
    expect(md).toContain("# Claude Code");
    expect(md).toContain("# Takumi");
    expect(md).toContain("/goal execute");
    expect(md).not.toMatch(/platform-todos|stripe|aws/i);
  });

  it("renders per-host markdown snapshots", () => {
    for (const host of AGENT_ADAPTER_HOSTS) {
      const md = renderAdapterDocMarkdown(host)!;
      expect(md).toContain("## MCP Setup");
      expect(md).toContain("## Failure Modes");
      expect(md).toContain("bun install -g @hasna/todos");
    }
  });

  it("keeps stable docs fingerprint", () => {
    expect(getAdapterDocsFingerprint()).toBe("69e845b5");
  });
});

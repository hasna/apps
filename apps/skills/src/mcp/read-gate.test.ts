/**
 * The per-call read gate on the MCP DATA tools, in-process.
 *
 * `buildServer()` is also the composition root for the `skills mcp` subcommand,
 * the per-request HTTP server and any in-process embed, none of which pass the
 * startup gate in src/mcp/index.ts — so every data tool must refuse ON ITS OWN
 * when the fleet ladder refuses. Before this (#1720 validation, round 1)
 * list_skills / search_skills / get_skill_info / get_skill_docs /
 * list_categories / list_tags / get_requirements answered from the bundled
 * catalog and ~/.hasna/skills/installed with no isError and no notice on the
 * same environment where `skills list --json` exits 1.
 *
 * Hermetic: the preload has already stripped every credential variable, blinded
 * the Keychain (HASNA_STATION -> absent account) and dropped the local opt-in;
 * this file additionally relocates HASNA_HOME to an empty directory so the disk
 * tier finds no credentials file. The opt-in is then set explicitly for the
 * control — the same explicit-over-ambient rule the CLI harness follows.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { useDefaultTestTimeout } from "../test-preload.js";
import { resetLocalSkillsModeNotice } from "../lib/fleet-credentials.js";
import { runCli } from "../cli/cli.test-utils.js";
import { buildServer } from "./server.js";

useDefaultTestTimeout();

const DATA_TOOLS: Array<{ name: string; args: Record<string, unknown> }> = [
  { name: "list_skills", args: {} },
  { name: "list_skills", args: { profile: "all", category: "Design & Branding" } },
  { name: "search_skills", args: { query: "brand" } },
  { name: "get_skill_info", args: { name: "brand-kit" } },
  { name: "get_skill_docs", args: { name: "brand-kit" } },
  { name: "list_categories", args: {} },
  { name: "list_tags", args: {} },
  { name: "get_requirements", args: { name: "brand-kit" } },
];

let hasnaHome: string;
const savedHasnaHome = process.env.HASNA_HOME;
const savedLocal = process.env.HASNA_SKILLS_LOCAL;

beforeAll(() => {
  hasnaHome = mkdtempSync(join(tmpdir(), "skills-mcp-read-gate-"));
  process.env.HASNA_HOME = hasnaHome;
});

afterEach(() => {
  delete process.env.HASNA_SKILLS_LOCAL;
  resetLocalSkillsModeNotice();
});

afterAll(() => {
  if (savedHasnaHome === undefined) delete process.env.HASNA_HOME;
  else process.env.HASNA_HOME = savedHasnaHome;
  if (savedLocal === undefined) delete process.env.HASNA_SKILLS_LOCAL;
  else process.env.HASNA_SKILLS_LOCAL = savedLocal;
  rmSync(hasnaHome, { recursive: true, force: true });
});

async function connectedClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "read-gate-test", version: "0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

type ToolText = { isError: boolean; text: string };

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolText> {
  const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
  const text = result.content.find((c) => c.type === "text")?.text ?? "";
  return { isError: Boolean(result.isError), text };
}

describe("MCP data tools refuse when the fleet ladder refuses (no credential, no opt-in)", () => {
  test("every discovery/introspection tool answers AUTH_REQUIRED naming the refusal, not the catalog", async () => {
    const { client, close } = await connectedClient();
    try {
      for (const tool of DATA_TOOLS) {
        const { isError, text } = await call(client, tool.name, tool.args);
        expect(isError).toBe(true);
        const payload = JSON.parse(text) as { code: string; message: string; suggestions?: string[] };
        expect(payload.code).toBe("AUTH_REQUIRED");
        expect(payload.message).toContain("failing closed");
        expect(payload.message).toContain("HASNA_SKILLS_LOCAL=1");
        expect(payload.message).toContain("hasna.credentials.skills.api-key");
        expect(payload.message).toContain(join(hasnaHome, "skills", "config", "credentials"));
        expect(payload.suggestions).toContain("skills auth login");
        // Never a row of the bundled catalog.
        expect(text).not.toContain("brand-kit");
      }
    } finally {
      await close();
    }
  });

  test("an authority with no key is refused with the authority named, never the local corpus", async () => {
    process.env.HASNA_SKILLS_API_URL = "https://skills.example.com";
    try {
      const { client, close } = await connectedClient();
      try {
        const { isError, text } = await call(client, "list_skills", {});
        expect(isError).toBe(true);
        const payload = JSON.parse(text) as { code: string; message: string };
        expect(payload.code).toBe("AUTH_REQUIRED");
        expect(payload.message).toContain("HASNA_SKILLS_API_URL");
        expect(payload.message).toContain("no API key resolved");
      } finally {
        await close();
      }
    } finally {
      delete process.env.HASNA_SKILLS_API_URL;
    }
  });

  test("control: the explicit local opt-in serves the bundled corpus on every tool", async () => {
    process.env.HASNA_SKILLS_LOCAL = "1";
    const { client, close } = await connectedClient();
    try {
      for (const tool of DATA_TOOLS) {
        const { isError, text } = await call(client, tool.name, tool.args);
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(0);
      }
      const list = JSON.parse((await call(client, "list_skills", { profile: "all", limit: 1000 })).text) as { skills: Array<{ name: string }> };
      expect(list.skills.map((s) => s.name)).toContain("brand-kit");
      const info = JSON.parse((await call(client, "get_skill_info", { name: "brand-kit" })).text) as { name: string };
      expect(info.name).toBe("brand-kit");
    } finally {
      await close();
    }
  });

  test("whoami reports the credential SOURCES (never a value) and the misconfigured state", async () => {
    const { client, close } = await connectedClient();
    try {
      const refused = JSON.parse((await call(client, "whoami", {})).text) as { credential: { mode: string; error: string | null; apiKeySource: string | null } };
      expect(refused.credential.mode).toBe("misconfigured");
      expect(refused.credential.error).toContain("failing closed");
      expect(refused.credential.apiKeySource).toBeNull();
    } finally {
      await close();
    }

    process.env.HASNA_SKILLS_API_KEY = "sk_read_gate_never_printed";
    try {
      const { client: hosted, close: closeHosted } = await connectedClient();
      try {
        const raw = (await call(hosted, "whoami", {})).text;
        const payload = JSON.parse(raw) as { credential: { mode: string; apiKeySource: string | null; apiKeyTier: string | null; apiUrlSource: string | null } };
        expect(payload.credential.mode).toBe("hosted");
        expect(payload.credential.apiKeySource).toBe("HASNA_SKILLS_API_KEY");
        expect(payload.credential.apiKeyTier).toBe("env");
        expect(payload.credential.apiUrlSource).toBe("default");
        expect(raw).not.toContain("sk_read_gate_never_printed");
      } finally {
        await closeHosted();
      }
    } finally {
      delete process.env.HASNA_SKILLS_API_KEY;
    }
  });

  test("run_skill refused by the ladder writes no run record", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skills-mcp-refused-run-"));
    const previousCwd = process.cwd();
    process.chdir(cwd);
    try {
      const { client, close } = await connectedClient();
      try {
        // `remote: true` names a server-owned run; with nothing configured and no
        // opt-in the ladder refuses it. The refusal used to create
        // .skills/runs/<day>/<id>/{run.json,events.ndjson,artifacts.json} first.
        const { isError, text } = await call(client, "run_skill", { name: "brand-kit", remote: true });
        expect(isError).toBe(true);
        const payload = JSON.parse(text) as { code: string; message: string };
        expect(payload.code).toBe("REMOTE_REQUIRES_CREDENTIAL");
        expect(payload.message).not.toContain("run.json");
        expect(existsSync(join(cwd, ".skills"))).toBe(false);
      } finally {
        await close();
      }
    } finally {
      process.chdir(previousCwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("CLI and MCP agree on the unconfigured, no-opt-in refusal (parity)", () => {
  test("`skills list --json` / `skills info --json` exit 1 with the same refusal list_skills / get_skill_info return", async () => {
    const { client, close } = await connectedClient();
    let mcpList: string;
    let mcpInfo: string;
    try {
      mcpList = (JSON.parse((await call(client, "list_skills", {})).text) as { message: string }).message;
      mcpInfo = (JSON.parse((await call(client, "get_skill_info", { name: "brand-kit" })).text) as { message: string }).message;
    } finally {
      await close();
    }
    // The harness opts the child CLI in by default; a blank value opts it OUT.
    const cliList = await runCli(["list", "--json"], { HASNA_SKILLS_LOCAL: "" });
    const cliInfo = await runCli(["info", "brand-kit", "--json"], { HASNA_SKILLS_LOCAL: "" });
    for (const cli of [cliList, cliInfo]) {
      expect(cli.exitCode).toBe(1);
      expect(cli.stdout).toBe("");
    }
    // Same refusal, up to the credentials-file path (the child resolves its own HOME).
    const lead = (message: string) => message.split(" Looked in ")[0];
    expect(lead(cliList.stderr.split("\n")[0])).toBe(lead(mcpList));
    expect(lead(cliInfo.stderr.split("\n")[0])).toBe(lead(mcpInfo));
    expect(mcpList).toBe(mcpInfo);
  });
});

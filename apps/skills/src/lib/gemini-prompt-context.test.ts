import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hookContextOutput, normalizeAgentHookPrompt } from "./agent-integration.js";
import { buildSkillContext } from "./skill-context.js";
import { packSkillBundle } from "./skill-bundle.js";
import type { ProfileClient } from "./profile-client.js";
import type { ResolvedSkillSelection } from "../types/skill-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function directory(): string { const root = mkdtempSync(join(tmpdir(), "skills-gemini-context-")); roots.push(root); return root; }
const output = hookContextOutput("SessionStart", { context: "" }) as { hookSpecificOutput: { additionalContext: string } };
const policy = output.hookSpecificOutput.additionalContext;
const userPrompt = "Use backup-verify to explain the backup verification process briefly; respond without tools.";
const nativePrompt = `<hook_context>${policy}</hook_context>\n\n${userPrompt}`;

test("Gemini's actual native policy prefix does not displace the user's skill within the context budget", async () => {
  const bundles = new Map<string, ReturnType<typeof packSkillBundle>>();
  const selections: ResolvedSkillSelection[] = [];
  for (const [slug, bytes, keywords] of [["skills-author", 7500, ["skills", "skill", "authoring", "workspace"]], ["backup-verify", 1000, ["backup", "verify"]]] as const) {
    const source = directory();
    writeFileSync(join(source, "SKILL.md"), `---\nname: ${slug}\ndescription: A synthetic procedure\nkind: instruction\n---\n\n${"x".repeat(bytes)}\n`);
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: slug, version: "1.0.0", skills: { kind: "instruction" } }));
    const bundle = packSkillBundle(source); bundles.set(slug, bundle);
    selections.push({ authority: "https://skills.example.com/api/v1", workspaceId: "workspace-one", profileRevision: "revision-one", slug, version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}`, triggers: { keywords: [...keywords] } });
  }
  const client: ProfileClient = {
    authority: "https://skills.example.com/api/v1",
    resolveProfile: async () => ({ authority: "https://skills.example.com/api/v1", workspaceId: "workspace-one", profileId: "engineering", profileRevision: "revision-one", selections }),
    getBundle: async slug => { const bundle = bundles.get(slug)!; return new Response(bundle.bytes, { headers: { "X-Skill-Bundle-Sha256": bundle.sha256, "X-Skill-Version": "1.0.0" } }); },
    recordStation: async () => { throw new Error("Context does not report a station"); },
  };
  const result = await buildSkillContext({ prompt: normalizeAgentHookPrompt("gemini", "BeforeAgent", nativePrompt), profileId: "engineering" }, { client, cacheDir: directory() });
  expect(result.selections.map(selection => selection.slug)).toEqual(["backup-verify"]);
  expect(result.omitted.some(selection => selection.slug === "backup-verify")).toBe(false);
});

test("only the exact owned leading policy is removed; other hook context and the user's suffix remain byte-identical", () => {
  expect(normalizeAgentHookPrompt("gemini", "BeforeAgent", nativePrompt)).toBe(userPrompt);
  const otherContext = "Other hook context, including <hook_context>quoted user text</hook_context>.";
  const suffix = "  Preserve this user's spacing.\n\n";
  expect(normalizeAgentHookPrompt("gemini", "BeforeAgent", `<hook_context>${policy}\n\n${otherContext}</hook_context>\n\n${suffix}`)).toBe(`<hook_context>${otherContext}</hook_context>\n\n${suffix}`);
});

test("ordinary user text, arbitrary wrappers, malformed wrappers, and other native events are preserved", () => {
  for (const prompt of [
    userPrompt,
    policy,
    `<hook_context>User-authored skills instructions</hook_context>\n\n${userPrompt}`,
    `Explain this example: ${nativePrompt}`,
    `<hook_context>${policy.replace("shared profile", "my profile")}</hook_context>\n\n${userPrompt}`,
    `<hook_context>${policy}\n\nUnterminated user content`,
    `<hook_context>${policy} User-authored continuation</hook_context>\n\n${userPrompt}`,
  ]) expect(normalizeAgentHookPrompt("gemini", "BeforeAgent", prompt)).toBe(prompt);
  for (const event of ["SessionStart", "UserPromptSubmit", "BeforeTool"]) expect(normalizeAgentHookPrompt("gemini", event, nativePrompt)).toBe(nativePrompt);
  expect(normalizeAgentHookPrompt("claude", "BeforeAgent", nativePrompt)).toBe(nativePrompt);
});

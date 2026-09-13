import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { renderOpenCodePlugin } from "./agent-adapters.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("OpenCode's actual generated module awaits the CLI, preserves messages and blocks refusals or malformed results", async () => {
  const root = mkdtempSync(join(tmpdir(), "skills-opencode-adapter-")); roots.push(root);
  const command = join(root, "skills"), plugin = join(root, "plugin.mjs");
  writeFileSync(command, `#!${process.execPath}
import { readFileSync } from "node:fs";
const input = JSON.parse(readFileSync(0, "utf8"));
const output = input.prompt.includes("deny") ? { decision: "block", reason: "Fixture refusal" }
  : input.prompt.includes("malformed") ? { error: "Fixture error" }
  : { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: input.hook_event_name + ": " + input.prompt + " 🧭 " + process.argv.at(-1) } };
const bytes = Buffer.from(JSON.stringify(output)), at = bytes.indexOf(Buffer.from("🧭")) + 1;
process.stdout.write(bytes.subarray(0, at));
setTimeout(() => process.stdout.write(bytes.subarray(at)), 5);
`); chmodSync(command, 0o700);
  writeFileSync(plugin, renderOpenCodePlugin(command, "engineering"));
  const hooks = await (await import(pathToFileURL(plugin).href)).default({ directory: root });
  const first = { message: { id: "message-one" }, parts: [{ type: "text", text: "Review code" }, { type: "file", url: "fixture:file" }] };
  await hooks["chat.message"]({ sessionID: "session-one" }, first);
  expect(first.message).toEqual({ id: "message-one" }); expect(first.parts[1]).toEqual({ type: "file", url: "fixture:file" });
  expect(first.parts[0]!.text).toBe("Review code\n\nSessionStart: Review code 🧭 engineering");
  const next = { parts: [{ type: "text", text: "Continue review" }] };
  await hooks["chat.message"]({ sessionID: "session-one" }, next);
  expect(next.parts[0]!.text).toBe("Continue review\n\nUserPromptSubmit: Continue review 🧭 engineering");
  const imageOnly = { message: { id: "message-image" }, parts: [{ id: "part-image", sessionID: "session-image", messageID: "message-image", type: "file", mime: "image/png", url: "fixture:image" }] };
  const originalImage = { ...imageOnly.parts[0] };
  await hooks["chat.message"]({ sessionID: "session-image" }, imageOnly);
  expect(imageOnly.parts[0]).toEqual(originalImage);
  expect(imageOnly.parts[1]).toMatchObject({ type: "text", synthetic: true, sessionID: "session-image", messageID: "message-image", text: "SessionStart:  🧭 engineering" });
  for (const prompt of ["deny", "malformed"]) {
    const output = { parts: [{ type: "text", text: prompt }] };
    await expect(hooks["chat.message"]({ sessionID: "session-one" }, output)).rejects.toThrow();
    expect(output.parts[0]!.text).toBe(prompt);
  }
  await expect(hooks["tool.execute.before"]({ tool: "skill" }, { args: { name: "other" } })).rejects.toThrow("Skills CLI bridge");
  await hooks["tool.execute.before"]({ tool: "skill" }, { args: { name: "skills-cli" } });
  await hooks["tool.execute.before"]({ tool: "unrelated-tool" }, { args: {} });
});

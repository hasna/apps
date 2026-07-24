#!/usr/bin/env bun
const skipMainKey = "__HASNA_AUTOMATIONS_SKIP_MAIN__";
(globalThis as Record<string, unknown>)[skipMainKey] = true;

const { runAutomationsCli } = await import("./index.js");

if (import.meta.main) {
  process.exit(await runAutomationsCli(Bun.argv.slice(2), { programName: "hasna-automations" }));
}

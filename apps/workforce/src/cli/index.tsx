#!/usr/bin/env bun
import { Command } from "commander";
import { APP_VERSION } from "../version.js";
import { memberService } from "../services/index.js";
import { SYSTEM_AUTHORIZATION_CONTEXT } from "../services/authorization.js";
import { buildCliContext } from "./context.js";
import { registerNamespaces } from "./namespaces.js";

function globalJson(): boolean {
  return process.argv.includes("--json") || process.argv.includes("-j");
}

async function renderDashboard(): Promise<void> {
  const ctx = buildCliContext(globalJson());
  const members = memberService.listMembers({}, SYSTEM_AUTHORIZATION_CONTEXT);
  const counts = members.reduce<Record<string, number>>((acc, m) => {
    acc[m.kind] = (acc[m.kind] ?? 0) + 1;
    return acc;
  }, {});
  const summary = {
    app: "@hasna/workforce",
    version: APP_VERSION,
    mode: ctx.mode,
    total_members: members.length,
    by_kind: counts,
  };

  if (ctx.json || !process.stdout.isTTY) {
    console.log(JSON.stringify(summary));
    return;
  }

  // Interactive Ink dashboard (lazy-loaded so subcommands never pay for it).
  const { render, Box, Text } = await import("ink");
  const React = await import("react");
  const e = React.createElement;
  const app = render(
    e(
      Box,
      { flexDirection: "column", padding: 1 },
      e(Text, { bold: true, color: "cyan" }, `@hasna/workforce v${APP_VERSION}  (mode: ${ctx.mode})`),
      e(Text, {}, `Members on roster: ${members.length}`),
      ...Object.entries(counts).map(([kind, n]) => e(Text, { key: kind }, `  ${kind}: ${n}`)),
      e(Text, { dimColor: true }, "Run `workforce --help` for commands."),
    ),
  );
  app.unmount();
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("workforce")
    .description("Unified roster/HRIS: humans, contractors and agents as first-class org members.")
    .version(APP_VERSION)
    .option("-j, --json", "Emit machine-readable JSON")
    .enablePositionalOptions();

  registerNamespaces(program, buildCliContext(globalJson()).authCtx);

  program.action(async () => {
    await renderDashboard();
  });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.log(JSON.stringify({ code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error), suggestion: "", error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});

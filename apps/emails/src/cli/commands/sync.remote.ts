import type { Command } from "commander";
import chalk from "../../lib/chalk-lite.js";
import { getLocalStats, formatStatsTable } from "../../lib/stats.js";
import { getAnalytics, formatAnalytics } from "../../lib/analytics.js";
import { handleError, resolveId } from "../utils.js";

// Provider ingestion and the monitor remain server-owned. Reporting instead
// reads the existing canonical API through the public library functions, which
// preserve provider limitations, nullable measurements and completeness metadata.
function serverOnly(command: string): never {
  throw new Error(
    `${command} is not available in the self-hosted client; it runs on the self-hosted server.`,
  );
}

export function registerSyncCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  // ─── PROVIDER SYNC ────────────────────────────────────────────────────────────
  const providerCmd = program.commands.find(c => c.name() === "provider");
  if (providerCmd) {
    providerCmd
      .command("sync")
      .description("Sync delivery events from all providers")
      .option("-j, --json", "Print JSON output", false)
      .option("--provider <id>", "Specific provider ID")
      .action(async () => {
        try { serverOnly("emails provider sync"); } catch (e) { handleError(e); }
      });
  }

  // ─── PULL ─────────────────────────────────────────────────────────────────────
  program
    .command("pull")
    .description("Sync events from provider(s) (alias: emails provider sync)")
    .option("-j, --json", "Print JSON output", false)
    .option("--provider <id>", "Provider ID (syncs all if not specified)")
    .option("--watch", "Keep syncing on an interval")
    .option("--interval <duration>", "Watch interval (e.g. 30s, 5m, 1h)", "5m")
    .action(async () => {
      try { serverOnly("emails pull"); } catch (e) { handleError(e); }
    });

  // ─── STATS ────────────────────────────────────────────────────────────────────
  program
    .command("stats")
    .description("Show email delivery statistics")
    .option("-j, --json", "Print JSON output", false)
    .option("--provider <id>", "Provider ID")
    .option("--period <period>", "Period: 7d, 30d, 90d", "30d")
    .option("--inbox", "Show inbound email stats instead of outbound")
    .action(async (opts: { provider?: string; period?: string; inbox?: boolean }) => {
      try {
        if (opts.inbox) {
          throw new Error("emails stats --inbox is not available: the client has no inbound reporting aggregate "
            + "that preserves provider scope and completeness. Outbound totals are not a substitute.");
        }
        const providerId = opts.provider ? resolveId("providers", opts.provider) : undefined;
        const stats = await getLocalStats(providerId, opts.period ?? "30d");
        output(stats, chalk.bold("\nEmail Stats:\n") + formatStatsTable(stats));
      } catch (e) { handleError(e); }
    });

  // ─── MONITOR ──────────────────────────────────────────────────────────────────
  program
    .command("monitor")
    .description("Live monitor with auto-refresh")
    .option("-j, --json", "Print JSON output", false)
    .option("--provider <id>", "Provider ID")
    .option("--interval <seconds>", "Refresh interval in seconds", "30")
    .action(async () => {
      try { serverOnly("emails monitor"); } catch (e) { handleError(e); }
    });

  // ─── ANALYTICS ────────────────────────────────────────────────────────────────
  program
    .command("analytics")
    .description("Show email analytics (daily volume, top recipients, busiest hours, delivery trend)")
    .option("-j, --json", "Print JSON output", false)
    .option("--provider <id>", "Filter by provider ID")
    .option("--period <period>", "Time period (e.g. 30d, 7d, 90d)", "30d")
    .action(async (opts: { provider?: string; period?: string }) => {
      try {
        const providerId = opts.provider ? resolveId("providers", opts.provider) : undefined;
        // The library refuses provider-scoped analytics rather than presenting
        // every provider's messages under one provider's heading.
        const data = await getAnalytics(providerId, opts.period ?? "30d");
        output(data, formatAnalytics(data));
      } catch (e) { handleError(e); }
    });
}

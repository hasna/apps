import type { Command } from "commander";
import { handleError } from "../utils.js";
import { getLocalStats, formatStatsTable } from "../../lib/stats.js";
import { getAnalytics, formatAnalytics } from "../../lib/analytics.js";
import { createConfiguredEmailStore } from "../../store-resolution.js";
import { getInboundStats, formatInboundStats } from "../../lib/inbound-stats.js";

// Provider ingestion still needs its API command handlers.
// Statistics read the same configured store as the rest of the application.
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
    .action(async (opts: { provider?: string; period: string; inbox?: boolean }) => {
      try {
        const store = createConfiguredEmailStore();
        if (opts.inbox) {
          const report = await getInboundStats(opts.period, opts.provider, store);
          output(report, formatInboundStats(report));
        } else {
          const report = await getLocalStats(opts.provider, opts.period, store);
          output(report, "\nEmail Stats:\n" + formatStatsTable(report));
        }
      } catch (e) { handleError(e); }
    });

  // ─── MONITOR ──────────────────────────────────────────────────────────────────
  program
    .command("monitor")
    .description("Live monitor with auto-refresh")
    .option("-j, --json", "Print JSON output", false)
    .option("--provider <id>", "Provider ID")
    .option("--interval <seconds>", "Refresh interval in seconds", "30")
    .option("--once", "Print one report and exit", false)
    .action(async (opts: { provider?: string; interval: string; once?: boolean; json?: boolean }) => {
      let wake: (() => void) | undefined;
      let stopped = false;
      const stop = () => { stopped = true; wake?.(); };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        const seconds = Number(opts.interval);
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) {
          throw new Error("Refresh interval must be between 0 and 86400 seconds.");
        }
        const store = createConfiguredEmailStore();
        while (!stopped) {
          const report = await getLocalStats(opts.provider, "30d", store);
          if (stopped) break;
          if (process.stdout.isTTY && !opts.json && !program.opts().json) process.stdout.write("\x1b[2J\x1b[H");
          output(report, "\nEmail Monitor:\n" + formatStatsTable(report));
          if (opts.once) break;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, seconds * 1000);
            function done() { clearTimeout(timer); wake = undefined; resolve(); }
            wake = done;
            if (stopped) done();
          });
        }
      } catch (e) { handleError(e); }
      finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
    });

  // ─── ANALYTICS ────────────────────────────────────────────────────────────────
  program
    .command("analytics")
    .description("Show email analytics (daily volume, top recipients, busiest hours, delivery trend)")
    .option("-j, --json", "Print JSON output", false)
    .option("--provider <id>", "Filter by provider ID")
    .option("--period <period>", "Time period (e.g. 30d, 7d, 90d)", "30d")
    .action(async (opts: { provider?: string; period: string }) => {
      try {
        const store = createConfiguredEmailStore();
        const report = await getAnalytics(opts.provider, opts.period, { store });
        output(report, formatAnalytics(report));
      } catch (e) { handleError(e); }
    });
}

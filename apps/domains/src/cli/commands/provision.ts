import type { Command } from "commander";
import { deriveDomainState, domainHappyPath } from "../../lib/provision-state.js";
import { getDomainDetail } from "../../lib/route53.js";
import { getZone } from "../../lib/cloudflare.js";

const CF_NS_SUFFIX = ".ns.cloudflare.com";

export function registerProvisionCommand(program: Command): void {
  const provision = program.command("provision").description("Domain provisioning lifecycle");

  provision
    .command("status <name>")
    .description("Show the provisioning state of a domain (derived from live signals)")
    .action(async (name: string) => {
      const signals: Record<string, boolean> = {};
      try {
        const detail = await getDomainDetail(name).catch(() => null);
        signals["registered"] = !!detail;
        const registrarNs = detail?.nameservers ?? [];
        signals["registrarNsAreCloudflare"] = registrarNs.length > 0 && registrarNs.every((n) => n.includes(CF_NS_SUFFIX));
        const zone = await getZone(name).catch(() => null);
        signals["zoneExists"] = !!zone;
        signals["zoneActive"] = zone?.status === "active";
        // public NS resolution
        try {
          const resolved = await (await import("node:dns")).promises.resolveNs(name).catch(() => [] as string[]);
          signals["publicNsAreCloudflare"] = resolved.length > 0 && resolved.every((n) => n.includes(CF_NS_SUFFIX));
        } catch { signals["publicNsAreCloudflare"] = false; }
      } catch (e) {
        console.error(`Error gathering signals: ${e instanceof Error ? e.message : String(e)}`);
      }
      const state = deriveDomainState(signals);
      console.log(`\nDomain: ${name}`);
      console.log(`State:  ${state}`);
      console.log(`Signals: ${JSON.stringify(signals)}`);
      const path = domainHappyPath();
      const idx = path.indexOf(state as never);
      console.log(`Progress: ${idx >= 0 ? idx + 1 : "?"}/${path.length}  [${path.join(" → ")}]`);
    });

  provision
    .command("daemon")
    .description("Reconcile domains toward ready (CF zone + NS delegation + propagation)")
    .option("--domains <list>", "Comma-separated domains (default: all active in the portfolio)")
    .option("--once", "Run a single reconcile tick and exit")
    .option("--interval <sec>", "Seconds between ticks", "30")
    .option("--max-ticks <n>", "Stop after N ticks")
    .action(async (opts: { domains?: string; once?: boolean; interval: string; maxTicks?: string }) => {
      const { applyPurchaseProfile } = await import("../../lib/config.js");
      applyPurchaseProfile();
      const { makeDomainDaemonDeps } = await import("../../lib/domain-daemon-deps.js");
      const { reconcileDomainTick, runDomainDaemon } = await import("../../lib/domain-daemon.js");
      const deps = { ...makeDomainDaemonDeps(), log: (e: string, d: Record<string, unknown>) => console.log(`[${e}] ${JSON.stringify(d)}`) };

      const listDomains = async (): Promise<string[]> => {
        if (opts.domains) return opts.domains.split(",").map((d) => d.trim());
        const { listDomains: dbList } = await import("../../db/domains.js");
        return (await dbList({ status: "active" })).map((d) => d.name);
      };

      if (opts.once) {
        const s = await reconcileDomainTick(await listDomains(), deps);
        console.log(`✓ tick: ${s.advanced} advanced, ${s.ready} ready, ${s.errors} errors (${s.processed} processed)`);
        return;
      }
      console.log(`Domain provisioning daemon started (interval ${opts.interval}s). Ctrl-C to stop.`);
      const total = await runDomainDaemon(listDomains, {
        ...deps,
        intervalSec: parseInt(opts.interval, 10),
        maxTicks: opts.maxTicks ? parseInt(opts.maxTicks, 10) : undefined,
      });
      console.log(`daemon stopped: ${total.advanced} advanced, ${total.ready} ready, ${total.errors} errors`);
    });
}

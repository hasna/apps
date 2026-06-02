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
}

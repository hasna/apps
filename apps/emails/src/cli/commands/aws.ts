/** Account-backed inbound setup and recorded AWS configuration evidence. */
import type { Command } from "commander";
import { handleError } from "../utils.js";
export function registerAwsCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  const aws = program.command("aws").description("Configure server-bound inbound resources and inspect account evidence");
  aws.command("setup-inbound")
    .description("Configure and verify the server-bound SES bucket and receipt rule")
    .requiredOption("--domain <domain>", "Registered receiving domain")
    .option("--bucket <name>", "Bucket selector; defaults to the matching account source")
    .option("--region <region>", "Region selector for the matching account source")
    .option("--prefix <prefix>", "Exact registered source prefix")
    .option("--catch-all", "Legacy subdomain scope; rejected until separately authorized")
    .option("--provider <id>", "Provider selector for the account source")
    .action(async (opts) => { try {
      const { setupSharedInbound } = await import("../../lib/domain-registration-api.js");
      const result = await setupSharedInbound(opts.domain, opts);
      output(result, JSON.stringify(result, null, 2));
      if (!result.ok || !result.verified) process.exitCode = 1;
    } catch (error) { handleError(error); } });
  aws.command("status")
    .description("Read account source/domain records; mark unobserved live AWS configuration as unknown")
    .option("--region <region>", "Filter account sources by region")
    .action(async opts => { try {
      const { sharedInboundStatus } = await import("../../lib/domain-registration-api.js");
      const result = await sharedInboundStatus(opts); output(result, JSON.stringify(result, null, 2));
    } catch (error) { handleError(error); } });
}

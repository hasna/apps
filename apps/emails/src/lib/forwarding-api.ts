import type {
  ForwardingRunOptions,
  ForwardingRunResult,
} from "./forwarding.js";
import { resolveSelfHostedConfig } from "../db/self-hosted-store.js";
import { EmailsSelfHostClient } from "../selfhost.js";

export async function runApiForwarding(
  options: ForwardingRunOptions,
): Promise<ForwardingRunResult> {
  if (options.send)
    throw new Error(
      "An API forwarding run cannot use a local provider callback",
    );
  const config = resolveSelfHostedConfig(process.env, {
    selectedMode: "self_hosted",
  });
  const base = new URL(config.baseUrl);
  base.pathname = base.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const client = new EmailsSelfHostClient({
    baseUrl: base.toString().replace(/\/$/, ""),
    bearerToken: config.credential,
  });
  return (await client.runForwardingBatch({
    limit: options.limit ?? 100,
    ...(options.providerId !== undefined
      ? { provider_id: options.providerId }
      : {}),
    ...(options.fromAddress !== undefined
      ? { from_address: options.fromAddress }
      : {}),
    backfill: options.backfill ?? false,
  })) as ForwardingRunResult;
}

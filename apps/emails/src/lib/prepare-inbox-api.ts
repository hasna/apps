import { listAddresses } from "../db/addresses.js";
import { getAddressProvisioning } from "../db/provisioning.js";
import { resolveResourceIdOrThrow } from "../db/self-hosted-store.js";
import { canonicalSender } from "./email-address.js";
import { enrichAddress } from "./address-ownership.js";
import { provisionAddress } from "./address-provisioning-api.js";

export interface PrepareInboxInput {
  email: string;
  provider_id?: string;
  receive_strategy?: "ses-s3" | "cf-routing" | "resend-webhook";
  forward_to?: string;
  owner?: string;
  administrator?: string;
  create_missing?: boolean;
  idempotency_key?: string;
}

export async function prepareInbox(input: PrepareInboxInput) {
  const email = canonicalSender(input.email);
  if (!email) throw new Error("One valid inbox email address is required");
  if (input.administrator && !input.owner) throw new Error("An administrator requires an owner");
  const provider = input.provider_id === undefined ? undefined : resolveResourceIdOrThrow("providers", input.provider_id);
  const matches = listAddresses(provider).filter(row => row.email.toLowerCase() === email);
  if (matches.length > 1) throw new Error("Ambiguous inbox address; select its provider explicitly");
  const address = matches[0];
  if (!address && !input.create_missing) throw new Error("Inbox address not found; set create_missing and select a provider to provision it");
  const provisioning = address ? await getAddressProvisioning(address.id) : null;
  const receive = input.receive_strategy ?? provisioning?.receive_strategy ?? undefined;
  if (input.forward_to && receive !== "cf-routing") throw new Error("forward_to requires cf-routing");
  const preparing = input.create_missing || input.receive_strategy !== undefined || input.forward_to !== undefined || input.owner !== undefined || input.administrator !== undefined;
  if (preparing) {
    const providerId = provider ?? address?.provider_id;
    if (!providerId) throw new Error("A registered provider is required to prepare an inbox");
    // One server job owns readiness checks, address creation and ownership. No
    // client-side registry writes precede it, so refusals cannot leave partial state.
    return provisionAddress(email, { provider: providerId, receive,
      forwardTo: input.forward_to ?? (receive === "cf-routing" ? provisioning?.forward_to ?? undefined : undefined), owner: input.owner, administrator: input.administrator,
      idempotencyKey: input.idempotency_key });
  }
  return { email, address: await enrichAddress(address!), provisioning,
    source: "account_registry", cli_equivalent: `emails address owner ${email} --json` };
}

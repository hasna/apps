/**
 * Audience / consent / suppression handlers (distribution apps plan).
 *
 * Every handler routes through the single `Store` abstraction (getStore()). No
 * handler touches SQLite (`getDatabase`) or performs raw HTTP directly.
 */
import type { ToolHandler } from "./types.js";
import type {
  AudienceChannel,
  AudienceMatch,
  AudiencePredicate,
  ConsentPolicy,
  ConsentStatus,
} from "../../types/index.js";
import { getStore } from "../../store/index.js";
import { toAudienceContract } from "../../lib/audience-contract.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

export const audienceHandlers: Record<string, ToolHandler> = {
  create_audience: async (a) =>
    json(await getStore().createAudience({
      audience_id: a.audience_id as string,
      name: a.name as string,
      match: a.match as AudienceMatch | undefined,
      predicates: (a.predicates ?? []) as AudiencePredicate[],
      consent_policy: a.consent_policy as ConsentPolicy | undefined,
    })),

  get_audience: async (a) => json(toAudienceContract(await getStore().getAudience(a.id as string))),

  list_audiences: async () => json(await getStore().listAudiences()),

  update_audience: async (a) =>
    json(await getStore().updateAudience(a.id as string, {
      name: a.name as string | undefined,
      match: a.match as AudienceMatch | undefined,
      predicates: a.predicates as AudiencePredicate[] | undefined,
      consent_policy: a.consent_policy as ConsentPolicy | undefined,
    })),

  delete_audience: async (a) => {
    await getStore().deleteAudience(a.id as string);
    return { content: [{ type: "text", text: `Audience ${a.id} deleted successfully` }] };
  },

  resolve_audience: async (a) =>
    json(await getStore().resolveAudience(a.id as string, a.channel as AudienceChannel)),

  set_contact_consent: async (a) =>
    json(await getStore().setContactConsent(
      a.contact_id as string,
      a.channel as AudienceChannel,
      a.status as ConsentStatus,
      a.source as string | undefined,
    )),

  get_contact_consent: async (a) => json(await getStore().listContactConsent(a.contact_id as string)),

  suppress_address: async (a) =>
    json(await getStore().suppressAddress({
      channel: a.channel as AudienceChannel,
      address: a.address as string,
      contact_id: a.contact_id as string | undefined,
      reason: a.reason as string | undefined,
    })),

  unsuppress_address: async (a) => {
    await getStore().unsuppressAddress(a.channel as AudienceChannel, a.address as string);
    return { content: [{ type: "text", text: `Address unsuppressed on ${a.channel as string}` }] };
  },

  list_suppressions: async (a) =>
    json(await getStore().listSuppressions({
      channel: a.channel as AudienceChannel | undefined,
      unsyncedOnly: a.unsynced_only as boolean | undefined,
    })),

  sync_suppressions: async (a) =>
    json(await getStore().syncSuppressions(a.dry_run as boolean | undefined)),
};

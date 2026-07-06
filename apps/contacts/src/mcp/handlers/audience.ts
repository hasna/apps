/**
 * Audience / consent / suppression handlers (distribution apps plan).
 */
import type { ToolHandler } from "./types.js";
import type {
  AudienceChannel,
  AudienceMatch,
  AudiencePredicate,
  ConsentPolicy,
  ConsentStatus,
} from "../../types/index.js";
import {
  createAudience,
  deleteAudience,
  getAudience,
  listAudiences,
  listContactConsent,
  listSuppressions,
  resolveAudience,
  setContactConsent,
  suppressAddress,
  unsuppressAddress,
  updateAudience,
} from "../../db/audiences.js";
import { toAudienceContract } from "../../lib/audience-contract.js";
import { syncSuppressions } from "../../lib/mailery-sync.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

export const audienceHandlers: Record<string, ToolHandler> = {
  create_audience: (a) =>
    json(createAudience({
      audience_id: a.audience_id as string,
      name: a.name as string,
      match: a.match as AudienceMatch | undefined,
      predicates: (a.predicates ?? []) as AudiencePredicate[],
      consent_policy: a.consent_policy as ConsentPolicy | undefined,
    })),

  get_audience: (a) => json(toAudienceContract(getAudience(a.id as string))),

  list_audiences: () => json(listAudiences()),

  update_audience: (a) =>
    json(updateAudience(a.id as string, {
      name: a.name as string | undefined,
      match: a.match as AudienceMatch | undefined,
      predicates: a.predicates as AudiencePredicate[] | undefined,
      consent_policy: a.consent_policy as ConsentPolicy | undefined,
    })),

  delete_audience: (a) => {
    deleteAudience(a.id as string);
    return { content: [{ type: "text", text: `Audience ${a.id} deleted successfully` }] };
  },

  resolve_audience: (a) =>
    json(resolveAudience(a.id as string, a.channel as AudienceChannel)),

  set_contact_consent: (a) =>
    json(setContactConsent(
      a.contact_id as string,
      a.channel as AudienceChannel,
      a.status as ConsentStatus,
      a.source as string | undefined,
    )),

  get_contact_consent: (a) => json(listContactConsent(a.contact_id as string)),

  suppress_address: (a) =>
    json(suppressAddress({
      channel: a.channel as AudienceChannel,
      address: a.address as string,
      contact_id: a.contact_id as string | undefined,
      reason: a.reason as string | undefined,
    })),

  unsuppress_address: (a) => {
    unsuppressAddress(a.channel as AudienceChannel, a.address as string);
    return { content: [{ type: "text", text: `Address unsuppressed on ${a.channel as string}` }] };
  },

  list_suppressions: (a) =>
    json(listSuppressions({
      channel: a.channel as AudienceChannel | undefined,
      unsyncedOnly: a.unsynced_only as boolean | undefined,
    })),

  sync_suppressions: async (a) =>
    json(await syncSuppressions({ dryRun: a.dry_run as boolean | undefined })),
};

/**
 * Vendored minimal mirror of the `hasna.audience.v1` contract from
 * @hasna/contracts (branch feat/distribution-schemas). The upstream package is
 * not published yet, so this file mirrors the schema shape 1:1 (strict object,
 * contract base fields, predicate refinement rules). Once @hasna/contracts
 * ships, this mirror can be replaced with:
 *
 *   import { AudienceSchema, parseContract, SCHEMA_IDS } from "@hasna/contracts/schemas";
 *   parseContract(SCHEMA_IDS.audience, value);
 */
import { z } from "zod";
import type { Audience } from "../types/index.js";

export const AUDIENCE_CONTRACT_SCHEMA_ID = "hasna.audience.v1" as const;

const SlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "audienceId must be a lowercase dashed slug");

const TimestampSchema = z.string().datetime({ offset: true });

const AudiencePredicateValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const AudiencePredicateContractSchema = z
  .object({
    kind: z.enum(["tag", "attribute", "group"]),
    key: z.string().min(1).optional(),
    op: z.enum(["eq", "neq", "in", "not_in", "exists", "not_exists"]).default("eq"),
    value: AudiencePredicateValueSchema.optional(),
    values: z.array(AudiencePredicateValueSchema).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "attribute" && !value.key) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Attribute predicates require key", path: ["key"] });
    }
    if ((value.op === "eq" || value.op === "neq") && value.value === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "eq/neq predicates require value", path: ["value"] });
    }
    if ((value.op === "in" || value.op === "not_in") && value.values.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "in/not_in predicates require values", path: ["values"] });
    }
  });

export const AudienceDefinitionContractSchema = z
  .object({
    match: z.enum(["all", "any"]).default("all"),
    predicates: z.array(AudiencePredicateContractSchema).min(1),
  })
  .strict();

export const ConsentPolicyContractSchema = z.enum(["opt_in", "opt_out", "transactional", "none"]);

export const AudienceContractSchema = z
  .object({
    schema: z.literal(AUDIENCE_CONTRACT_SCHEMA_ID),
    id: z.string().min(1),
    createdAt: TimestampSchema,
    updatedAt: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    audienceId: SlugSchema,
    name: z.string().min(1),
    definition: AudienceDefinitionContractSchema,
    consentPolicy: ConsentPolicyContractSchema,
    suppressionSyncedAt: TimestampSchema.optional(),
  })
  .strict();

export type AudienceContract = z.infer<typeof AudienceContractSchema>;

/** Map a stored audience row to a hasna.audience.v1 contract document. */
export function toAudienceContract(audience: Audience): AudienceContract {
  const doc: Record<string, unknown> = {
    schema: AUDIENCE_CONTRACT_SCHEMA_ID,
    id: audience.id,
    createdAt: new Date(audience.created_at).toISOString(),
    updatedAt: audience.updated_at ? new Date(audience.updated_at).toISOString() : null,
    audienceId: audience.audience_id,
    name: audience.name,
    definition: {
      match: audience.match,
      predicates: audience.predicates.map((p) => ({
        kind: p.kind,
        ...(p.key !== undefined ? { key: p.key } : {}),
        op: p.op ?? "eq",
        ...(p.value !== undefined ? { value: p.value } : {}),
        values: p.values ?? [],
      })),
    },
    consentPolicy: audience.consent_policy,
  };
  if (audience.suppression_synced_at) {
    doc["suppressionSyncedAt"] = new Date(audience.suppression_synced_at).toISOString();
  }
  return AudienceContractSchema.parse(doc);
}

/** Validate an arbitrary value against the vendored hasna.audience.v1 mirror. */
export function validateAudienceContract(value: unknown): { ok: true; value: AudienceContract } | { ok: false; issues: { path: string; message: string }[] } {
  const parsed = AudienceContractSchema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  };
}

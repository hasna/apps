import { z } from "zod";
import { reasoningEffortSchema } from "./reasoning";

/** Model references are opaque provider IDs, never prompts or credentials. */
export const policyModelIdSchema = z.string().min(1).max(300).regex(/^[^\u0000-\u001f\u007f]+$/);
export const modelPolicyRoleSchema = z.enum(["subagent", "fast", "planning", "review", "summary", "compaction", "weak", "editor"]);
export type ModelPolicyRole = z.infer<typeof modelPolicyRoleSchema>;

const boundedModelList = z.array(policyModelIdSchema).max(500);
const aliasSchema=z.string().regex(/^[A-Za-z0-9._/-]{1,120}$/).refine(v=>!["__proto__","prototype","constructor"].includes(v));
const boundedModelMap = z.record(aliasSchema, policyModelIdSchema).superRefine((value, ctx) => {
  if (Object.keys(value).length > 200) ctx.addIssue({code: "custom", message: "Model policy maps may contain at most 200 entries."});
});
const fallbacksSchema = z.record(policyModelIdSchema, z.array(policyModelIdSchema).max(20)).superRefine((value, ctx) => {
  if (Object.keys(value).length > 200) ctx.addIssue({code: "custom", message: "Model policy fallback maps may contain at most 200 entries."});
});

export const modelPolicySchema = z.object({
  version: z.literal(1).default(1),
  roles: z.object({
    subagent: policyModelIdSchema.optional(), fast: policyModelIdSchema.optional(), planning: policyModelIdSchema.optional(),
    review: policyModelIdSchema.optional(), summary: policyModelIdSchema.optional(), compaction: policyModelIdSchema.optional(),
    weak: policyModelIdSchema.optional(), editor: policyModelIdSchema.optional(),
  }).strict().optional(),
  allowedModels: boundedModelList.optional(),
  aliases: boundedModelMap.optional(),
  fallbacks: fallbacksSchema.optional(),
}).strict();
export type ModelPolicy = z.infer<typeof modelPolicySchema>;

export const routingDecisionSchema = z.enum(["allow", "alias", "reject", "fallback"]);
export const routingEventRoleSchema = z.enum(["main", ...modelPolicyRoleSchema.options]);
export const routingEventSchema = z.object({
  at: z.string().datetime({offset: true}),
  requestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  requestedModel: policyModelIdSchema,
  resolvedModel: policyModelIdSchema.optional(),
  reportedModel: policyModelIdSchema.optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  decision: routingDecisionSchema,
  role: routingEventRoleSchema.optional(),
  reason: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
  upstreamStatus: z.number().int().min(100).max(599).optional(),
}).strict();
export type RoutingEvent = z.infer<typeof routingEventSchema>;
export const routingEventsSchema = z.array(routingEventSchema).max(1000);

/** Stable object-key order; ordered fallback arrays retain their precedence. */
export function canonicalPolicyJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

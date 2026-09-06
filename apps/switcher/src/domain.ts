import { z } from "zod";

export const VERSION = "0.1.1";
export const harnessSchema = z.enum(["claude", "codex", "grok", "opencode2", "pi", "omp"]);
export const protocolSchema = z.enum(["anthropic-messages", "openai-responses", "openai-chat"]);
export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
const label = z.string().min(1).max(200);
const envRef = z.string().regex(/^SWITCHER_PROVIDER_[A-Z0-9_]+$/);
export function endpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Fault(400, "invalid_url", "Use an absolute HTTPS URL (HTTP is allowed on loopback)."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash)
    throw new Fault(400, "invalid_url", "URL must use HTTPS, contain no credentials/query/fragment, or use HTTP on loopback.");
  return url.href.replace(/\/+$/, "");
}
const urlSchema = z.string().max(2000).superRefine((v, ctx) => {
  try { endpoint(v); } catch { ctx.addIssue({code: "custom", message: "Invalid endpoint URL"}); }
}).transform(endpoint);
export const modelSchema = z.object({
  id: z.string().min(1).max(300), name: label, description: z.string().max(8000).optional(),
  available: z.boolean().optional(),
  contextWindow: z.number().int().positive().optional(), maxOutputTokens: z.number().int().positive().optional(),
  inputModalities: z.array(z.string().max(50)).max(20).optional(),
  outputModalities: z.array(z.string().max(50)).max(20).optional(),
  supportedParameters: z.array(z.string().max(100)).max(100).optional(),
}).strict();
export const providerInputSchema = z.object({
  id: idSchema, name: label, baseUrl: urlSchema, protocol: protocolSchema,
  credentialEnv: envRef.optional(),
  authStyle: z.enum(["bearer", "x-api-key"]).default("bearer"),
  catalogBaseUrl: urlSchema.optional(),
  catalogFormat: z.enum(["openai", "ollama", "mistral", "together", "fireworks", "dashscope", "none"]).optional(),
  catalogAuthStyle: z.enum(["bearer", "x-api-key", "none"]).optional(),
  catalogCredentialEnv: envRef.optional(),
  catalogAccountId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/).optional(),
  modelsPath: z.string().regex(/^[a-zA-Z0-9_/-]+$/).max(200).default("models"),
  manualModels: z.array(modelSchema).max(10000).default([]),
}).strict().refine(p => !p.modelsPath.split("/").includes("..") && !p.modelsPath.startsWith("/"), "modelsPath must be relative");
export const providerPresetSchema = z.object({
  id: idSchema, name: label, credentialEnv: envRef.optional(),
  credentialAliases: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/)),
  protocols: z.array(z.object({
    protocol: protocolSchema, baseUrl: urlSchema.optional(),
    authStyle: z.enum(["bearer", "x-api-key"]),
    catalogBaseUrl: urlSchema.optional(), catalogFormat: z.enum(["openai", "ollama", "mistral", "together", "fireworks", "dashscope", "none"]),
    catalogAuthStyle: z.enum(["bearer", "x-api-key", "none"]).optional(),
    modelsPath: z.string(), notes: z.array(z.string()),
  }).strict()).min(1),
  sources: z.array(z.string().url()), verification: z.literal("documented"),
}).strict();
export type ProviderPreset = z.infer<typeof providerPresetSchema>;
export const profileInputSchema = z.object({
  id: idSchema, name: label, providerId: idSchema, harness: harnessSchema,
  model: z.string().min(1).max(300),
}).strict();
export const runInputSchema = z.object({
  profileId: idSchema, harness: harnessSchema, model: z.string().min(1).max(300), planToken:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const runUpdateSchema = z.object({
  status: z.enum(["exited", "failed", "interrupted"]),
  exitCode: z.number().int().min(0).max(255),
}).strict();
export type ProviderInput = z.input<typeof providerInputSchema>;
export type Provider = z.output<typeof providerInputSchema> & {version: number; updatedAt: string};
export type ProfileInput = z.infer<typeof profileInputSchema>;
export type Profile = ProfileInput & {version: number; updatedAt: string};
export type Model = z.infer<typeof modelSchema>;
export type Run = z.infer<typeof runInputSchema> & {providerId:string;providerVersion:number;profileVersion:number;id: string; status: "running"|"exited"|"failed"|"interrupted"; startedAt: string; endedAt?: string; exitCode?: number; version: number; updatedAt: string};
export type Catalog = {models: Model[]; refreshedAt: string; source: "remote"|"manual"};
export type LaunchPlan = {planToken:string; profile: Profile; provider: Provider; catalog: Catalog; warnings: string[]};
export class Fault extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export class CommandInterrupted extends Fault {
  constructor(readonly exitCode: number, message: string) { super(499,"interrupted",message); }
}
export function parse<T>(schema: z.ZodType<T, any, any>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Fault(400, "invalid_request", result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  return result.data;
}
export function compatible(harness: Profile["harness"], protocol: Provider["protocol"]) {
  return harness === "claude" ? protocol === "anthropic-messages" : harness === "codex" ? protocol === "openai-responses" : true;
}
export function codingEligible(model: Model): boolean {
  return model.available !== false && (!model.outputModalities || model.outputModalities.includes("text")) &&
    (!model.supportedParameters || model.supportedParameters.includes("tools"));
}

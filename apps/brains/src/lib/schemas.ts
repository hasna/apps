import { z } from "zod";

export const ProviderSchema = z.enum(["openai", "thinker-labs"], {
  errorMap: () => ({ message: "Invalid provider. Must be one of: openai, thinker-labs" }),
});

export const FinetuneStartSchema = z.object({
  provider: ProviderSchema,
  baseModel: z.string().min(1, "Base model is required"),
  dataset: z.string().optional(),
  name: z.string().min(1, "Name is required"),
});

export const GatherOptionsSchema = z.object({
  source: z.enum(["todos", "mementos", "conversations", "sessions", "all"]).default("all"),
  output: z.string().optional(),
  limit: z.coerce.number().int().positive("Limit must be a positive integer").default(500),
});

export const ModelUpdateSchema = z.object({
  displayName: z.string().optional(),
  description: z.string().optional(),
  collection: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const McpGatherSchema = z.object({
  sources: z.array(z.enum(["todos", "mementos", "conversations", "sessions"])).min(1, "At least one source required"),
  limit: z.number().int().positive().optional(),
  output_dir: z.string().optional(),
});

export const McpFinetuneStartSchema = z.object({
  provider: ProviderSchema,
  base_model: z.string().min(1, "Base model is required"),
  dataset_path: z.string().optional(),
  name: z.string().optional(),
});

export const McpFinetuneStatusSchema = z.object({
  job_id: z.string().min(1, "Job ID is required"),
  provider: ProviderSchema,
});

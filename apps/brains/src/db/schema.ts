import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const fineTunedModels = sqliteTable("fine_tuned_models", {
  id: text("id").primaryKey(),
  baseModel: text("base_model").notNull(),
  name: text("name").notNull(),
  provider: text("provider", { enum: ["openai", "thinker-labs"] }).notNull(),
  status: text("status", {
    enum: ["pending", "running", "succeeded", "failed", "cancelled"],
  })
    .notNull()
    .default("pending"),
  fineTuneJobId: text("fine_tune_job_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const trainingJobs = sqliteTable("training_jobs", {
  id: text("id").primaryKey(),
  modelId: text("model_id")
    .notNull()
    .references(() => fineTunedModels.id),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  metrics: text("metrics"), // JSON blob
  error: text("error"),
});

export const trainingDatasets = sqliteTable("training_datasets", {
  id: text("id").primaryKey(),
  source: text("source", {
    enum: ["todos", "mementos", "conversations", "sessions", "mixed"],
  }).notNull(),
  filePath: text("file_path").notNull(),
  exampleCount: integer("example_count").notNull(),
  createdAt: integer("created_at").notNull(),
  usedInJobId: text("used_in_job_id").references(() => trainingJobs.id),
});

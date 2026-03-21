#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { eq, desc } from "drizzle-orm";
import { getDb, fineTunedModels, trainingDatasets } from "../db/index.js";
import { OpenAIProvider } from "../lib/providers/openai.js";
import { ThinkerLabsProvider } from "../lib/providers/thinker-labs.js";
import { gatherFromTodos } from "../lib/gatherers/todos.js";
import { gatherFromMementos } from "../lib/gatherers/mementos.js";
import { gatherFromConversations } from "../lib/gatherers/conversations.js";
import { gatherFromSessions } from "../lib/gatherers/sessions.js";
import type { TrainingExample } from "../lib/gatherers/types.js";
import { getPackageVersion } from "../lib/package-metadata.js";
import { McpGatherSchema, McpFinetuneStartSchema, McpFinetuneStatusSchema } from "../lib/schemas.js";

// --- helpers ---

function getProvider(provider: string) {
  if (provider === "openai") return new OpenAIProvider();
  if (provider === "thinker-labs") return new ThinkerLabsProvider();
  throw new Error(`Unknown provider: ${provider}`);
}

function defaultOutputDir() {
  return resolve(homedir(), ".brains", "datasets");
}

// --- server ---

export const MCP_SERVER_INFO = {
  name: "brains",
  version: getPackageVersion(),
} as const;

export function createMcpServer() {
  // Fellow agents: keep MCP/server versioning sourced from package.json to avoid publish drift.
  const server = new Server(MCP_SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_models",
        description: "List all fine-tuned models tracked in the local DB",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get_model",
        description: "Get details for a specific fine-tuned model",
        inputSchema: {
          type: "object",
          properties: {
            model_id: { type: "string", description: "Model ID" },
          },
          required: ["model_id"],
        },
      },
      {
        name: "start_finetune",
        description: "Upload a training file and start a fine-tuning job",
        inputSchema: {
          type: "object",
          properties: {
            provider: {
              type: "string",
              enum: ["openai", "thinker-labs"],
              description: "Provider to use for fine-tuning",
            },
            base_model: {
              type: "string",
              description: "Base model identifier (e.g. gpt-4o-mini-2024-07-18)",
            },
            dataset_path: {
              type: "string",
              description: "Absolute path to the JSONL training file (auto-detects latest if omitted)",
            },
            name: {
              type: "string",
              description: "Optional friendly name for this model",
            },
          },
          required: ["provider", "base_model"],
        },
      },
      {
        name: "get_finetune_status",
        description: "Check the status of a fine-tuning job",
        inputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string", description: "Fine-tune job ID" },
            provider: {
              type: "string",
              enum: ["openai", "thinker-labs"],
              description: "Provider that owns the job",
            },
          },
          required: ["job_id", "provider"],
        },
      },
      {
        name: "gather_training_data",
        description:
          "Gather training data from ecosystem sources (todos, mementos, conversations, sessions)",
        inputSchema: {
          type: "object",
          properties: {
            sources: {
              type: "array",
              items: { type: "string" },
              description: "Sources to gather from: todos, mementos, conversations, sessions",
            },
            limit: {
              type: "number",
              description: "Max examples per source (default: unlimited)",
            },
            output_dir: {
              type: "string",
              description: "Directory to write JSONL files (default: ~/.brains/datasets/)",
            },
          },
          required: ["sources"],
        },
      },
      {
        name: "preview_training_data",
        description: "Preview examples from a JSONL training file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to the JSONL file to preview",
            },
            limit: {
              type: "number",
              description: "Max number of examples to return (default: 5)",
            },
          },
          required: ["file_path"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
      case "list_models": {
        const db = getDb();
        const models = await db
          .select({
            id: fineTunedModels.id,
            name: fineTunedModels.name,
            provider: fineTunedModels.provider,
            status: fineTunedModels.status,
            base_model: fineTunedModels.baseModel,
            created_at: fineTunedModels.createdAt,
          })
          .from(fineTunedModels)
          .orderBy(fineTunedModels.createdAt);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(models, null, 2),
            },
          ],
        };
      }

      case "get_model": {
        const { model_id } = args as { model_id: string };
        const db = getDb();
        const results = await db
          .select()
          .from(fineTunedModels)
          .where(eq(fineTunedModels.id, model_id));

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: `Model not found: ${model_id}` }],
            isError: true,
          };
        }

        return {
          content: [
            { type: "text", text: JSON.stringify(results[0], null, 2) },
          ],
        };
      }

      case "start_finetune": {
        const parsed = McpFinetuneStartSchema.safeParse(args);
        if (!parsed.success) {
          return { content: [{ type: "text", text: parsed.error.issues.map(i => i.message).join("; ") }], isError: true };
        }
        const { provider, base_model, dataset_path, name: modelName } = parsed.data;

        let resolvedPath: string;
        if (dataset_path) {
          resolvedPath = resolve(dataset_path);
        } else {
          const db = getDb();
          const [latest] = await db
            .select()
            .from(trainingDatasets)
            .orderBy(desc(trainingDatasets.createdAt))
            .limit(1);
          if (!latest?.filePath) {
            return {
              content: [{ type: "text", text: "No datasets found. Run gather_training_data first." }],
              isError: true,
            };
          }
          resolvedPath = latest.filePath;
        }

        if (!existsSync(resolvedPath)) {
          return {
            content: [
              {
                type: "text",
                text: `Dataset file not found: ${resolvedPath}`,
              },
            ],
            isError: true,
          };
        }

        const p = getProvider(provider);
        const { fileId } = await p.uploadTrainingFile(resolvedPath);
        const { jobId, status } = await p.createFineTuneJob(
          fileId,
          base_model,
          modelName
        );

        // Persist to local DB
        const db = getDb();
        const now = Date.now();
        const id = `${provider}-${jobId}`;
        await db.insert(fineTunedModels).values({
          id,
          name: modelName ?? `${base_model}-finetune-${now}`,
          provider,
          baseModel: base_model,
          status: "pending",
          fineTuneJobId: jobId,
          createdAt: now,
          updatedAt: now,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ job_id: jobId, status, model_db_id: id }, null, 2),
            },
          ],
        };
      }

      case "get_finetune_status": {
        const parsed = McpFinetuneStatusSchema.safeParse(args);
        if (!parsed.success) {
          return { content: [{ type: "text", text: parsed.error.issues.map(i => i.message).join("; ") }], isError: true };
        }
        const { job_id, provider } = parsed.data;

        const p = getProvider(provider);
        const result = await p.getFineTuneStatus(job_id);

        // Update local DB if we have a record
        const db = getDb();
        const dbId = `${provider}-${job_id}`;
        const existing = await db
          .select()
          .from(fineTunedModels)
          .where(eq(fineTunedModels.id, dbId));

        if (existing.length > 0) {
          const mappedStatus = (() => {
            if (result.status === "succeeded") return "succeeded" as const;
            if (result.status === "failed") return "failed" as const;
            if (result.status === "cancelled") return "cancelled" as const;
            if (result.status === "running") return "running" as const;
            return "pending" as const;
          })();

          await db
            .update(fineTunedModels)
            .set({
              status: mappedStatus,
              updatedAt: Date.now(),
            })
            .where(eq(fineTunedModels.id, dbId));
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  job_id: result.jobId,
                  status: result.status,
                  model_id: result.fineTunedModel,
                  error: result.error,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "gather_training_data": {
        const parsed = McpGatherSchema.safeParse(args);
        if (!parsed.success) {
          return { content: [{ type: "text", text: parsed.error.issues.map(i => i.message).join("; ") }], isError: true };
        }
        const { sources, limit, output_dir } = parsed.data;

        const { mkdirSync, writeFileSync } = await import("fs");
        const { join } = await import("path");

        const outDir = output_dir ?? defaultOutputDir();
        mkdirSync(outDir, { recursive: true });

        const datasets: Array<{ source: string; count: number; file_path: string }> = [];
        let totalExamples = 0;

        for (const source of sources) {
          let examples: TrainingExample[] = [];

          if (source === "todos") {
            const result = await gatherFromTodos({ limit });
            examples = result.examples;
          } else if (source === "mementos") {
            const result = await gatherFromMementos({ limit });
            examples = result.examples;
          } else if (source === "conversations") {
            const result = await gatherFromConversations({ limit });
            examples = result.examples;
          } else if (source === "sessions") {
            const result = await gatherFromSessions({ limit });
            examples = result.examples;
          } else {
            examples = [];
          }

          const filePath = join(outDir, `${source}-${Date.now()}.jsonl`);
          const jsonl = examples.map((ex) => JSON.stringify(ex)).join("\n");
          writeFileSync(filePath, jsonl, "utf-8");

          datasets.push({ source, count: examples.length, file_path: filePath });
          totalExamples += examples.length;
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ datasets, total_examples: totalExamples }, null, 2),
            },
          ],
        };
      }

      case "preview_training_data": {
        const { file_path, limit = 5 } = args as {
          file_path: string;
          limit?: number;
        };

        const resolvedPath = resolve(file_path);
        if (!existsSync(resolvedPath)) {
          return {
            content: [
              { type: "text", text: `File not found: ${resolvedPath}` },
            ],
            isError: true,
          };
        }

        const content = readFileSync(resolvedPath, "utf-8");
        const lines = content
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        const total = lines.length;
        const examples: TrainingExample[] = lines
          .slice(0, limit)
          .map((line) => JSON.parse(line) as TrainingExample);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ examples, total }, null, 2),
            },
          ],
        };
      }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startMcpServer(transport = new StdioServerTransport()) {
  const server = createMcpServer();
  await server.connect(transport);
  return server;
}

if (import.meta.main) {
  await startMcpServer();
}

// Card Executor — process each card type into file system actions

import type { OmpCard, OmpDocument, LLMClient, CardContext } from "../types/index.js";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";

export interface ExecutionAction {
  type: "create-file" | "run-command" | "create-dir" | "llm-generate";
  path?: string;
  content?: string;
  command?: string;
  description: string;
}

export interface CardExecutionResult {
  cardId: string;
  cardType: string;
  actions: ExecutionAction[];
  llmCalls: number;
  success: boolean;
  error?: string;
}

/**
 * Execute a single card — extract structured data from headers,
 * pass NL body to LLM for implementation, generate file system actions.
 */
export async function executeCard(
  card: OmpCard,
  document: OmpDocument,
  llm: LLMClient | undefined,
  outputDir: string,
  dryRun: boolean = false
): Promise<CardExecutionResult> {
  const actions: ExecutionAction[] = [];
  let llmCalls = 0;

  try {
    switch (card.type) {
      case "project": {
        // Deterministic: create project directory structure
        const framework = String(card.headers["framework"] ?? "");
        if (framework) {
          actions.push({
            type: "create-dir",
            path: outputDir,
            description: `Create project directory for ${card.id}`,
          });
          if (!dryRun) {
            const { mkdirSync: mk } = await import("fs");
            mk(outputDir, { recursive: true });
          }
        }
        break;
      }

      case "tree": {
        // Fully deterministic: parse indented tree → mkdir + touch
        const treeActions = parseTree(card.body.raw, outputDir);
        actions.push(...treeActions);
        if (!dryRun) {
          for (const action of treeActions) {
            if (action.type === "create-dir" && action.path) {
              mkdirSync(action.path, { recursive: true });
            } else if (action.type === "create-file" && action.path) {
              mkdirSync(dirname(action.path), { recursive: true });
              if (!existsSync(action.path)) {
                writeFileSync(action.path, "");
              }
            }
          }
        }
        break;
      }

      case "table": {
        // Extract columns from markdown table, then LLM generates schema file
        const db = String(card.headers["db"] ?? "");
        if (llm && card.body.tables.length > 0) {
          const context = buildContext(card, document);
          const prompt = `Generate a database schema file for this table.
Table name: ${card.id}
Database reference: ${db}
Columns:
${card.body.tables[0].rows.map((r) => `  ${r.join(" | ")}`).join("\n")}

${card.body.text}`;
          const code = await llm.complete(prompt, context);
          llmCalls++;
          actions.push({
            type: "llm-generate",
            content: code,
            description: `Generate schema for table ${card.id}`,
          });
        }
        break;
      }

      case "endpoint": {
        // Extract method/path/auth deterministically, LLM fills implementation
        const method = String(card.headers["method"] ?? "");
        const path = String(card.headers["path"] ?? "");
        const auth = String(card.headers["auth"] ?? "none");

        if (llm) {
          const context = buildContext(card, document);
          const prompt = `Generate a route handler for this API endpoint.
Method: ${method}
Path: ${path}
Auth: ${auth}
${card.headers["body"] ? `Request body: ${JSON.stringify(card.headers["body"])}` : ""}
${card.headers["params"] ? `Query params: ${card.headers["params"]}` : ""}

Behavior:
${card.body.text}

${card.accepts.length ? `Requirements: ${card.accepts.join("; ")}` : ""}`;
          const code = await llm.complete(prompt, context);
          llmCalls++;
          actions.push({
            type: "llm-generate",
            content: code,
            description: `Generate ${method} ${path} handler`,
          });
        }
        break;
      }

      case "page": {
        const pagePath = String(card.headers["path"] ?? "");
        const auth = String(card.headers["auth"] ?? "none");

        if (llm) {
          const context = buildContext(card, document);
          const prompt = `Generate a page component.
Route: ${pagePath}
Auth required: ${auth}

Description:
${card.body.text}

${card.accepts.length ? `Requirements: ${card.accepts.join("; ")}` : ""}`;
          const code = await llm.complete(prompt, context);
          llmCalls++;
          actions.push({
            type: "llm-generate",
            content: code,
            description: `Generate page ${pagePath}`,
          });
        }
        break;
      }

      case "layout": {
        if (llm) {
          const context = buildContext(card, document);
          const prompt = `Generate a layout component.
${card.headers["nav"] ? `Navigation: ${JSON.stringify(card.headers["nav"])}` : ""}

Description:
${card.body.text}

${card.accepts.length ? `Requirements: ${card.accepts.join("; ")}` : ""}`;
          const code = await llm.complete(prompt, context);
          llmCalls++;
          actions.push({
            type: "llm-generate",
            content: code,
            description: `Generate layout ${card.id}`,
          });
        }
        break;
      }

      case "functions": {
        // Deterministic: extract function signatures, LLM fills bodies
        const file = String(card.headers["file"] ?? "");
        const exports = card.headers["exports"];

        if (llm) {
          const context = buildContext(card, document);
          const prompt = `Generate a TypeScript module at ${file}.
Exported functions:
${Array.isArray(exports) ? exports.map((e) => `  - ${e}`).join("\n") : JSON.stringify(exports)}

Context:
${card.body.text}

${card.accepts.length ? `Requirements: ${card.accepts.join("; ")}` : ""}`;
          const code = await llm.complete(prompt, context);
          llmCalls++;

          if (file && !dryRun) {
            const fullPath = join(outputDir, file);
            mkdirSync(dirname(fullPath), { recursive: true });
            writeFileSync(fullPath, code);
          }

          actions.push({
            type: "create-file",
            path: file,
            content: code,
            description: `Generate functions module ${file}`,
          });
        }
        break;
      }

      case "seed": {
        if (llm) {
          const context = buildContext(card, document);
          const users = card.headers["users"];
          const prompt = `Generate a database seed script.
${users ? `Users to create: ${JSON.stringify(users)}` : ""}
${card.headers["sample-notes"] ? `Sample notes: ${card.headers["sample-notes"]}` : ""}
${card.headers["sample-tags"] ? `Sample tags: ${JSON.stringify(card.headers["sample-tags"])}` : ""}

Instructions:
${card.body.text}

${card.accepts.length ? `Requirements: ${card.accepts.join("; ")}` : ""}`;
          const code = await llm.complete(prompt, context);
          llmCalls++;
          actions.push({
            type: "llm-generate",
            content: code,
            description: `Generate seed script for ${card.id}`,
          });
        }
        break;
      }

      case "database":
      case "migration":
      case "auth":
      case "component":
      case "middleware":
      case "test":
      case "deploy":
      case "cron":
      case "job":
      case "email":
      case "call":
      case "monitor":
      case "custom":
      default: {
        // Generic: pass everything to LLM with full context
        if (llm && card.body.raw.trim()) {
          const context = buildContext(card, document);
          const prompt = `Execute this OMP card.
Type: ${card.type}
Id: ${card.id}
Headers: ${JSON.stringify(card.headers)}

Instructions:
${card.body.text}

${card.accepts.length ? `Requirements: ${card.accepts.join("; ")}` : ""}`;
          const code = await llm.complete(prompt, context);
          llmCalls++;
          actions.push({
            type: "llm-generate",
            content: code,
            description: `Execute ${card.type} card ${card.id}`,
          });
        }
        break;
      }
    }

    return { cardId: card.id, cardType: card.type, actions, llmCalls, success: true };
  } catch (error) {
    return {
      cardId: card.id,
      cardType: card.type,
      actions,
      llmCalls,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parse an indented tree structure into file system actions.
 */
function parseTree(raw: string, baseDir: string): ExecutionAction[] {
  const actions: ExecutionAction[] = [];
  const lines = raw.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.endsWith("/")) {
      // Directory
      actions.push({
        type: "create-dir",
        path: join(baseDir, trimmed),
        description: `Create directory ${trimmed}`,
      });
    } else if (trimmed.includes(".")) {
      // File (has extension)
      actions.push({
        type: "create-file",
        path: join(baseDir, trimmed),
        description: `Create file ${trimmed}`,
      });
    }
  }

  return actions;
}

/**
 * Build card context for LLM calls.
 */
function buildContext(card: OmpCard, document: OmpDocument): CardContext {
  const relatedCards = document.cards.filter((c) => card.depends.includes(c.id));
  return { card, relatedCards, document };
}

// Pipeline — main orchestrator: parse → resolve → expand → validate → compile → execute

import type {
  OmpDocument,
  OmpCard,
  OmpConfig,
  OmpExecutionResult,
  OmpError,
  LLMClient,
  OmpPattern,
} from "../types/index.js";
import { splitCards, extractTitle } from "../parser/splitter.js";
import { parseHeader } from "../parser/header-parser.js";
import { parseBody } from "../parser/body-parser.js";
import { parseDirectives, type ParsedDirective } from "../parser/directive-parser.js";
import { resolveImports } from "../parser/import-resolver.js";
import { expandPattern } from "../parser/pattern-expander.js";
import { validateDocument } from "../validator/validate.js";
import { buildDAG, compileExecutionPlan } from "../compiler/dag.js";
import { resolveInlineDirectives } from "../executor/inline-executor.js";
import { executeCard } from "../executor/card-executor.js";
import { readFileSync } from "fs";
import { resolve } from "path";

export interface PipelineOptions {
  outputDir?: string;
  dryRun?: boolean;
  verbose?: boolean;
  llm?: LLMClient;
  onProgress?: (msg: string) => void;
}

/**
 * Parse an OMP document from a file path.
 */
export function parseFromFile(filePath: string): OmpDocument {
  const absolutePath = resolve(filePath);
  const raw = readFileSync(absolutePath, "utf-8");
  return parseFromString(raw, absolutePath);
}

/**
 * Parse an OMP document from a string.
 */
export function parseFromString(raw: string, filePath: string = "inline.omp.md"): OmpDocument {
  // Step 1: Resolve imports recursively
  const resolved = resolveImports(raw, filePath);

  // Step 2: Collect patterns and directives from all cards
  const allPatterns: OmpPattern[] = [...resolved.patterns];
  const allDirectives: ParsedDirective[] = [];

  for (const card of resolved.cards) {
    const { directives, patterns } = parseDirectives(card.body.raw, card.lineNumber);
    allPatterns.push(...patterns);

    // Expand pattern instantiations
    for (const dir of directives) {
      if (dir.kind === "instantiate") {
        const expanded = expandPattern(dir as any, allPatterns);
        for (const exp of expanded) {
          const header = parseHeader(exp.raw, 0);
          const body = parseBody(header.bodyRaw, 0);
          const expandedCard: OmpCard = {
            type: header.type as any,
            id: header.id,
            depends: header.depends,
            headers: header.headers,
            body,
            accepts: extractAccepts(header.bodyRaw),
            sourceFile: filePath,
            lineNumber: 0,
          };
          resolved.cards.push(expandedCard);
        }
      }
    }
  }

  const title = extractTitle(raw.split("\n---\n")[0] ?? "");

  const doc: OmpDocument = {
    title,
    cards: resolved.cards,
    patterns: allPatterns,
    imports: [],
    errors: resolved.errors.map((e) => ({
      level: "error" as const,
      message: e,
    })),
  };

  return doc;
}

/**
 * Validate a parsed OMP document.
 */
export function validate(doc: OmpDocument): OmpError[] {
  return validateDocument(doc);
}

/**
 * Compile a parsed OMP document into an execution plan.
 */
export function compile(doc: OmpDocument) {
  const dag = buildDAG(doc.cards);
  return compileExecutionPlan(dag);
}

/**
 * Full pipeline: parse → validate → compile → execute.
 */
export async function run(
  filePath: string,
  options: PipelineOptions = {}
): Promise<OmpExecutionResult> {
  const start = Date.now();
  const log = options.onProgress ?? (() => {});
  const outputDir = options.outputDir ?? ".";
  const dryRun = options.dryRun ?? false;

  // Parse
  log("Parsing document...");
  const doc = parseFromFile(filePath);

  if (doc.errors.length > 0) {
    const errorMsgs = doc.errors.filter((e) => e.level === "error");
    if (errorMsgs.length > 0) {
      return {
        success: false,
        cardsExecuted: 0,
        cardsTotal: doc.cards.length,
        errors: doc.errors,
        filesCreated: [],
        commandsRun: [],
        llmCalls: 0,
        llmTokens: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  // Validate
  log("Validating...");
  const validationErrors = validate(doc);
  const fatalErrors = validationErrors.filter((e) => e.level === "error");
  if (fatalErrors.length > 0) {
    return {
      success: false,
      cardsExecuted: 0,
      cardsTotal: doc.cards.length,
      errors: validationErrors,
      filesCreated: [],
      commandsRun: [],
      llmCalls: 0,
      llmTokens: 0,
      durationMs: Date.now() - start,
    };
  }

  // Compile DAG
  log("Building execution plan...");
  const dag = buildDAG(doc.cards);
  const plan = compileExecutionPlan(dag);
  log(`Execution plan: ${plan.steps.length} steps, ${plan.totalCards} cards`);

  // Execute
  let cardsExecuted = 0;
  let totalLlmCalls = 0;
  const allErrors: OmpError[] = [...validationErrors];
  const filesCreated: string[] = [];
  const commandsRun: string[] = [];

  for (let i = 0; i < dag.order.length; i++) {
    const group = dag.order[i];
    log(`Step ${i + 1}/${dag.order.length}: ${group.join(", ")}${group.length > 1 ? " (parallel)" : ""}`);

    // Resolve {{}} directives for cards in this group
    for (const cardId of group) {
      const card = dag.nodes.get(cardId);
      if (!card) continue;

      // Resolve inline directives
      const resolvedBody = await resolveInlineDirectives(card, doc, options.llm);
      card.body.raw = resolvedBody;
      card.body.text = resolvedBody;

      // Execute the card
      const result = await executeCard(card, doc, options.llm, outputDir, dryRun);

      if (result.success) {
        cardsExecuted++;
        totalLlmCalls += result.llmCalls;
        for (const action of result.actions) {
          if (action.path) filesCreated.push(action.path);
          if (action.command) commandsRun.push(action.command);
        }
      } else {
        allErrors.push({
          level: "error",
          message: result.error ?? `Card ${cardId} execution failed`,
          card: cardId,
        });
      }

      log(`  ${result.success ? "✓" : "✗"} ${cardId} (${result.actions.length} actions, ${result.llmCalls} LLM calls)`);
    }
  }

  return {
    success: allErrors.filter((e) => e.level === "error").length === 0,
    cardsExecuted,
    cardsTotal: doc.cards.length,
    errors: allErrors,
    filesCreated,
    commandsRun,
    llmCalls: totalLlmCalls,
    llmTokens: 0,
    durationMs: Date.now() - start,
  };
}

/**
 * Extract accepts: lines from raw body text.
 */
function extractAccepts(bodyRaw: string): string[] {
  const accepts: string[] = [];
  for (const line of bodyRaw.split("\n")) {
    const match = line.trim().match(/^accepts:\s*(.+)$/);
    if (match) {
      accepts.push(...match[1].split(";").map((s) => s.trim()).filter(Boolean));
    }
  }
  return accepts;
}

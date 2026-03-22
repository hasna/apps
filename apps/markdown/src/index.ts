// Open Markdown Protocol (OMP) — Public API

// ─── Types ───────────────────────────────────────────────────
export type {
  OmpDocument,
  OmpCard,
  OmpBody,
  OmpTable,
  OmpValue,
  OmpListItem,
  OmpInlineDirective,
  OmpDirective,
  OmpImport,
  OmpPattern,
  OmpPatternInstance,
  OmpRepeat,
  OmpConditional,
  OmpUse,
  OmpEmit,
  OmpHook,
  OmpDAG,
  OmpExecutionPlan,
  OmpExecutionStep,
  OmpExecutionResult,
  OmpError,
  OmpConfig,
  CardContext,
  LLMClient,
  LLMClientOptions,
  CardType,
  DirectiveKind,
  ErrorLevel,
  BuiltinTool,
} from "./types/index.js";

export { CARD_TYPES, BUILTIN_TOOLS } from "./types/index.js";

// ─── Parser ──────────────────────────────────────────────────
export { splitCards, extractTitle } from "./parser/splitter.js";
export { parseHeader } from "./parser/header-parser.js";
export type { ParsedHeader } from "./parser/header-parser.js";
export { parseBody, extractTables, extractInlineDirectives, extractAccepts } from "./parser/body-parser.js";
export { parseDirectives } from "./parser/directive-parser.js";
export type { ParsedDirective } from "./parser/directive-parser.js";
export { resolveImports } from "./parser/import-resolver.js";
export type { ResolvedDocument } from "./parser/import-resolver.js";
export { expandPattern, expandAllPatterns, getBuiltinPatternNames } from "./parser/pattern-expander.js";
export type { ExpandedCard } from "./parser/pattern-expander.js";

// ─── Compiler ────────────────────────────────────────────────
export { buildDAG, compileExecutionPlan, getEntryPoints, getLeafNodes, DAGCycleError } from "./compiler/dag.js";

// ─── Validator ───────────────────────────────────────────────
export { validateDocument, lintDocument, validateAndLint } from "./validator/validate.js";

// ─── Executor ────────────────────────────────────────────────
export { resolveInlineDirectives, resolveBuiltinTool } from "./executor/inline-executor.js";
export { executeCard } from "./executor/card-executor.js";
export type { ExecutionAction, CardExecutionResult } from "./executor/card-executor.js";

// ─── LLM Client ──────────────────────────────────────────────
export { createLLMClient, buildPrompt, MockLLMClient } from "./lib/llm-client.js";

// ─── Pipeline ────────────────────────────────────────────────
export { parseFromFile, parseFromString, validate, compile, run } from "./lib/pipeline.js";
export type { PipelineOptions } from "./lib/pipeline.js";

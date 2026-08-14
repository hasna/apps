// OMP v1 Types — Open Markdown Protocol

// ─── Card Types ──────────────────────────────────────────────

export const CARD_TYPES = [
  "project", "database", "table", "migration", "auth",
  "endpoint", "page", "layout", "component", "functions",
  "tree", "middleware", "test", "seed", "deploy",
  "cron", "job", "email", "call", "monitor", "custom",
] as const;

export type CardType = (typeof CARD_TYPES)[number];

// ─── Core Document ───────────────────────────────────────────

export interface OmpDocument {
  title: string;
  cards: OmpCard[];
  patterns: OmpPattern[];
  imports: OmpImport[];
  errors: OmpError[];
}

export interface OmpCard {
  type: CardType | string;
  id: string;
  depends: string[];
  headers: Record<string, OmpValue>;
  body: OmpBody;
  accepts: string[];
  sourceFile: string;
  lineNumber: number;
}

export type OmpValue =
  | string
  | number
  | boolean
  | string[]
  | OmpListItem[]
  | Record<string, string>;

export interface OmpListItem {
  key: string;
  value: string;
  children?: OmpListItem[];
}

// ─── Body ────────────────────────────────────────────────────

export interface OmpBody {
  raw: string;
  text: string;
  tables: OmpTable[];
  inlineDirectives: OmpInlineDirective[];
}

export interface OmpTable {
  headers: string[];
  rows: string[][];
  lineNumber: number;
}

export interface OmpInlineDirective {
  raw: string;
  content: string;
  isBuiltinTool: boolean;
  toolName?: string;
  toolArgs?: string[];
  start: number;
  end: number;
}

// ─── @ Directives ────────────────────────────────────────────

export type DirectiveKind =
  | "import"
  | "pattern"
  | "instantiate"
  | "repeat"
  | "if"
  | "use"
  | "emit"
  | "hook";

export interface OmpDirective {
  kind: DirectiveKind;
  raw: string;
  lineNumber: number;
}

export interface OmpImport extends OmpDirective {
  kind: "import";
  path: string;
  resolved?: OmpDocument;
}

export interface OmpPattern {
  name: string;
  params: string[];
  bodyTemplate: string;
  lineNumber: number;
}

export interface OmpPatternInstance extends OmpDirective {
  kind: "instantiate";
  patternName: string;
  args: Record<string, string>;
}

export interface OmpRepeat extends OmpDirective {
  kind: "repeat";
  count: number;
}

export interface OmpConditional extends OmpDirective {
  kind: "if";
  condition: string;
}

export interface OmpUse extends OmpDirective {
  kind: "use";
  tool: string;
}

export interface OmpEmit extends OmpDirective {
  kind: "emit";
  event: string;
}

export interface OmpHook extends OmpDirective {
  kind: "hook";
  timing: "before" | "after";
  targetId: string;
}

// ─── DAG / Execution ─────────────────────────────────────────

export interface OmpDAG {
  nodes: Map<string, OmpCard>;
  edges: Map<string, string[]>;
  order: string[][];
}

export interface OmpExecutionPlan {
  steps: OmpExecutionStep[];
  totalCards: number;
}

export interface OmpExecutionStep {
  parallel: string[];
  description: string;
}

export interface OmpExecutionResult {
  success: boolean;
  cardsExecuted: number;
  cardsTotal: number;
  errors: OmpError[];
  filesCreated: string[];
  commandsRun: string[];
  llmCalls: number;
  llmTokens: number;
  durationMs: number;
}

// ─── Errors ──────────────────────────────────────────────────

export type ErrorLevel = "error" | "warning" | "info";

export interface OmpError {
  level: ErrorLevel;
  message: string;
  line?: number;
  card?: string;
  file?: string;
}

// ─── LLM Client ──────────────────────────────────────────────

export interface CardContext {
  card: OmpCard;
  relatedCards: OmpCard[];
  document: OmpDocument;
}

export interface LLMClient {
  complete(prompt: string, context?: CardContext): Promise<string>;
  provider: string;
  model: string;
}

export interface LLMClientOptions {
  provider: "anthropic" | "openai" | "ollama";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

// ─── Config ──────────────────────────────────────────────────

export interface OmpConfig {
  llm: LLMClientOptions;
  outputDir: string;
  dryRun: boolean;
  verbose: boolean;
  maxParallel: number;
}

// ─── Built-in Tools ──────────────────────────────────────────

export const BUILTIN_TOOLS = [
  "random", "uuid", "timestamp", "env", "ref",
  "count", "index", "hash",
] as const;

export type BuiltinTool = (typeof BUILTIN_TOOLS)[number];

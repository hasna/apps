// ─── Verdict ──────────────────────────────────────────────────────────────────

export type Verdict = "PASS" | "FAIL" | "UNKNOWN";

// ─── Adapter configs ──────────────────────────────────────────────────────────

export interface HttpAdapterConfig {
  type: "http";
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  /** Path into request body where the input message goes, e.g. "messages[-1].content" */
  inputPath?: string;
  /** Path into response body where the output text lives, e.g. "choices[0].message.content" */
  outputPath?: string;
  timeoutMs?: number;
}

export interface AnthropicAdapterConfig {
  type: "anthropic";
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
  apiKey?: string; // falls back to ANTHROPIC_API_KEY env
}

export interface OpenAIAdapterConfig {
  type: "openai";
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
  baseURL?: string; // for Ollama / custom endpoints
  apiKey?: string; // falls back to OPENAI_API_KEY env
}

export interface McpAdapterConfig {
  type: "mcp";
  /** Command to start the MCP server, e.g. ["node", "dist/mcp/index.js"] */
  command: string[];
  /** Tool name to call */
  tool: string;
  /** How to map the EvalCase input into tool arguments */
  inputMapping?: Record<string, string>;
  timeoutMs?: number;
}

export interface FunctionAdapterConfig {
  type: "function";
  /** Absolute path to module */
  modulePath: string;
  /** Named export to call */
  exportName?: string; // defaults to "default"
}

export interface CliAdapterConfig {
  type: "cli";
  /** Command template — use {{input}} as placeholder */
  command: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export type AdapterConfig =
  | HttpAdapterConfig
  | AnthropicAdapterConfig
  | OpenAIAdapterConfig
  | McpAdapterConfig
  | FunctionAdapterConfig
  | CliAdapterConfig;

// ─── Assertions ───────────────────────────────────────────────────────────────

export type AssertionType =
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "equals"
  | "regex"
  | "not_regex"
  | "max_length"
  | "min_length"
  | "json_valid"
  | "json_schema"
  | "tool_called"
  | "tool_not_called"
  | "tool_call_count"
  | "tool_args_match"
  | "response_time_ms"
  | "token_count"
  | "cost_usd"
  | "semantic_similarity";

export interface Assertion {
  type: AssertionType;
  /** The value to check against — type depends on assertion type */
  value?: string | number | boolean | Record<string, unknown>;
  /** For range-based assertions */
  min?: number;
  max?: number;
  /** For semantic_similarity — 0.0 to 1.0, default 0.8 */
  threshold?: number;
  /** Human-readable label for reports */
  label?: string;
}

export interface AssertionResult {
  type: AssertionType;
  passed: boolean;
  reason: string;
  label?: string;
  durationMs?: number;
}

// ─── Judge ────────────────────────────────────────────────────────────────────

export interface JudgeConfig {
  /** Plain-English grading criteria. Required. */
  rubric: string;
  /** Judge model. Default: claude-sonnet-4-6 */
  model?: string;
  /** Judge provider. Default: anthropic */
  provider?: "anthropic" | "openai";
  /** API key override — falls back to env */
  apiKey?: string;
}

export interface JudgeResult {
  verdict: Verdict;
  /** Chain-of-thought reasoning — always present before verdict */
  reasoning: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

// ─── Eval case (single-turn and multi-turn) ───────────────────────────────────

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  /** For assistant turns: what the expected behavior should be (natural language) */
  expected?: string;
}

export interface EvalCase {
  id: string;
  /** Single-turn: plain string input */
  input?: string;
  /** Multi-turn: conversation turns. If present, input is ignored. */
  turns?: ConversationTurn[];
  /** Natural language description of expected output (for judge) */
  expected?: string;
  /** Adapter config override — falls back to run-level config */
  adapter?: AdapterConfig;
  assertions?: Assertion[];
  judge?: JudgeConfig;
  /** Run this case N times and report pass_rate (Pass^k metric) */
  repeat?: number;
  /** Minimum pass rate for Pass^k to be considered passing (0.0–1.0, default 1.0) */
  passThreshold?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// ─── Eval result (per case) ───────────────────────────────────────────────────

export interface EvalResult {
  caseId: string;
  verdict: Verdict;
  /** Raw output from the app under test */
  output: string;
  /** For multi-turn: all turn outputs */
  turnOutputs?: string[];
  assertionResults: AssertionResult[];
  judgeResult?: JudgeResult;
  /** For Pass^k: individual verdicts per repeat */
  repeatVerdicts?: Verdict[];
  passRate?: number;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  error?: string;
}

// ─── Eval run (full dataset run) ─────────────────────────────────────────────

export interface EvalRunStats {
  total: number;
  passed: number;
  failed: number;
  unknown: number;
  errors: number;
  passRate: number;
  totalDurationMs: number;
  totalCostUsd: number;
  totalTokens: number;
}

export interface EvalRun {
  id: string;
  createdAt: string;
  dataset: string;
  adapterConfig?: AdapterConfig;
  results: EvalResult[];
  stats: EvalRunStats;
  /** Named baseline tag if set */
  baselineName?: string;
}

// ─── Run options ──────────────────────────────────────────────────────────────

export interface RunOptions {
  dataset: string;
  adapter?: AdapterConfig;
  concurrency?: number;
  tags?: string[];
  skipJudge?: boolean;
  repeat?: number;
  outputFormat?: "terminal" | "json" | "markdown";
  verbose?: boolean;
}

export interface CiOptions extends RunOptions {
  baselineName?: string;
  baselineRunId?: string;
  failIfRegressionPct?: number;
}

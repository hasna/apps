import Ajv from "ajv";
import type { Assertion, AssertionResult } from "../types/index.js";

const ajv = new Ajv();

// Cost order: deterministic (free) → semantic (embedding call) → nothing heavier here
// The runner decides when to call the judge based on assertion results.

const CHEAPEST_FIRST_ORDER: string[] = [
  "equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "regex",
  "not_regex",
  "max_length",
  "min_length",
  "json_valid",
  "json_schema",
  "tool_called",
  "tool_not_called",
  "tool_call_count",
  "tool_args_match",
  "response_time_ms",
  "token_count",
  "cost_usd",
  "semantic_similarity", // requires embedding call — runs last
];

export function sortAssertionsCheapestFirst(assertions: Assertion[]): Assertion[] {
  return [...assertions].sort((a, b) => {
    const ai = CHEAPEST_FIRST_ORDER.indexOf(a.type);
    const bi = CHEAPEST_FIRST_ORDER.indexOf(b.type);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

export interface AssertionContext {
  output: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>;
}

export async function runAssertion(
  assertion: Assertion,
  ctx: AssertionContext
): Promise<AssertionResult> {
  const start = Date.now();

  try {
    const result = await evaluate(assertion, ctx);
    return {
      type: assertion.type,
      passed: result.passed,
      reason: result.reason,
      label: assertion.label,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      type: assertion.type,
      passed: false,
      reason: `Assertion threw: ${err instanceof Error ? err.message : String(err)}`,
      label: assertion.label,
      durationMs: Date.now() - start,
    };
  }
}

export async function runAssertions(
  assertions: Assertion[],
  ctx: AssertionContext
): Promise<AssertionResult[]> {
  const sorted = sortAssertionsCheapestFirst(assertions);
  const results: AssertionResult[] = [];

  for (const assertion of sorted) {
    const result = await runAssertion(assertion, ctx);
    results.push(result);
    // Short-circuit: stop on first failure for deterministic assertions
    // (semantic_similarity still runs even if earlier ones failed — it's expensive)
    if (!result.passed && assertion.type !== "semantic_similarity") {
      // Mark remaining as skipped
      const remaining = sorted.slice(sorted.indexOf(assertion) + 1);
      for (const rem of remaining) {
        results.push({
          type: rem.type,
          passed: false,
          reason: "Skipped — earlier assertion failed",
          label: rem.label,
        });
      }
      break;
    }
  }

  return results;
}

export function assertionsPassed(results: AssertionResult[]): boolean {
  return results.every((r) => r.passed || r.reason === "Skipped — earlier assertion failed"
    ? false
    : true
  );
}

export function allAssertionsPassed(results: AssertionResult[]): boolean {
  return results.every((r) => r.passed);
}

// ─── Individual evaluators ────────────────────────────────────────────────────

async function evaluate(
  a: Assertion,
  ctx: AssertionContext
): Promise<{ passed: boolean; reason: string }> {
  const out = ctx.output;
  const val = a.value;

  switch (a.type) {
    case "equals": {
      const passed = out === String(val ?? "");
      return { passed, reason: passed ? "Output matches exactly" : `Expected "${val}", got "${out.slice(0, 100)}"` };
    }

    case "contains": {
      const needle = String(val ?? "");
      const passed = out.includes(needle);
      return { passed, reason: passed ? `Output contains "${needle}"` : `Output does not contain "${needle}"` };
    }

    case "not_contains": {
      const needle = String(val ?? "");
      const passed = !out.includes(needle);
      return { passed, reason: passed ? `Output does not contain "${needle}"` : `Output contains forbidden string "${needle}"` };
    }

    case "starts_with": {
      const prefix = String(val ?? "");
      const passed = out.startsWith(prefix);
      return { passed, reason: passed ? `Output starts with "${prefix}"` : `Output does not start with "${prefix}"` };
    }

    case "ends_with": {
      const suffix = String(val ?? "");
      const passed = out.endsWith(suffix);
      return { passed, reason: passed ? `Output ends with "${suffix}"` : `Output does not end with "${suffix}"` };
    }

    case "regex": {
      const pattern = new RegExp(String(val ?? ""));
      const passed = pattern.test(out);
      return { passed, reason: passed ? `Output matches /${val}/` : `Output does not match /${val}/` };
    }

    case "not_regex": {
      const pattern = new RegExp(String(val ?? ""));
      const passed = !pattern.test(out);
      return { passed, reason: passed ? `Output does not match /${val}/` : `Output matches forbidden pattern /${val}/` };
    }

    case "max_length": {
      const max = Number(val ?? a.max ?? 0);
      const passed = out.length <= max;
      return { passed, reason: passed ? `Length ${out.length} ≤ ${max}` : `Length ${out.length} exceeds max ${max}` };
    }

    case "min_length": {
      const min = Number(val ?? a.min ?? 0);
      const passed = out.length >= min;
      return { passed, reason: passed ? `Length ${out.length} ≥ ${min}` : `Length ${out.length} below min ${min}` };
    }

    case "json_valid": {
      try {
        JSON.parse(out);
        return { passed: true, reason: "Output is valid JSON" };
      } catch {
        return { passed: false, reason: "Output is not valid JSON" };
      }
    }

    case "json_schema": {
      try {
        const parsed = JSON.parse(out);
        const schema = val as Record<string, unknown>;
        const validate = ajv.compile(schema);
        const valid = validate(parsed);
        return {
          passed: !!valid,
          reason: valid ? "Output matches JSON schema" : `Schema validation failed: ${ajv.errorsText(validate.errors)}`,
        };
      } catch (e) {
        return { passed: false, reason: `JSON parse or schema error: ${e}` };
      }
    }

    case "tool_called": {
      const toolName = String(val ?? "");
      const calls = ctx.toolCalls ?? [];
      const passed = calls.some((c) => c.name === toolName);
      return { passed, reason: passed ? `Tool "${toolName}" was called` : `Tool "${toolName}" was not called` };
    }

    case "tool_not_called": {
      const toolName = String(val ?? "");
      const calls = ctx.toolCalls ?? [];
      const passed = !calls.some((c) => c.name === toolName);
      return { passed, reason: passed ? `Tool "${toolName}" was not called` : `Forbidden tool "${toolName}" was called` };
    }

    case "tool_call_count": {
      const calls = ctx.toolCalls ?? [];
      const count = calls.length;
      const min = a.min ?? 0;
      const max = a.max ?? Infinity;
      const passed = count >= min && count <= max;
      return {
        passed,
        reason: passed
          ? `Tool call count ${count} in range [${min}, ${max === Infinity ? "∞" : max}]`
          : `Tool call count ${count} outside range [${min}, ${max === Infinity ? "∞" : max}]`,
      };
    }

    case "tool_args_match": {
      const toolName = String((val as Record<string, unknown>)?.["tool"] ?? "");
      const expectedArgs = (val as Record<string, unknown>)?.["args"] as Record<string, unknown> | undefined;
      const calls = ctx.toolCalls ?? [];
      const call = calls.find((c) => c.name === toolName);
      if (!call) return { passed: false, reason: `Tool "${toolName}" was not called` };
      if (!expectedArgs) return { passed: true, reason: `Tool "${toolName}" was called` };
      const mismatches: string[] = [];
      for (const [k, v] of Object.entries(expectedArgs)) {
        if (call.arguments?.[k] !== v) mismatches.push(`${k}: expected "${v}", got "${call.arguments?.[k]}"`);
      }
      return {
        passed: mismatches.length === 0,
        reason: mismatches.length === 0 ? `Tool "${toolName}" args match` : `Tool args mismatch: ${mismatches.join(", ")}`,
      };
    }

    case "response_time_ms": {
      const maxMs = Number(a.max ?? val ?? 0);
      const actual = ctx.durationMs ?? 0;
      const passed = actual <= maxMs;
      return { passed, reason: passed ? `Response time ${actual}ms ≤ ${maxMs}ms` : `Response time ${actual}ms exceeds ${maxMs}ms` };
    }

    case "token_count": {
      const total = (ctx.inputTokens ?? 0) + (ctx.outputTokens ?? 0);
      const min = a.min ?? 0;
      const max = a.max ?? Infinity;
      const passed = total >= min && total <= max;
      return {
        passed,
        reason: passed
          ? `Token count ${total} in range [${min}, ${max === Infinity ? "∞" : max}]`
          : `Token count ${total} outside range [${min}, ${max === Infinity ? "∞" : max}]`,
      };
    }

    case "cost_usd": {
      const maxCost = Number(a.max ?? val ?? 0);
      const actual = ctx.costUsd ?? 0;
      const passed = actual <= maxCost;
      return { passed, reason: passed ? `Cost $${actual.toFixed(4)} ≤ $${maxCost}` : `Cost $${actual.toFixed(4)} exceeds $${maxCost}` };
    }

    case "semantic_similarity": {
      // Requires ANTHROPIC_API_KEY or OPENAI_API_KEY for embeddings
      // Falls back to simple overlap heuristic if no API key available
      const threshold = a.threshold ?? 0.8;
      const expected = String(val ?? "");
      const similarity = await computeSemanticSimilarity(out, expected);
      const passed = similarity >= threshold;
      return {
        passed,
        reason: passed
          ? `Semantic similarity ${similarity.toFixed(3)} ≥ ${threshold}`
          : `Semantic similarity ${similarity.toFixed(3)} below threshold ${threshold}`,
      };
    }

    default:
      return { passed: false, reason: `Unknown assertion type: ${(a as Assertion).type}` };
  }
}

// ─── Semantic similarity (embedding cosine or fallback) ───────────────────────

async function computeSemanticSimilarity(a: string, b: string): Promise<number> {
  // Try OpenAI embeddings first (text-embedding-3-small is cheap)
  const openaiKey = process.env["OPENAI_API_KEY"];
  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: [a, b] }),
      });
      const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
      const [va, vb] = data.data.map((d) => d.embedding);
      if (va && vb) return cosineSimilarity(va, vb);
    } catch {
      // fall through to heuristic
    }
  }

  // Fallback: Jaccard similarity on word tokens
  return jaccardSimilarity(a, b);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(Boolean));
  const setA = tokenize(a);
  const setB = tokenize(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 1 : intersection.size / union.size;
}

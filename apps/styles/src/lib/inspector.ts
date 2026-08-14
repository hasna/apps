import { readFileSync, existsSync } from "fs";
import type { StyleProfile } from "./profiles.js";

export interface AIViolation {
  line?: number;
  rule: string;
  message: string;
  severity: "critical" | "warning" | "info";
}

export interface InspectionResult {
  filePath: string;
  violations: AIViolation[];
  suggestions: string[];
}

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";
const CEREBRAS_MODEL = "llama-3.3-70b";
const MAX_FILE_BYTES = 50 * 1024; // 50 KB

// ── Availability check ────────────────────────────────────────────────────────

export function isCerebrasAvailable(): boolean {
  return Boolean(process.env["CEREBRAS_API_KEY"]);
}

// ── Prompt building ──────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return [
    "You are a design systems expert and code reviewer.",
    "Your job is to identify style and design violations in UI code.",
    "Respond ONLY with valid JSON — no markdown, no explanations, no code fences.",
    'The JSON must match: { "violations": [{ "line": number|null, "rule": string, "message": string, "severity": "critical"|"warning"|"info" }], "suggestions": string[] }',
  ].join("\n");
}

function buildUserPrompt(
  filePath: string,
  content: string,
  profile: StyleProfile
): string {
  const principlesText =
    profile.principles.length > 0
      ? `Design principles:\n${profile.principles.map((p) => `  - ${p}`).join("\n")}`
      : "";

  const antiPatternsText =
    profile.antiPatterns.length > 0
      ? `Anti-patterns to detect:\n${profile.antiPatterns.map((p) => `  - ${p}`).join("\n")}`
      : "";

  return [
    `File: ${filePath}`,
    `Style profile: ${profile.displayName} (${profile.category})`,
    principlesText,
    antiPatternsText,
    "",
    "Analyze the following file for design system violations and provide improvement suggestions.",
    "Be specific about line numbers when possible.",
    "",
    "```",
    content,
    "```",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// ── AI call ───────────────────────────────────────────────────────────────────

interface CerebrasResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

interface ParsedAIResponse {
  violations: AIViolation[];
  suggestions: string[];
}

async function callCerebras(
  systemPrompt: string,
  userPrompt: string
): Promise<ParsedAIResponse> {
  const apiKey = process.env["CEREBRAS_API_KEY"];
  if (!apiKey) {
    throw new Error("CEREBRAS_API_KEY is not set");
  }

  const response = await fetch(CEREBRAS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CEREBRAS_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Cerebras API error ${response.status}: ${errorText.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as CerebrasResponse;
  const rawContent = data.choices?.[0]?.message?.content ?? "";

  // Strip markdown code fences if the model added them despite instructions
  const cleaned = rawContent
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const parsed = JSON.parse(cleaned) as Partial<ParsedAIResponse>;

  return {
    violations: Array.isArray(parsed.violations) ? parsed.violations : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function inspectFile(
  filePath: string,
  profile: StyleProfile
): Promise<InspectionResult> {
  const empty: InspectionResult = { filePath, violations: [], suggestions: [] };

  if (!isCerebrasAvailable()) return empty;
  if (!existsSync(filePath)) return empty;

  let content: string;
  try {
    const buffer = readFileSync(filePath);
    if (buffer.length > MAX_FILE_BYTES) {
      // Truncate to first MAX_FILE_BYTES bytes to avoid huge prompts
      content = buffer.slice(0, MAX_FILE_BYTES).toString("utf-8");
    } else {
      content = buffer.toString("utf-8");
    }
  } catch {
    return empty;
  }

  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(filePath, content, profile);
    const result = await callCerebras(systemPrompt, userPrompt);
    return { filePath, ...result };
  } catch {
    return empty;
  }
}

export async function inspectProject(
  projectPath: string,
  options: { maxFiles?: number } = {}
): Promise<InspectionResult[]> {
  if (!isCerebrasAvailable()) return [];

  const { readdirSync, statSync } = await import("fs");
  const { join, extname } = await import("path");
  const { getActiveProfile } = await import("./profiles.js");

  const profile = getActiveProfile(projectPath);
  if (!profile) return [];

  const SCANNABLE = new Set([".tsx", ".jsx", ".ts", ".js", ".css", ".vue"]);
  const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "out",
    ".cache",
    "coverage",
  ]);

  function collectFiles(dir: string, acc: string[] = []): string[] {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return acc;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(fullPath, acc);
      } else if (entry.isFile() && SCANNABLE.has(extname(entry.name))) {
        acc.push(fullPath);
      }
    }
    return acc;
  }

  const allFiles = collectFiles(projectPath);
  const filesToScan = options.maxFiles
    ? allFiles.slice(0, options.maxFiles)
    : allFiles;

  const results: InspectionResult[] = [];

  for (const file of filesToScan) {
    const result = await inspectFile(file, profile);
    if (result.violations.length > 0 || result.suggestions.length > 0) {
      results.push(result);
    }
  }

  return results;
}

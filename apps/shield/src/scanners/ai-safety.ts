import * as fs from "fs";
import * as path from "path";
import {
  type Scanner,
  type FindingInput,
  type ScannerRunOptions,
  ScannerType,
  Severity,
  DEFAULT_CONFIG,
} from "../types/index.js";
import { walkDirectory, getCodeSnippet } from "./secrets.js";

// --- AI safety patterns ---

interface AiPattern {
  id: string;
  name: string;
  pattern: RegExp;
  severity: Severity;
  message: string;
}

const AI_PATTERNS: AiPattern[] = [
  // Unsanitized user input in LLM prompts
  {
    id: "ai-prompt-injection-concat",
    name: "Prompt Injection (String Concat)",
    pattern: /(?:system|prompt|messages?)\s*[=:+]\s*.*(?:req\.|request\.|body\.|params\.|query\.|user[_.]?input|input)/gi,
    severity: Severity.High,
    message: "User input concatenated into LLM prompt — potential prompt injection",
  },
  {
    id: "ai-prompt-injection-template",
    name: "Prompt Injection (Template Literal)",
    pattern: /(?:system|prompt|content)\s*[=:]\s*`[^`]*\$\{(?:.*(?:req|request|body|params|query|user|input))/gi,
    severity: Severity.High,
    message: "User input interpolated into LLM prompt template — potential prompt injection",
  },

  // Missing output validation from LLM
  {
    id: "ai-unvalidated-output",
    name: "Unvalidated LLM Output",
    pattern: /(?:await\s+)?(?:openai|anthropic|client|llm|ai|chat)\.(?:chat|complete|generate|create)\s*\([^)]*\)\s*(?:\.\s*(?:then|data|choices|content|text))+/gi,
    severity: Severity.Medium,
    message: "LLM response used without validation — add try/catch and validate output schema",
  },

  // System prompt in client-side code
  {
    id: "ai-client-system-prompt",
    name: "System Prompt in Client Code",
    pattern: /(?:system|role\s*:\s*['"]system['"])\s*[=:]\s*['"`][^'"`]{20,}['"`]/gi,
    severity: Severity.Medium,
    message: "System prompt appears to be in client-side code — move to server-side to prevent leakage",
  },

  // Hardcoded AI API keys
  {
    id: "ai-hardcoded-openai-key",
    name: "Hardcoded OpenAI Key",
    pattern: /\b(sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,})\b/g,
    severity: Severity.Critical,
    message: "Hardcoded OpenAI API key detected",
  },
  {
    id: "ai-hardcoded-anthropic-key",
    name: "Hardcoded Anthropic Key",
    pattern: /\b(sk-ant-[A-Za-z0-9\-_]{20,})\b/g,
    severity: Severity.Critical,
    message: "Hardcoded Anthropic API key detected",
  },

  // No rate limiting on AI endpoints
  {
    id: "ai-no-rate-limit",
    name: "AI Endpoint Without Rate Limiting",
    pattern: /(?:app|router)\s*\.(?:post|get)\s*\(\s*['"`][^'"`]*(?:ai|llm|chat|complete|generate|prompt)[^'"`]*['"`]/gi,
    severity: Severity.Medium,
    message: "AI endpoint detected — ensure rate limiting is applied to prevent abuse",
  },

  // PII near AI API calls
  {
    id: "ai-pii-email",
    name: "PII in AI Context (Email)",
    pattern: /(?:email|e[-_]?mail)\s*.*(?:openai|anthropic|llm|ai|chat|prompt|message|content)/gi,
    severity: Severity.Medium,
    message: "Email data may be sent to AI service — ensure PII is scrubbed from prompts",
  },
  {
    id: "ai-pii-ssn",
    name: "PII in AI Context (SSN)",
    pattern: /(?:ssn|social_security|social[-_]security)\s*.*(?:openai|anthropic|llm|ai|chat|prompt|message)/gi,
    severity: Severity.High,
    message: "SSN data may be sent to AI service — ensure PII is scrubbed from prompts",
  },
  {
    id: "ai-pii-credit-card",
    name: "PII in AI Context (Credit Card)",
    pattern: /(?:credit[-_]?card|card[-_]?number|cc[-_]?num)\s*.*(?:openai|anthropic|llm|ai|chat|prompt|message)/gi,
    severity: Severity.High,
    message: "Credit card data may be sent to AI service — ensure PII is scrubbed from prompts",
  },

  // Unsafe tool_use / function_calling
  {
    id: "ai-unsafe-tool-use",
    name: "Unsafe Tool Use / Function Calling",
    pattern: /(?:tools|functions|tool_choice|function_call)\s*[=:]\s*(?:\[|\{)[^}\]]*(?:exec|eval|spawn|system|shell|child_process|rm|delete|drop)/gi,
    severity: Severity.Critical,
    message: "AI tool/function calling includes dangerous operations — add constraints and validation",
  },
  {
    id: "ai-unconstrained-tools",
    name: "Unconstrained Tool Use",
    pattern: /tool_choice\s*[=:]\s*['"](?:auto|any|required)['"]/gi,
    severity: Severity.Low,
    message: "AI tool_choice is unconstrained — consider restricting available tools",
  },
];

const AI_CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py"]);

// Additional check: client-side file heuristic
function isLikelyClientSide(filePath: string): boolean {
  const parts = filePath.toLowerCase();
  return (
    parts.includes("/components/") ||
    parts.includes("/pages/") ||
    parts.includes("/app/") ||
    parts.includes("/client/") ||
    parts.includes("/frontend/") ||
    parts.includes("/public/") ||
    parts.endsWith(".tsx") ||
    parts.endsWith(".jsx")
  );
}

function scanFile(filePath: string, content: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const lines = content.split("\n");

  // Quick check: skip files with no AI-related content
  const lowerContent = content.toLowerCase();
  const hasAiContent =
    lowerContent.includes("openai") ||
    lowerContent.includes("anthropic") ||
    lowerContent.includes("llm") ||
    lowerContent.includes("prompt") ||
    lowerContent.includes("system") ||
    lowerContent.includes("chat") ||
    lowerContent.includes("tool_choice") ||
    lowerContent.includes("function_call");

  if (!hasAiContent) return findings;

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const lineNum = i + 1;

    // Skip lines with security-ignore suppression comment
    if (lineText.includes("security-ignore")) continue;

    const trimmed = lineText.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) continue;

    for (const ap of AI_PATTERNS) {
      ap.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = ap.pattern.exec(lineText)) !== null) {
        // Special handling: system prompt in client-side only
        if (ap.id === "ai-client-system-prompt" && !isLikelyClientSide(filePath)) {
          continue;
        }

        findings.push({
          rule_id: ap.id,
          scanner_type: ScannerType.AiSafety,
          severity: ap.severity,
          file: filePath,
          line: lineNum,
          column: match.index + 1,
          message: ap.message,
          code_snippet: getCodeSnippet(content, lineNum),
        });
      }
    }
  }

  return findings;
}

export const aiSafetyScanner: Scanner = {
  name: "AI Safety Scanner",
  type: ScannerType.AiSafety,
  description: "Detects AI/LLM security issues including prompt injection, PII exposure, and unsafe tool use",

  async scan(scanPath: string, options?: ScannerRunOptions): Promise<FindingInput[]> {
    const ignorePatterns = options?.ignore_patterns ?? DEFAULT_CONFIG.ignore_patterns;
    const files = walkDirectory(scanPath, ignorePatterns, (filePath) =>
      AI_CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
    );
    const findings: FindingInput[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const relativePath = path.relative(scanPath, file);
        findings.push(...scanFile(relativePath, content));
      } catch {
        // Skip unreadable files
      }
    }

    return findings;
  },
};

export default aiSafetyScanner;

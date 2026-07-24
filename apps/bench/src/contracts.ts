import { z } from "zod";

const isoDateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Expected a real calendar date in YYYY-MM-DD format");
const idSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use lowercase ids with letters, numbers, dots, underscores, or dashes");
const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "Expected semver, for example 1.0.0");

// Legacy local schema id. New shared schema ids are minted by @hasna/contracts
// under hasna.*; bench.manifest.v1 remains supported until the namespace
// convergence decision is implemented in a later pass.
export const manifestSchemaVersionSchema = z.literal("bench.manifest.v1");

export const benchmarkCategorySchema = z.enum([
  "llm-knowledge-reasoning",
  "coding",
  "tool-use",
  "agent-browser-computer",
  "rag",
  "safety",
  "latency-cost",
  "multimodal",
  "custom"
]);

export const adapterStatusSchema = z.enum([
  "planned",
  "candidate",
  "dry-run",
  "runnable",
  "verified",
  "deprecated"
]);

export const runnerKindSchema = z.enum([
  "python-cli",
  "node-cli",
  "docker",
  "api",
  "dataset",
  "leaderboard",
  "custom"
]);

export const runnerCapabilitySchema = z.enum([
  "dry-run",
  "local-execution",
  "remote-api",
  "docker",
  "network",
  "sandbox",
  "judge-model",
  "dataset-download",
  "browser",
  "tool-use",
  "code-execution",
  "streaming",
  "cost-tracking",
  "artifact-capture"
]);

export const safetyClassSchema = z.enum([
  "offline-safe",
  "networked",
  "sandbox-required",
  "dual-use",
  "restricted"
]);

export const sourceTypeSchema = z.enum([
  "github",
  "git",
  "dataset",
  "paper",
  "website",
  "package",
  "docker",
  "other"
]);

export const licenseStatusSchema = z.enum(["verified", "declared", "unknown", "restricted"]);

export const metricDirectionSchema = z.enum([
  "higher-is-better",
  "lower-is-better",
  "target",
  "informational"
]);

export const sourceRefSchema = z.object({
  type: sourceTypeSchema,
  url: z.string().url(),
  repository: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  packageName: z.string().min(1).optional(),
  citation: z.string().min(1).optional(),
  verifiedAt: isoDateSchema.optional()
}).strict();

export const licenseMetadataSchema = z.object({
  spdxId: z.string().min(1).optional(),
  name: z.string().min(1),
  url: z.string().url().optional(),
  status: licenseStatusSchema,
  requiresAttribution: z.boolean().default(false),
  notes: z.string().min(1).optional()
}).strict();

export const metricSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  direction: metricDirectionSchema
}).strict();

export const runnerSchema = z.object({
  kind: runnerKindSchema,
  command: z.array(z.string().min(1)).optional(),
  packageName: z.string().min(1).optional(),
  minVersion: z.string().min(1).optional(),
  capabilities: z.array(runnerCapabilitySchema).default([]),
  requiresNetwork: z.boolean().default(false),
  requiresSandbox: z.boolean().default(false),
  supportsDryRun: z.boolean().default(false),
  expectedArtifacts: z.array(z.string().min(1)).default([])
}).strict();

export const adapterSchema = z.object({
  status: adapterStatusSchema,
  packageName: z.string().min(1).optional(),
  entrypoint: z.string().min(1).optional(),
  notes: z.string().min(1).optional()
}).strict();

export const safetyMetadataSchema = z.object({
  class: safetyClassSchema,
  allowsNetwork: z.boolean().default(false),
  requiresSandbox: z.boolean().default(false),
  requiresSecrets: z.boolean().default(false),
  costRisk: z.enum(["none", "low", "medium", "high"]).default("low"),
  notes: z.string().min(1).optional()
}).strict();

export const benchmarkManifestSchema = z.object({
  schemaVersion: manifestSchemaVersionSchema.default("bench.manifest.v1"),
  id: idSchema,
  manifestVersion: semverSchema,
  upstreamVersion: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  category: benchmarkCategorySchema,
  homepageUrl: z.string().url().optional(),
  sources: z.array(sourceRefSchema).min(1),
  license: licenseMetadataSchema,
  runner: runnerSchema,
  metrics: z.array(metricSchema).min(1),
  adapter: adapterSchema,
  safety: safetyMetadataSchema,
  tags: z.array(z.string().min(1)).default([]),
  maintainers: z.array(z.string().min(1)).default([]),
  notes: z.string().min(1).optional()
}).strict().superRefine((manifest, context) => {
  const capabilities = new Set(manifest.runner.capabilities);
  const runnerRequiresNetwork = manifest.runner.requiresNetwork || capabilities.has("network") || capabilities.has("remote-api");
  const runnerRequiresSandbox =
    manifest.runner.requiresSandbox ||
    capabilities.has("sandbox") ||
    capabilities.has("docker") ||
    capabilities.has("code-execution") ||
    capabilities.has("browser");

  if (manifest.runner.supportsDryRun && !capabilities.has("dry-run")) {
    context.addIssue({
      code: "custom",
      path: ["runner", "capabilities"],
      message: "Runner that supports dry runs must include the dry-run capability"
    });
  }

  if (runnerRequiresNetwork && !manifest.safety.allowsNetwork) {
    context.addIssue({
      code: "custom",
      path: ["safety", "allowsNetwork"],
      message: "Networked runners must set safety.allowsNetwork=true"
    });
  }

  if (runnerRequiresNetwork && manifest.safety.class === "offline-safe") {
    context.addIssue({
      code: "custom",
      path: ["safety", "class"],
      message: "Networked runners cannot be classified as offline-safe"
    });
  }

  if (runnerRequiresSandbox && !manifest.safety.requiresSandbox) {
    context.addIssue({
      code: "custom",
      path: ["safety", "requiresSandbox"],
      message: "Sandboxed, Docker, browser, or code-execution runners must set safety.requiresSandbox=true"
    });
  }

  if (runnerRequiresSandbox && !["sandbox-required", "restricted"].includes(manifest.safety.class)) {
    context.addIssue({
      code: "custom",
      path: ["safety", "class"],
      message: "Sandboxed, Docker, browser, or code-execution runners must use safety.class sandbox-required or restricted"
    });
  }

  if (manifest.safety.class === "offline-safe") {
    if (manifest.safety.allowsNetwork || manifest.safety.requiresSandbox || manifest.safety.requiresSecrets) {
      context.addIssue({
        code: "custom",
        path: ["safety", "class"],
        message: "offline-safe manifests cannot require network, sandbox, or secrets"
      });
    }

    if (manifest.safety.costRisk !== "none") {
      context.addIssue({
        code: "custom",
        path: ["safety", "costRisk"],
        message: "offline-safe manifests must use costRisk=none"
      });
    }
  }
});

export type BenchmarkManifest = z.infer<typeof benchmarkManifestSchema>;
export type BenchmarkManifestInput = z.input<typeof benchmarkManifestSchema>;
export type BenchmarkCategory = z.infer<typeof benchmarkCategorySchema>;
export type AdapterStatus = z.infer<typeof adapterStatusSchema>;
export type RunnerCapability = z.infer<typeof runnerCapabilitySchema>;
export type SafetyClass = z.infer<typeof safetyClassSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;

export interface BenchDoctorResult {
  ok: boolean;
  home: string;
  dbPath: string;
  runsDir: string;
  artifactsDir: string;
  warnings: string[];
}

const verifiedAt = "2026-06-29";

function githubSource(repository: string, path?: string, branch = "main"): SourceRef {
  const baseUrl = `https://github.com/${repository}`;
  return {
    type: "github",
    url: path ? `${baseUrl}/tree/${branch}/${path}` : baseUrl,
    repository,
    path,
    branch,
    verifiedAt
  };
}

function license(spdxId: string, name: string, requiresAttribution = false): BenchmarkManifest["license"] {
  return {
    spdxId,
    name,
    url: `https://spdx.org/licenses/${spdxId}.html`,
    status: "verified",
    requiresAttribution
  };
}

function metric(
  id: string,
  name: string,
  direction: z.infer<typeof metricDirectionSchema>,
  description?: string,
  unit?: string
): z.infer<typeof metricSchema> {
  return { id, name, direction, description, unit };
}

function defineBenchmark(input: BenchmarkManifestInput): BenchmarkManifest {
  return benchmarkManifestSchema.parse(input);
}

export const seedBenchmarks: BenchmarkManifest[] = [
  defineBenchmark({
    id: "lm-evaluation-harness",
    manifestVersion: "1.0.0",
    name: "EleutherAI lm-evaluation-harness",
    description: "Few-shot and zero-shot language model evaluation harness.",
    category: "llm-knowledge-reasoning",
    homepageUrl: "https://github.com/EleutherAI/lm-evaluation-harness",
    sources: [githubSource("EleutherAI/lm-evaluation-harness")],
    license: license("MIT", "MIT License"),
    runner: {
      kind: "python-cli",
      packageName: "lm_eval",
      command: ["lm_eval"],
      capabilities: ["dry-run", "local-execution", "network", "dataset-download", "artifact-capture"],
      requiresNetwork: true,
      supportsDryRun: true,
      expectedArtifacts: ["results.json"]
    },
    metrics: [
      metric("accuracy", "Accuracy", "higher-is-better"),
      metric("exact_match", "Exact match", "higher-is-better"),
      metric("perplexity", "Perplexity", "lower-is-better")
    ],
    adapter: { status: "planned", notes: "MVP adapter will generate a safe command plan before execution." },
    safety: { class: "networked", allowsNetwork: true, costRisk: "medium" },
    tags: ["llm", "knowledge", "reasoning"]
  }),
  defineBenchmark({
    id: "inspect-ai",
    manifestVersion: "1.0.0",
    name: "Inspect AI",
    description: "Evaluation framework for large language model tasks.",
    category: "llm-knowledge-reasoning",
    homepageUrl: "https://inspect.aisi.org.uk/",
    sources: [githubSource("UKGovernmentBEIS/inspect_ai")],
    license: license("MIT", "MIT License"),
    runner: {
      kind: "python-cli",
      packageName: "inspect_ai",
      command: ["inspect"],
      capabilities: ["dry-run", "local-execution", "network", "judge-model", "artifact-capture"],
      requiresNetwork: true,
      supportsDryRun: true,
      expectedArtifacts: ["*.eval"]
    },
    metrics: [
      metric("score", "Score", "higher-is-better"),
      metric("accuracy", "Accuracy", "higher-is-better")
    ],
    adapter: { status: "planned" },
    safety: { class: "networked", allowsNetwork: true, requiresSecrets: true, costRisk: "medium" },
    tags: ["llm", "evals", "inspect"]
  }),
  defineBenchmark({
    id: "helm",
    manifestVersion: "1.0.0",
    name: "HELM",
    description: "Holistic Evaluation of Language Models framework.",
    category: "llm-knowledge-reasoning",
    homepageUrl: "https://crfm.stanford.edu/helm/",
    sources: [githubSource("stanford-crfm/helm")],
    license: license("Apache-2.0", "Apache License 2.0"),
    runner: {
      kind: "python-cli",
      packageName: "crfm-helm",
      command: ["helm-run"],
      capabilities: ["dry-run", "local-execution", "network", "dataset-download", "cost-tracking", "artifact-capture"],
      requiresNetwork: true,
      supportsDryRun: true,
      expectedArtifacts: ["benchmark_output"]
    },
    metrics: [
      metric("accuracy", "Accuracy", "higher-is-better"),
      metric("robustness", "Robustness", "higher-is-better"),
      metric("fairness", "Fairness", "higher-is-better")
    ],
    adapter: { status: "planned" },
    safety: { class: "networked", allowsNetwork: true, requiresSecrets: true, costRisk: "medium" },
    tags: ["llm", "holistic", "leaderboard"]
  }),
  defineBenchmark({
    id: "opencompass",
    manifestVersion: "1.0.0",
    name: "OpenCompass",
    description: "LLM evaluation platform with broad dataset coverage.",
    category: "llm-knowledge-reasoning",
    homepageUrl: "https://opencompass.org.cn/",
    sources: [githubSource("open-compass/opencompass")],
    license: license("Apache-2.0", "Apache License 2.0"),
    runner: {
      kind: "python-cli",
      packageName: "opencompass",
      command: ["opencompass"],
      capabilities: ["dry-run", "local-execution", "network", "dataset-download", "artifact-capture"],
      requiresNetwork: true,
      supportsDryRun: true,
      expectedArtifacts: ["summary"]
    },
    metrics: [
      metric("accuracy", "Accuracy", "higher-is-better"),
      metric("score", "Score", "higher-is-better")
    ],
    adapter: { status: "planned" },
    safety: { class: "networked", allowsNetwork: true, costRisk: "medium" },
    tags: ["llm", "leaderboard", "datasets"]
  }),
  defineBenchmark({
    id: "lighteval",
    manifestVersion: "1.0.0",
    name: "LightEval",
    description: "Lightweight LLM evaluation toolkit across multiple backends.",
    category: "llm-knowledge-reasoning",
    homepageUrl: "https://github.com/huggingface/lighteval",
    sources: [githubSource("huggingface/lighteval")],
    license: license("MIT", "MIT License"),
    runner: {
      kind: "python-cli",
      packageName: "lighteval",
      command: ["lighteval"],
      capabilities: ["dry-run", "local-execution", "network", "dataset-download", "artifact-capture"],
      requiresNetwork: true,
      supportsDryRun: true,
      expectedArtifacts: ["results"]
    },
    metrics: [
      metric("accuracy", "Accuracy", "higher-is-better"),
      metric("normalized_accuracy", "Normalized accuracy", "higher-is-better")
    ],
    adapter: { status: "planned" },
    safety: { class: "networked", allowsNetwork: true, costRisk: "medium" },
    tags: ["llm", "huggingface", "datasets"]
  }),
  defineBenchmark({
    id: "swe-bench",
    manifestVersion: "1.0.0",
    name: "SWE-bench",
    description: "Software engineering benchmark for resolving real GitHub issues.",
    category: "coding",
    homepageUrl: "https://www.swebench.com/",
    sources: [githubSource("SWE-bench/SWE-bench")],
    license: license("MIT", "MIT License"),
    runner: {
      kind: "docker",
      packageName: "swebench",
      capabilities: ["dry-run", "docker", "network", "sandbox", "code-execution", "artifact-capture"],
      requiresNetwork: true,
      requiresSandbox: true,
      supportsDryRun: true,
      expectedArtifacts: ["predictions.json", "logs"]
    },
    metrics: [
      metric("resolved", "Resolved instances", "higher-is-better", undefined, "count"),
      metric("pass_rate", "Pass rate", "higher-is-better", undefined, "ratio")
    ],
    adapter: { status: "planned" },
    safety: {
      class: "sandbox-required",
      allowsNetwork: true,
      requiresSandbox: true,
      costRisk: "medium",
      notes: "Executes untrusted project test suites and must run in an isolated sandbox."
    },
    tags: ["coding", "agents", "software-engineering"]
  }),
  defineBenchmark({
    id: "evalplus",
    manifestVersion: "1.0.0",
    name: "EvalPlus",
    description: "Rigorous evaluation of generated code with additional tests.",
    category: "coding",
    homepageUrl: "https://github.com/evalplus/evalplus",
    sources: [githubSource("evalplus/evalplus", undefined, "master")],
    license: license("Apache-2.0", "Apache License 2.0"),
    runner: {
      kind: "python-cli",
      packageName: "evalplus",
      command: ["evalplus.evaluate"],
      capabilities: ["dry-run", "local-execution", "sandbox", "code-execution", "artifact-capture"],
      requiresSandbox: true,
      supportsDryRun: true,
      expectedArtifacts: ["eval_results.json"]
    },
    metrics: [
      metric("base_pass_at_1", "Base pass@1", "higher-is-better"),
      metric("plus_pass_at_1", "Plus pass@1", "higher-is-better")
    ],
    adapter: { status: "planned" },
    safety: {
      class: "sandbox-required",
      requiresSandbox: true,
      costRisk: "low",
      notes: "Runs generated code and must be sandboxed."
    },
    tags: ["coding", "humaneval", "mbpp"]
  }),
  defineBenchmark({
    id: "livecodebench",
    manifestVersion: "1.0.0",
    name: "LiveCodeBench",
    description: "Contamination-resistant coding benchmark from recent programming problems.",
    category: "coding",
    homepageUrl: "https://livecodebench.github.io/",
    sources: [githubSource("LiveCodeBench/LiveCodeBench")],
    license: license("MIT", "MIT License"),
    runner: {
      kind: "python-cli",
      packageName: "livecodebench",
      capabilities: ["dry-run", "local-execution", "network", "sandbox", "code-execution", "dataset-download", "artifact-capture"],
      requiresNetwork: true,
      requiresSandbox: true,
      supportsDryRun: true,
      expectedArtifacts: ["results"]
    },
    metrics: [
      metric("pass_at_1", "Pass@1", "higher-is-better"),
      metric("execution_accuracy", "Execution accuracy", "higher-is-better")
    ],
    adapter: { status: "planned" },
    safety: {
      class: "sandbox-required",
      allowsNetwork: true,
      requiresSandbox: true,
      costRisk: "medium",
      notes: "Runs generated code and may download datasets."
    },
    tags: ["coding", "contamination-resistant"]
  }),
  defineBenchmark({
    id: "bfcl",
    manifestVersion: "1.0.0",
    name: "Berkeley Function Calling Leaderboard",
    description: "Function calling and tool-use benchmark for LLMs.",
    category: "tool-use",
    homepageUrl: "https://gorilla.cs.berkeley.edu/leaderboard.html",
    sources: [githubSource("ShishirPatil/gorilla", "berkeley-function-call-leaderboard")],
    license: license("Apache-2.0", "Apache License 2.0"),
    runner: {
      kind: "python-cli",
      packageName: "bfcl-eval",
      command: ["bfcl"],
      capabilities: ["dry-run", "local-execution", "network", "tool-use", "cost-tracking", "artifact-capture"],
      requiresNetwork: true,
      supportsDryRun: true,
      expectedArtifacts: ["result"]
    },
    metrics: [
      metric("accuracy", "Accuracy", "higher-is-better"),
      metric("ast_score", "AST score", "higher-is-better"),
      metric("latency", "Latency", "lower-is-better", undefined, "seconds")
    ],
    adapter: { status: "planned" },
    safety: { class: "networked", allowsNetwork: true, requiresSecrets: true, costRisk: "medium" },
    tags: ["tool-use", "function-calling", "agents"]
  }),
  defineBenchmark({
    id: "ragas",
    manifestVersion: "1.0.0",
    name: "Ragas",
    description: "RAG evaluation framework for retrieval and answer quality.",
    category: "rag",
    homepageUrl: "https://docs.ragas.io/",
    sources: [githubSource("vibrantlabsai/ragas")],
    license: license("Apache-2.0", "Apache License 2.0"),
    runner: {
      kind: "python-cli",
      packageName: "ragas",
      capabilities: ["dry-run", "local-execution", "network", "judge-model", "artifact-capture"],
      requiresNetwork: true,
      supportsDryRun: true,
      expectedArtifacts: ["results"]
    },
    metrics: [
      metric("faithfulness", "Faithfulness", "higher-is-better"),
      metric("answer_relevancy", "Answer relevancy", "higher-is-better"),
      metric("context_precision", "Context precision", "higher-is-better")
    ],
    adapter: { status: "planned" },
    safety: { class: "networked", allowsNetwork: true, requiresSecrets: true, costRisk: "medium" },
    tags: ["rag", "retrieval", "judge"]
  }),
  defineBenchmark({
    id: "promptfoo",
    manifestVersion: "1.0.0",
    name: "Promptfoo",
    description: "Prompt, agent, RAG, and AI red-team testing framework.",
    category: "safety",
    homepageUrl: "https://www.promptfoo.dev/",
    sources: [githubSource("promptfoo/promptfoo")],
    license: license("MIT", "MIT License"),
    runner: {
      kind: "node-cli",
      packageName: "promptfoo",
      command: ["promptfoo"],
      capabilities: ["dry-run", "local-execution", "network", "judge-model", "cost-tracking", "artifact-capture"],
      requiresNetwork: true,
      supportsDryRun: true,
      expectedArtifacts: ["results.json"]
    },
    metrics: [
      metric("score", "Score", "higher-is-better"),
      metric("pass_rate", "Pass rate", "higher-is-better", undefined, "ratio"),
      metric("failures", "Failures", "lower-is-better", undefined, "count")
    ],
    adapter: { status: "planned" },
    safety: {
      class: "dual-use",
      allowsNetwork: true,
      requiresSecrets: true,
      costRisk: "medium",
      notes: "Red-team templates may include harmful-content probes and require explicit safety gates."
    },
    tags: ["prompts", "red-team", "ci"]
  }),
  defineBenchmark({
    id: "xstest",
    manifestVersion: "1.0.0",
    name: "XSTest",
    description: "Safety benchmark for exaggerated refusal behavior in language models.",
    category: "safety",
    homepageUrl: "https://github.com/paul-rottger/xstest",
    sources: [githubSource("paul-rottger/xstest")],
    license: license("CC-BY-4.0", "Creative Commons Attribution 4.0 International", true),
    runner: {
      kind: "dataset",
      capabilities: ["dry-run", "dataset-download", "judge-model", "artifact-capture"],
      requiresNetwork: true,
      supportsDryRun: true,
      expectedArtifacts: ["model_outputs.json", "scores.json"]
    },
    metrics: [
      metric("safe_accuracy", "Safe prompt accuracy", "higher-is-better"),
      metric("unsafe_refusal_rate", "Unsafe refusal rate", "higher-is-better"),
      metric("overrefusal_rate", "Overrefusal rate", "lower-is-better")
    ],
    adapter: { status: "planned" },
    safety: {
      class: "dual-use",
      allowsNetwork: true,
      requiresSecrets: true,
      costRisk: "low",
      notes: "Contains safety-sensitive prompts and requires result redaction review."
    },
    tags: ["safety", "refusal", "dataset"]
  }),
  defineBenchmark({
    id: "llmperf",
    manifestVersion: "1.0.0",
    name: "LLMPerf",
    description: "Latency and throughput benchmark for LLM APIs.",
    category: "latency-cost",
    homepageUrl: "https://github.com/ray-project/llmperf",
    sources: [githubSource("ray-project/llmperf")],
    license: license("Apache-2.0", "Apache License 2.0"),
    runner: {
      kind: "python-cli",
      packageName: "llmperf",
      capabilities: ["dry-run", "local-execution", "network", "streaming", "cost-tracking", "artifact-capture"],
      requiresNetwork: true,
      supportsDryRun: true,
      expectedArtifacts: ["summary.json"]
    },
    metrics: [
      metric("ttft", "Time to first token", "lower-is-better", undefined, "seconds"),
      metric("tokens_per_second", "Tokens per second", "higher-is-better"),
      metric("latency", "Latency", "lower-is-better", undefined, "seconds"),
      metric("error_rate", "Error rate", "lower-is-better", undefined, "ratio")
    ],
    adapter: { status: "planned" },
    safety: { class: "networked", allowsNetwork: true, requiresSecrets: true, costRisk: "high" },
    tags: ["latency", "throughput", "providers"]
  })
];

export function parseBenchmarkManifest(input: unknown): BenchmarkManifest {
  return benchmarkManifestSchema.parse(input);
}

export function listBenchmarkIds(): string[] {
  return seedBenchmarks.map((benchmark) => benchmark.id);
}

import { seedBenchmarks, type BenchmarkManifest } from "./contracts.js";

export type AdapterExecutionMode = "dry-run" | "manual-record" | "external-runner";
export type AdapterParseMode = "json" | "jsonl" | "directory" | "manual";

export interface AdapterCommandContext {
  benchmarkId: string;
  modelId: string;
  provider: string;
  route?: string;
  outputDir?: string;
}

export interface AdapterCommandPlan {
  command: string[];
  environment: string[];
  expectedOutputs: string[];
}

export interface BenchmarkAdapter {
  id: string;
  benchmarkId: string;
  executionModes: AdapterExecutionMode[];
  install: {
    type: "python-package" | "node-package" | "docker" | "dataset" | "manual";
    packageName?: string;
    command?: string[];
    notes?: string;
  };
  run: {
    supportsDryRun: boolean;
    requiresNetwork: boolean;
    requiresSandbox: boolean;
    sample: (context: AdapterCommandContext) => AdapterCommandPlan;
  };
  parse: {
    mode: AdapterParseMode;
    expectedOutputs: string[];
    metrics: string[];
  };
  safety: BenchmarkManifest["safety"];
}

function out(context: AdapterCommandContext): string {
  return context.outputDir ?? `runs/${context.benchmarkId}`;
}

function adapter(
  benchmarkId: string,
  install: BenchmarkAdapter["install"],
  sample: (context: AdapterCommandContext) => AdapterCommandPlan,
  parseMode: AdapterParseMode = "json"
): BenchmarkAdapter {
  const manifest = seedBenchmarks.find((entry) => entry.id === benchmarkId);
  if (!manifest) throw new Error(`Missing seed benchmark for adapter: ${benchmarkId}`);

  return {
    id: `${benchmarkId}:default`,
    benchmarkId,
    executionModes: ["dry-run", "manual-record"],
    install,
    run: {
      supportsDryRun: true,
      requiresNetwork: manifest.runner.requiresNetwork,
      requiresSandbox: manifest.runner.requiresSandbox,
      sample
    },
    parse: {
      mode: parseMode,
      expectedOutputs: manifest.runner.expectedArtifacts,
      metrics: manifest.metrics.map((metric) => metric.id)
    },
    safety: manifest.safety
  };
}

export const benchmarkAdapters: BenchmarkAdapter[] = [
  adapter(
    "lm-evaluation-harness",
    { type: "python-package", packageName: "lm_eval", command: ["python", "-m", "pip", "install", "lm_eval"] },
    (context) => ({
      command: [
        "lm_eval",
        "--model",
        context.provider,
        "--model_args",
        `model=${context.modelId}`,
        "--tasks",
        "arc_easy",
        "--output_path",
        out(context)
      ],
      environment: ["OPENAI_API_KEY or provider-specific key when using remote models"],
      expectedOutputs: ["results.json"]
    })
  ),
  adapter(
    "inspect-ai",
    { type: "python-package", packageName: "inspect_ai", command: ["python", "-m", "pip", "install", "inspect_ai"] },
    (context) => ({
      command: ["inspect", "eval", "examples/hello_world.py", "--model", `${context.provider}/${context.modelId}`, "--log-dir", out(context)],
      environment: ["Provider API key for remote model backends"],
      expectedOutputs: ["*.eval"]
    }),
    "directory"
  ),
  adapter(
    "helm",
    { type: "python-package", packageName: "crfm-helm", command: ["python", "-m", "pip", "install", "crfm-helm"] },
    (context) => ({
      command: ["helm-run", "--suite", "mmlu", "--models-to-run", `${context.provider}/${context.modelId}`, "--output-path", out(context)],
      environment: ["HELM provider credentials for remote model backends"],
      expectedOutputs: ["benchmark_output"]
    }),
    "directory"
  ),
  adapter(
    "opencompass",
    { type: "python-package", packageName: "opencompass", command: ["python", "-m", "pip", "install", "opencompass"] },
    (context) => ({
      command: ["opencompass", "--models", context.modelId, "--datasets", "mmlu_gen", "--work-dir", out(context)],
      environment: ["Provider credentials if the selected model is remote"],
      expectedOutputs: ["summary"]
    }),
    "directory"
  ),
  adapter(
    "lighteval",
    { type: "python-package", packageName: "lighteval", command: ["python", "-m", "pip", "install", "lighteval"] },
    (context) => ({
      command: ["lighteval", "accelerate", context.provider, context.modelId, "leaderboard|arc:easy|0|0", "--output-dir", out(context)],
      environment: ["HF_TOKEN or provider credentials when required"],
      expectedOutputs: ["results"]
    }),
    "directory"
  ),
  adapter(
    "swe-bench",
    { type: "docker", packageName: "swebench", notes: "Requires isolated Docker/sandbox execution." },
    (context) => ({
      command: ["python", "-m", "swebench.harness.run_evaluation", "--predictions_path", "predictions.json", "--run_id", context.modelId],
      environment: ["Docker daemon inside sandbox", "Dataset cache path"],
      expectedOutputs: ["predictions.json", "logs"]
    }),
    "directory"
  ),
  adapter(
    "evalplus",
    { type: "python-package", packageName: "evalplus", command: ["python", "-m", "pip", "install", "evalplus"] },
    (context) => ({
      command: ["python", "-m", "evalplus.evaluate", "--dataset", "humaneval", "--samples", `${out(context)}/samples.jsonl`],
      environment: ["Sandboxed Python execution"],
      expectedOutputs: ["eval_results.json"]
    })
  ),
  adapter(
    "livecodebench",
    { type: "python-package", packageName: "livecodebench", notes: "Requires dataset fetch and sandboxed generated-code execution." },
    (context) => ({
      command: ["python", "-m", "lcb_runner.runner.main", "--model", context.modelId, "--scenario", "codegeneration", "--output_path", out(context)],
      environment: ["Dataset access", "Sandboxed Python execution"],
      expectedOutputs: ["results"]
    }),
    "directory"
  ),
  adapter(
    "bfcl",
    { type: "python-package", packageName: "bfcl-eval", notes: "Use upstream BFCL evaluator from Gorilla repository." },
    (context) => ({
      command: ["bfcl", "evaluate", "--model", context.modelId, "--provider", context.provider, "--output-dir", out(context)],
      environment: ["Provider API key for remote function-calling models"],
      expectedOutputs: ["result"]
    }),
    "directory"
  ),
  adapter(
    "ragas",
    { type: "python-package", packageName: "ragas", command: ["python", "-m", "pip", "install", "ragas"] },
    (context) => ({
      command: ["python", "-m", "ragas", "evaluate", "--dataset", "dataset.jsonl", "--model", `${context.provider}/${context.modelId}`, "--output", `${out(context)}/results.json`],
      environment: ["Provider API key for judge/model calls"],
      expectedOutputs: ["results"]
    })
  ),
  adapter(
    "promptfoo",
    { type: "node-package", packageName: "promptfoo", command: ["bunx", "promptfoo@latest", "--version"] },
    (context) => ({
      command: ["promptfoo", "eval", "--config", "promptfooconfig.yaml", "--output", `${out(context)}/results.json`, "--var", `model=${context.modelId}`],
      environment: ["Provider API key when configs call remote models"],
      expectedOutputs: ["results.json"]
    })
  ),
  adapter(
    "xstest",
    { type: "dataset", notes: "Dataset-style adapter; generation and scoring are orchestrated by future runner code." },
    (context) => ({
      command: ["bench", "runs", "record", "xstest", "--model", context.modelId, "--provider", context.provider, "--input", `${out(context)}/scores.json`],
      environment: ["Provider API key for response generation", "Attribution for CC-BY-4.0 dataset"],
      expectedOutputs: ["model_outputs.json", "scores.json"]
    }),
    "manual"
  ),
  adapter(
    "llmperf",
    { type: "python-package", packageName: "llmperf", command: ["python", "-m", "pip", "install", "llmperf"] },
    (context) => ({
      command: ["python", "-m", "llmperf.token_benchmark_ray", "--model", context.modelId, "--llm-api", context.provider, "--results-dir", out(context)],
      environment: ["Provider API key", "Explicit cost budget"],
      expectedOutputs: ["summary.json"]
    })
  )
];

export function listAdapters(): BenchmarkAdapter[] {
  return benchmarkAdapters;
}

export function getAdapter(benchmarkId: string): BenchmarkAdapter {
  const adapter = benchmarkAdapters.find((entry) => entry.benchmarkId === benchmarkId);
  if (!adapter) throw new Error(`No adapter registered for benchmark: ${benchmarkId}`);
  return adapter;
}

export function buildAdapterPlan(context: AdapterCommandContext): BenchmarkAdapter & { plan: AdapterCommandPlan } {
  const adapter = getAdapter(context.benchmarkId);
  return {
    ...adapter,
    plan: adapter.run.sample(context)
  };
}

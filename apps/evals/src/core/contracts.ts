import { randomUUID } from "crypto";
import {
  ProofBundleSchema,
  SCHEMA_IDS,
  ValidationPlanSchema,
  parseContract,
  validateContract,
} from "@hasna/contracts";
import type {
  ActorPointer,
  EvidenceKind,
  EvidencePointer,
  ProofBundle,
  ResourcePointer,
  ValidationPlan,
} from "@hasna/contracts";
import type {
  Assertion,
  AssertionResult,
  EvalCase,
  EvalRun,
  JudgeConfig,
  Verdict,
} from "../types/index.js";

export {
  ProofBundleSchema,
  ValidationPlanSchema,
};
export type {
  ActorPointer,
  EvidenceKind,
  EvidencePointer,
  ProofBundle,
  ResourcePointer,
  ValidationPlan,
};

/** Namespace used for eval-specific data inside the generic Hasna contracts. */
export const EVALS_CONTRACT_METADATA_KEY = "@hasna/evals";

export type JudgeMetadata = Omit<JudgeConfig, "apiKey">;

export interface ValidationPlanCheckMetadata {
  checkId: string;
  deterministicAssertions: Assertion[];
  llmJudge?: JudgeMetadata;
}

export interface EvalValidationPlanMetadata {
  kind: "validation_plan";
  dataset: string;
  requiredChecks: ValidationPlanCheckMetadata[];
  artifactRefs: EvidencePointer[];
}

export interface DeterministicAssertionProof {
  checkId: string;
  results: AssertionResult[];
}

export interface LlmJudgeProof {
  checkId: string;
  config?: JudgeMetadata;
  verdict: Verdict;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface EvalProofBundleMetadata {
  kind: "proof_bundle";
  runId: string;
  dataset: string;
  caseVerdicts: Array<{ checkId: string; verdict: Verdict }>;
  deterministicAssertions: DeterministicAssertionProof[];
  llmJudges: LlmJudgeProof[];
  artifactRefs: EvidencePointer[];
}

export interface CreateValidationPlanOptions {
  dataset: string;
  objective: string;
  id?: string;
  createdAt?: string;
  subject?: ResourcePointer;
  verifier?: ActorPointer;
  artifactRefs?: EvidencePointer[];
  requiredEvidenceKinds?: EvidenceKind[];
  metadata?: Record<string, unknown>;
}

export interface CreateProofBundleOptions {
  verifier: ActorPointer;
  id?: string;
  createdAt?: string;
  subject?: ResourcePointer;
  artifactRefs?: EvidencePointer[];
  residualRisks?: string[];
  freshness?: "fresh" | "stale" | "unknown";
  metadata?: Record<string, unknown>;
}

export type ContractValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: unknown };

function judgeMetadata(config: JudgeConfig | undefined): JudgeMetadata | undefined {
  if (!config) return undefined;

  return {
    rubric: config.rubric,
    ...(config.model ? { model: config.model } : {}),
    ...(config.provider ? { provider: config.provider } : {}),
  };
}

function checkExpected(evalCase: EvalCase): string {
  const candidates = [evalCase.expected, evalCase.judge?.rubric];
  const explicit = candidates.find((value) => value?.trim());
  if (explicit) return explicit;

  const labels = evalCase.assertions
    ?.map((assertion) => assertion.label?.trim())
    .filter((label): label is string => Boolean(label));
  if (labels?.length) return labels.join("; ");

  return `Eval case ${evalCase.id} must satisfy its configured checks`;
}

/**
 * Build and validate a generic Hasna validation plan from eval cases.
 * Assertion and judge configuration is namespaced in metadata so the wire
 * contract stays compatible with other validators and proof producers.
 */
export function createValidationPlan(
  cases: EvalCase[],
  options: CreateValidationPlanOptions
): ValidationPlan {
  const artifactRefs = options.artifactRefs ?? [];
  const requiredChecks: ValidationPlanCheckMetadata[] = cases.map((evalCase) => ({
    checkId: evalCase.id,
    deterministicAssertions: evalCase.assertions ?? [],
    ...(evalCase.judge ? { llmJudge: judgeMetadata(evalCase.judge) } : {}),
  }));

  const evalMetadata: EvalValidationPlanMetadata = {
    kind: "validation_plan",
    dataset: options.dataset,
    requiredChecks,
    artifactRefs,
  };

  return parseContract(SCHEMA_IDS.validationPlan, {
    schema: SCHEMA_IDS.validationPlan,
    id: options.id ?? randomUUID(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    objective: options.objective,
    ...(options.subject ? { subject: options.subject } : {}),
    checks: cases.map((evalCase) => ({
      id: evalCase.id,
      kind: "eval",
      required: true,
      expected: checkExpected(evalCase),
    })),
    ...(options.verifier ? { verifier: options.verifier } : {}),
    requiredEvidenceKinds: options.requiredEvidenceKinds ?? [],
    metadata: {
      ...options.metadata,
      [EVALS_CONTRACT_METADATA_KEY]: evalMetadata,
    },
  });
}

function planCheckMetadata(plan: ValidationPlan): Map<string, ValidationPlanCheckMetadata> {
  const metadata = plan.metadata?.[EVALS_CONTRACT_METADATA_KEY];
  if (!metadata || typeof metadata !== "object") return new Map();

  const requiredChecks = (metadata as Partial<EvalValidationPlanMetadata>).requiredChecks;
  if (!Array.isArray(requiredChecks)) return new Map();

  const checks: Array<[string, ValidationPlanCheckMetadata]> = [];
  for (const value of requiredChecks) {
    if (!value || typeof value !== "object") continue;
    const check = value as Partial<ValidationPlanCheckMetadata>;
    if (typeof check.checkId !== "string" || !Array.isArray(check.deterministicAssertions)) continue;

    const rawJudge = check.llmJudge as Partial<JudgeMetadata> | undefined;
    const llmJudge = rawJudge && typeof rawJudge.rubric === "string"
      ? {
          rubric: rawJudge.rubric,
          ...(typeof rawJudge.model === "string" ? { model: rawJudge.model } : {}),
          ...(rawJudge.provider === "anthropic" || rawJudge.provider === "openai"
            ? { provider: rawJudge.provider }
            : {}),
        }
      : undefined;

    checks.push([check.checkId, {
      checkId: check.checkId,
      deterministicAssertions: check.deterministicAssertions,
      ...(llmJudge ? { llmJudge } : {}),
    }]);
  }

  return new Map(checks);
}

function proofVerdict(run: EvalRun, missingRequiredChecks: string[]): ProofBundle["verdict"] {
  if (run.results.length === 0) return "not_run";
  if (run.results.some((result) => result.verdict === "FAIL" || result.error)) return "failed";
  if (run.results.some((result) => result.verdict === "UNKNOWN") || missingRequiredChecks.length > 0) {
    return "inconclusive";
  }
  return "passed";
}

function proofStatus(verdict: ProofBundle["verdict"]): ProofBundle["status"] {
  switch (verdict) {
    case "passed": return "succeeded";
    case "failed": return "failed";
    case "not_run": return "skipped";
    case "inconclusive": return "unknown";
  }
}

function checkStatus(result: EvalRun["results"][number]): ProofBundle["checks"][number]["status"] {
  if (result.error) return "failed";
  if (result.verdict === "PASS") return "succeeded";
  if (result.verdict === "FAIL") return "failed";
  return "unknown";
}

function resultEvidence(run: EvalRun, caseId: string, verdict: Verdict): EvidencePointer {
  return {
    id: `${run.id}:${caseId}`,
    kind: "test_result",
    summary: `${caseId}: ${verdict}`,
  };
}

/**
 * Build and validate a Hasna proof bundle from an executed eval run.
 * The bundle records every executed check and keeps deterministic assertion
 * results and non-secret LLM judge metadata in the evals metadata namespace.
 */
export function createProofBundle(
  run: EvalRun,
  plan: ValidationPlan,
  options: CreateProofBundleOptions
): ProofBundle {
  if (!options.verifier) throw new Error("A verifier is required to create a proof bundle");

  const validatedPlan = parseContract(SCHEMA_IDS.validationPlan, plan);
  const configuredChecks = planCheckMetadata(validatedPlan);
  const artifactRefs = options.artifactRefs ?? [];
  const executedCheckIds = new Set(run.results.map((result) => result.caseId));
  const missingRequiredChecks = validatedPlan.checks
    .filter((check) => check.required && !executedCheckIds.has(check.id))
    .map((check) => check.id);
  const verdict = proofVerdict(run, missingRequiredChecks);
  const residualRisks = [
    ...(options.residualRisks ?? []),
    ...missingRequiredChecks.map((checkId) => `Required check ${checkId} was not executed`),
  ];

  const deterministicAssertions: DeterministicAssertionProof[] = run.results.map((result) => ({
    checkId: result.caseId,
    results: result.assertionResults,
  }));
  const llmJudges: LlmJudgeProof[] = run.results.flatMap((result) => {
    if (!result.judgeResult) return [];
    const config = configuredChecks.get(result.caseId)?.llmJudge;
    return [{
      checkId: result.caseId,
      ...(config ? { config } : {}),
      verdict: result.judgeResult.verdict,
      durationMs: result.judgeResult.durationMs,
      ...(result.judgeResult.inputTokens !== undefined
        ? { inputTokens: result.judgeResult.inputTokens }
        : {}),
      ...(result.judgeResult.outputTokens !== undefined
        ? { outputTokens: result.judgeResult.outputTokens }
        : {}),
      ...(result.judgeResult.costUsd !== undefined
        ? { costUsd: result.judgeResult.costUsd }
        : {}),
    }];
  });

  const evalMetadata: EvalProofBundleMetadata = {
    kind: "proof_bundle",
    runId: run.id,
    dataset: run.dataset,
    caseVerdicts: run.results.map((result) => ({
      checkId: result.caseId,
      verdict: result.verdict,
    })),
    deterministicAssertions,
    llmJudges,
    artifactRefs,
  };

  return parseContract(SCHEMA_IDS.proofBundle, {
    schema: SCHEMA_IDS.proofBundle,
    id: options.id ?? randomUUID(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    subject: options.subject ?? {
      kind: "run",
      id: run.id,
      name: run.dataset,
      externalId: run.id,
      sourcePackage: "@hasna/evals",
    },
    validationPlanRef: {
      kind: "verification",
      id: validatedPlan.id,
      externalId: validatedPlan.id,
      sourcePackage: "@hasna/evals",
    },
    status: proofStatus(verdict),
    verdict,
    checks: [
      ...run.results.map((result) => ({
        checkId: result.caseId,
        status: checkStatus(result),
        summary: result.error ?? `${result.verdict} in ${result.durationMs}ms`,
        evidenceRefs: [resultEvidence(run, result.caseId, result.verdict)],
      })),
      ...(run.results.length > 0 ? missingRequiredChecks.map((checkId) => ({
        checkId,
        status: "skipped" as const,
        summary: "Required check was not executed",
        evidenceRefs: [],
      })) : []),
    ],
    verifier: options.verifier,
    evidenceRefs: artifactRefs,
    residualRisks,
    freshness: options.freshness ?? "unknown",
    metadata: {
      ...options.metadata,
      [EVALS_CONTRACT_METADATA_KEY]: evalMetadata,
    },
  });
}

/** Validate a value against `hasna.validation_plan.v1`. */
export function validateValidationPlan(value: unknown): ContractValidationResult<ValidationPlan> {
  return validateContract(SCHEMA_IDS.validationPlan, value);
}

/** Validate a value against `hasna.proof_bundle.v1`. */
export function validateProofBundle(value: unknown): ContractValidationResult<ProofBundle> {
  return validateContract(SCHEMA_IDS.proofBundle, value);
}

export type Verdict = 'PASS' | 'FAIL' | 'UNKNOWN'

export interface AssertionResult {
  type: string
  passed: boolean
  reason: string
  label?: string
}

export interface JudgeResult {
  verdict: Verdict
  reasoning: string
  durationMs: number
  costUsd?: number
}

export interface EvalResult {
  caseId: string
  verdict: Verdict
  output: string
  assertionResults: AssertionResult[]
  judgeResult?: JudgeResult
  repeatVerdicts?: Verdict[]
  passRate?: number
  durationMs: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  error?: string
}

export interface EvalRunStats {
  total: number
  passed: number
  failed: number
  unknown: number
  errors: number
  passRate: number
  totalDurationMs: number
  totalCostUsd: number
  totalTokens: number
}

export interface EvalRun {
  id: string
  createdAt: string
  dataset: string
  results: EvalResult[]
  stats: EvalRunStats
}

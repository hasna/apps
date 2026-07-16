import { createHash } from 'node:crypto'
import { CliError, EXIT_CODES } from './errors.js'

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`
}

export type MutationPlan = {
  schema: 'hasna.mutation_plan.v1'
  operation: string
  target: string
  changes: unknown
  digest: string
}

export function createPlan(operation: string, target: string, changes: unknown): MutationPlan {
  const base = { schema: 'hasna.mutation_plan.v1' as const, operation, target, changes }
  const digest = `sha256:${createHash('sha256').update(canonical(base)).digest('hex')}`
  return { ...base, digest }
}

export function requirePlanApproval(plan: MutationPlan, apply?: string, yes = false): void {
  if (!apply)
    throw new CliError('PLAN_REQUIRED', 'Review the plan and pass --apply <digest> --yes', EXIT_CODES.VALIDATION, {
      details: plan,
    })
  if (apply !== plan.digest)
    throw new CliError('PLAN_MISMATCH', 'The supplied plan digest does not match', EXIT_CODES.CONFLICT, {
      details: plan,
    })
  if (!yes)
    throw new CliError('CONFIRMATION_REQUIRED', '--yes is required with --apply', EXIT_CODES.VALIDATION, {
      details: plan,
    })
}

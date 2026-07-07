import { parseGuardrailPolicySet } from "./schemas";
import type { GuardrailPolicySet } from "./types";

export async function loadPolicySet(path: string): Promise<GuardrailPolicySet> {
  const raw = JSON.parse(await Bun.file(path).text()) as unknown;
  return parseGuardrailPolicySet(raw);
}

export async function loadGuardrailInput(path: string) {
  return JSON.parse(await Bun.file(path).text()) as unknown;
}

export function validatePolicySet(value: unknown): { ok: true; policySet: GuardrailPolicySet } | { ok: false; errors: string[] } {
  try {
    return { ok: true, policySet: parseGuardrailPolicySet(value) };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

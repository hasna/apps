import type { Result } from "../types/index.js";

export interface PersonaDivergence {
  scenarioId: string;
  scenarioName: string;
  personas: Array<{
    personaId: string | null;
    personaName: string | null;
    status: string;
    reasoning: string | null;
  }>;
  divergenceScore: number;   // 0=identical, 1=all different
  hasDivergence: boolean;
}

/**
 * Diff results across personas for the same scenarios.
 * Groups results by scenarioId, then compares status across persona variants.
 * divergenceScore = (distinct statuses - 1) / (persona count - 1)
 */
export function diffPersonaResults(
  results: Result[],
  scenarios: Array<{ id: string; name: string }>
): PersonaDivergence[] {
  const scenarioMap = new Map(scenarios.map((s) => [s.id, s.name]));

  // Group results by scenarioId
  const byScenario = new Map<string, Result[]>();
  for (const result of results) {
    const existing = byScenario.get(result.scenarioId) ?? [];
    existing.push(result);
    byScenario.set(result.scenarioId, existing);
  }

  const divergences: PersonaDivergence[] = [];

  for (const [scenarioId, scenarioResults] of byScenario) {
    if (scenarioResults.length < 2) continue; // Need at least 2 persona variants

    const scenarioName = scenarioMap.get(scenarioId) ?? scenarioId;

    const personas = scenarioResults.map((r) => ({
      personaId: r.personaId,
      personaName: r.personaName,
      status: r.status,
      reasoning: r.reasoning,
    }));

    const distinctStatuses = new Set(personas.map((p) => p.status));
    const personaCount = personas.length;

    // divergenceScore: 0 = all same, 1 = all different
    const divergenceScore =
      personaCount <= 1
        ? 0
        : (distinctStatuses.size - 1) / (personaCount - 1);

    divergences.push({
      scenarioId,
      scenarioName,
      personas,
      divergenceScore,
      hasDivergence: distinctStatuses.size > 1,
    });
  }

  // Sort by divergence score descending (most divergent first)
  divergences.sort((a, b) => b.divergenceScore - a.divergenceScore);

  return divergences;
}

/**
 * Format divergence results for terminal display.
 */
export function formatDivergenceTerminal(divergences: PersonaDivergence[]): string {
  if (divergences.length === 0) {
    return "  No divergence detected across personas.\n";
  }

  const lines: string[] = [];
  const diverged = divergences.filter((d) => d.hasDivergence);
  const aligned = divergences.filter((d) => !d.hasDivergence);

  lines.push(`  Persona Divergence Summary`);
  lines.push(`  ─────────────────────────────────────`);
  lines.push(`  Scenarios tested: ${divergences.length}`);
  lines.push(`  Divergent:        ${diverged.length}`);
  lines.push(`  Aligned:          ${aligned.length}`);
  lines.push("");

  for (const d of divergences) {
    const score = (d.divergenceScore * 100).toFixed(0);
    const marker = d.hasDivergence ? "  [DIVERGE]" : "  [ALIGNED]";
    lines.push(`${marker} ${d.scenarioName} (score: ${score}%)`);
    for (const p of d.personas) {
      const name = p.personaName ?? p.personaId ?? "default";
      lines.push(`    ${name}: ${p.status}`);
      if (p.reasoning && d.hasDivergence) {
        const short = p.reasoning.slice(0, 80);
        lines.push(`      → ${short}${p.reasoning.length > 80 ? "..." : ""}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

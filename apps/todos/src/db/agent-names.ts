import type { Database } from "bun:sqlite";
import type { Agent } from "../types/index.js";

export class InvalidAgentNameError extends Error {
  readonly suggestions: string[];

  constructor(name: string, reason: string, suggestions: string[] = []) {
    super(`Invalid agent name "${name}": ${reason}${suggestions.length > 0 ? `. Try: ${suggestions.join(", ")}` : ""}`);
    this.name = "InvalidAgentNameError";
    this.suggestions = suggestions;
  }
}

export const ROMAN_AGENT_NAMES = [
  "caesar",
  "augustus",
  "marcus",
  "brutus",
  "cicero",
  "cato",
  "nero",
  "claudius",
  "tiberius",
  "hadrian",
  "trajan",
  "vespasian",
  "domitian",
  "caligula",
  "commodus",
  "livia",
  "julia",
  "octavia",
  "claudia",
  "agrippina",
  "cornelia",
  "valeria",
  "fulvia",
  "hortensia",
  "fabia",
] as const;

export const GREEK_AGENT_NAMES = [
  "athena",
  "apollo",
  "artemis",
  "hera",
  "iris",
  "hector",
  "achilles",
  "odysseus",
  "theseus",
  "pericles",
  "solon",
  "sophia",
  "thalia",
  "calliope",
  "clio",
  "phoebe",
  "daphne",
  "leonidas",
  "andromeda",
  "cassander",
] as const;

export const NICE_AGENT_NAMES = [
  "atlas",
  "aurora",
  "ember",
  "nova",
  "orion",
  "rhea",
  "selene",
  "sirius",
  "vesper",
  "zephyr",
] as const;

export const EXTENDED_AGENT_NAMES = [
  "agrippa",
  "antonius",
  "aurelian",
  "aurelius",
  "camillus",
  "cassius",
  "celer",
  "cincinnatus",
  "corvus",
  "drusus",
  "fabius",
  "faustus",
  "flaccus",
  "gallus",
  "gaius",
  "horatius",
  "lucius",
  "lucullus",
  "marius",
  "marcellus",
  "maximus",
  "nerva",
  "pompey",
  "quintus",
  "regulus",
  "romulus",
  "scipio",
  "seneca",
  "sertorius",
  "sulla",
  "tacitus",
  "varro",
  "vitruvius",
  "plato",
  "socrates",
  "aristotle",
  "heraclitus",
  "democritus",
  "pythagoras",
  "hipparchus",
  "euclid",
  "archimedes",
  "zeno",
  "anaximander",
  "epictetus",
  "aeschylus",
  "sophocles",
  "euripides",
  "xenophon",
  "diogenes",
] as const;

export const PREFERRED_AGENT_NAMES = [
  ...ROMAN_AGENT_NAMES,
  ...GREEK_AGENT_NAMES,
  ...NICE_AGENT_NAMES,
  ...EXTENDED_AGENT_NAMES,
] as const;

const RESERVED_GENERIC_NAMES = new Set([
  "agent",
  "agents",
  "ai",
  "assistant",
  "bot",
  "coder",
  "default",
  "helper",
  "model",
  "system",
  "user",
  "worker",
]);

const NUMERIC_SUFFIX_RE = /[-_]\d+$/;
const ONE_WORD_NAME_RE = /^[a-z]+$/;

export function normalizeAgentNameInput(name: string): string {
  return name.trim().toLowerCase();
}

export function hasGeneratedNumericSuffix(name: string): boolean {
  return NUMERIC_SUFFIX_RE.test(normalizeAgentNameInput(name));
}

export function isGenericAgentName(name: string): boolean {
  const normalized = normalizeAgentNameInput(name);
  if (RESERVED_GENERIC_NAMES.has(normalized)) return true;
  for (const generic of RESERVED_GENERIC_NAMES) {
    if (normalized === `${generic}s`) return true;
    if (normalized.match(new RegExp(`^${generic}\\d+$`))) return true;
    if (normalized.match(new RegExp(`^${generic}[-_]\\d+$`))) return true;
  }
  return false;
}

export function isBlockedAgentName(name: string): boolean {
  const normalized = normalizeAgentNameInput(name);
  return isGenericAgentName(normalized) || hasGeneratedNumericSuffix(normalized) || !ONE_WORD_NAME_RE.test(normalized);
}

const FALLBACK_PREFIXES = [
  "arv",
  "bel",
  "cyr",
  "dax",
  "elun",
  "feno",
  "gavor",
  "hiro",
  "ivar",
  "jaro",
  "kavo",
  "lumo",
  "myr",
  "navo",
  "prax",
  "quor",
  "riven",
  "sovan",
  "tavor",
  "ulmor",
  "vexo",
  "wiro",
  "yaro",
  "zel",
] as const;

const FALLBACK_STEMS = [
  "al",
  "ber",
  "cor",
  "dren",
  "el",
  "far",
  "gor",
  "hal",
  "ion",
  "jor",
  "kel",
  "lor",
  "mor",
  "nel",
  "or",
  "per",
  "quil",
  "ron",
  "ser",
  "tor",
  "um",
  "ver",
  "wyn",
  "xil",
] as const;

const FALLBACK_ENDINGS = [
  "a",
  "en",
  "ia",
  "is",
  "on",
  "or",
  "um",
  "us",
  "yn",
  "ar",
  "el",
  "ir",
] as const;

function generatedFallbackAgentName(index: number): string | null {
  const perPrefix = FALLBACK_STEMS.length * FALLBACK_ENDINGS.length;
  const total = FALLBACK_PREFIXES.length * perPrefix;
  if (index >= total) return null;

  const prefix = FALLBACK_PREFIXES[Math.floor(index / perPrefix)]!;
  const rest = index % perPrefix;
  const stem = FALLBACK_STEMS[Math.floor(rest / FALLBACK_ENDINGS.length)]!;
  const ending = FALLBACK_ENDINGS[rest % FALLBACK_ENDINGS.length]!;
  return `${prefix}${stem}${ending}`;
}

export function suggestAgentNames(existingNames: Iterable<string> = []): string[] {
  const existing = new Set([...existingNames].map(normalizeAgentNameInput));
  const suggestions: string[] = PREFERRED_AGENT_NAMES.filter((name) => !existing.has(name));
  for (let index = 0; suggestions.length < 20; index++) {
    const candidate = generatedFallbackAgentName(index);
    if (!candidate) break;
    if (existing.has(candidate) || suggestions.includes(candidate)) continue;
    suggestions.push(candidate);
  }
  return suggestions;
}

export function validateAgentName(name: string, existingNames: Iterable<string> = []): string {
  const normalized = normalizeAgentNameInput(name);
  const suggestions = suggestAgentNames(existingNames).slice(0, 5);

  if (!normalized) {
    throw new InvalidAgentNameError(name, "choose a real one-word name instead of an empty value", suggestions);
  }
  if (/\s/.test(normalized)) {
    throw new InvalidAgentNameError(name, "use a single word, preferably a Roman or Greek name", suggestions);
  }
  if (normalized.length < 3) {
    throw new InvalidAgentNameError(name, "use a more distinctive name with at least three characters", suggestions);
  }
  if (isGenericAgentName(normalized)) {
    throw new InvalidAgentNameError(name, "generic names like agent, agent-1, assistant, or worker-2 are reserved", suggestions);
  }
  if (hasGeneratedNumericSuffix(normalized)) {
    throw new InvalidAgentNameError(name, "numbered suffix names are not allowed; pick a distinct human-readable name", suggestions);
  }
  if (!ONE_WORD_NAME_RE.test(normalized)) {
    throw new InvalidAgentNameError(name, "use one word made of letters only, preferably a Roman or Greek name", suggestions);
  }

  return normalized;
}

export interface AgentNameNormalization {
  id: string;
  old_name: string;
  new_name: string;
  applied: false;
  disposition: "candidate";
  alias_kind: "candidate";
  status: "quarantined";
  name_updates: 0;
  reference_updates: 0;
}

/**
 * Plan safe replacement labels without changing the local actor label.
 *
 * The current agents.name and every historical reference remain unchanged and
 * discoverable. This planner is byte-for-byte read-only; persisting a
 * quarantined candidate requires a separate explicit reconciliation action.
 */
export function normalizeGeneratedAgentNames(db: Database): AgentNameNormalization[] {
  const rows = db.query("SELECT * FROM agents ORDER BY created_at, id").all() as Agent[];
  const existing = new Set(rows.map((agent) => normalizeAgentNameInput(agent.name)));
  const planned: AgentNameNormalization[] = [];

  for (const agent of rows) {
    const oldName = normalizeAgentNameInput(agent.name);
    if (!isBlockedAgentName(oldName)) continue;

    const candidates = suggestAgentNames(existing);
    const replacement = candidates[0];
    if (!replacement) {
      throw new Error("No safe agent names are available for normalization");
    }

    existing.add(replacement);
    planned.push({
      id: agent.id,
      old_name: oldName,
      new_name: replacement,
      applied: false,
      disposition: "candidate",
      alias_kind: "candidate",
      status: "quarantined",
      name_updates: 0,
      reference_updates: 0,
    });
  }

  return planned;
}

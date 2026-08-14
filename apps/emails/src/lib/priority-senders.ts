export type PrioritySenderRuleKind = "address" | "domain";

export interface PrioritySenderRule {
  id: string;
  kind: PrioritySenderRuleKind;
  value: string;
  created_at?: string;
}

const LOCAL_PART = /^[^@\s<>]+$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizePriorityRuleKind(value: unknown): PrioritySenderRuleKind {
  const kind = String(value ?? "").trim().toLowerCase();
  if (kind !== "address" && kind !== "domain") {
    throw new RangeError("priority sender rule kind must be 'address' or 'domain'");
  }
  return kind;
}

export function normalizePriorityDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/^@+/, "").replace(/\.+$/, "");
  const labels = domain.split(".");
  if (!domain || labels.length < 2 || labels.some((label) => !DOMAIN_LABEL.test(label))) {
    throw new RangeError("priority sender domain must be a valid domain such as example.com");
  }
  return domain;
}

export function normalizePriorityAddress(value: string): string {
  const trimmed = value.trim();
  const angled = trimmed.match(/^.+<([^<>]+)>$/);
  const address = (angled?.[1] ?? trimmed).trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at <= 0 || at !== address.indexOf("@") || !LOCAL_PART.test(address.slice(0, at))) {
    throw new RangeError("priority sender address must be a valid email address such as person@example.com");
  }
  const domain = normalizePriorityDomain(address.slice(at + 1));
  return `${address.slice(0, at)}@${domain}`;
}

export function normalizePriorityRuleValue(kind: PrioritySenderRuleKind, value: string): string {
  return kind === "address" ? normalizePriorityAddress(value) : normalizePriorityDomain(value);
}

export function normalizePriorityRuleInput(kind: unknown, value: unknown): { kind: PrioritySenderRuleKind; value: string } {
  const normalizedKind = normalizePriorityRuleKind(kind);
  if (typeof value !== "string") throw new RangeError("priority sender rule value is required");
  return { kind: normalizedKind, value: normalizePriorityRuleValue(normalizedKind, value) };
}

export function prioritySenderRuleId(kind: PrioritySenderRuleKind, value: string): string {
  return `priority:${kind}:${value}`;
}

export function priorityRuleMatchesSender(sender: string, rules: readonly PrioritySenderRule[]): boolean {
  let address: string;
  try {
    address = normalizePriorityAddress(sender);
  } catch {
    return false;
  }
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return rules.some((rule) =>
    (rule.kind === "address" && rule.value === address)
    || (rule.kind === "domain" && rule.value === domain),
  );
}

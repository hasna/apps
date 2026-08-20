export function normalizeChannelName(input: string): string {
  const withoutHash = input.trim().replace(/^#+/, "").toLowerCase();
  const ascii = withoutHash.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = ascii
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return cleaned || "channel";
}

/**
 * The message a caller gets when they send to a channel that does not exist.
 *
 * It lives in this module — which holds no storage dependency — so the SQLite
 * path (src/lib/messages.ts) and the Postgres server path (src/server/api.ts)
 * can share one wording without the server importing the local database layer.
 * The two backends have diverged before, and a guard present on only one is
 * absent exactly where it matters.
 *
 * The remedy is named in the text: a refusal an agent cannot act on gets
 * retried unchanged.
 */
export function unknownChannelMessage(channel: string): string {
  return `Channel "${channel}" does not exist, so this message was not sent. `
    + `Check the name with 'conversations channel list', or create it with `
    + `'conversations channel create ${channel}' if it is genuinely new.`;
}

/**
 * The message a caller gets when they send to a channel that is archived.
 *
 * Same placement rationale as unknownChannelMessage: this module holds no
 * storage dependency, so the SQLite path (src/lib/messages.ts) and the
 * Postgres server path (src/server/api.ts) share one wording and the two
 * backends cannot diverge — a guard present on only one is absent exactly
 * where it matters.
 *
 * The remedy is named in the text: archived channels are read-only history,
 * and a refusal an agent cannot act on gets retried unchanged.
 */
export function archivedChannelMessage(channel: string): string {
  return `Channel "${channel}" is archived, so this message was not sent. `
    + `Archived channels are read-only history. Check live channels with `
    + `'conversations channel list --archived', or unarchive it with `
    + `'conversations channel unarchive ${channel}' if it should accept new posts again.`;
}

export function buildLegacyChannelNameMap(legacyNames: Iterable<string>): Map<string, string> {
  const names = [...new Set([...legacyNames].map((name) => name.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const grouped = new Map<string, string[]>();
  for (const name of names) {
    const normalized = normalizeChannelName(name);
    const group = grouped.get(normalized) ?? [];
    group.push(name);
    grouped.set(normalized, group);
  }

  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const [base, group] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const canonical = group.includes(base)
      ? base
      : group.find((name) => !name.trim().startsWith("#")) ?? group[0]!;

    for (const name of group) {
      const channel = name === canonical ? reserve(base, used) : reserve(`${base}--${stableSuffix(name)}`, used);
      result.set(name, channel);
    }
  }
  return result;
}

function reserve(candidate: string, used: Set<string>): string {
  let value = candidate;
  let index = 2;
  while (used.has(value)) {
    value = `${candidate}-${index}`;
    index++;
  }
  used.add(value);
  return value;
}

function stableSuffix(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 6);
}

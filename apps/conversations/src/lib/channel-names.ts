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
 * The message a caller gets when it addresses a channel name reserved as a
 * historical alias. Aliases are deliberately rejected rather than redirected
 * so callers cannot accidentally post to a renamed channel under stale
 * routing information.
 */
export function reservedHistoricalChannelMessage(channel: string, currentChannel: string): string {
  return `Channel #${channel} is a reserved historical alias for #${currentChannel}.`;
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

/**
 * The channel a `to` recipient names, if it can name one at all.
 *
 * `to` is not only a DM recipient. The documented send contract — what the
 * generic workflow scripts and the fleet runbooks post — is
 * `POST /v1/messages {to: "<channel>", content}`: `to` NAMES THE CHANNEL.
 * Before this resolver existed that body fell through to the DM branch: the
 * row was written with `channel = NULL` and
 * `session_id = "<from>-<to>-<hash>"`, the API answered 201 with a message
 * object, and the message was invisible to `GET /v1/messages?channel=<name>`
 * — a SILENT loss of #incidents alerts, project summaries and cross-agent
 * handoffs (BUG-0041).
 *
 * The candidate name is derived HERE, once, and each backend adds only its own
 * existence lookup (`to` binds to a channel when a channel of that name
 * exists, and stays a DM recipient otherwise). A decision expressed once
 * cannot be present on one backend and absent on the other, which is exactly
 * where this class of defect survives — the same rationale that puts
 * unknownChannelMessage/archivedChannelMessage in this storage-free module.
 *
 * Returns null for a non-string, for an empty/whitespace value, and for input
 * with no usable characters (`normalizeChannelName` falls back to the literal
 * `"channel"` there, which is not a recipient anybody wrote).
 */
export function recipientChannelCandidate(to: unknown): string | null {
  if (typeof to !== "string") return null;
  const raw = to.trim();
  if (raw.length === 0) return null;
  if (!/[a-z0-9]/i.test(raw)) return null;
  return normalizeChannelName(raw);
}

/**
 * The channel-membership predicate a channel listing must use.
 *
 * A send that names its channel only in `to` (`{to: <channel>, content}` — the
 * documented contract the generic workflow scripts and the fleet runbooks
 * post) is bound to the channel on the way in by `recipientChannelCandidate`.
 * Rows written BEFORE that binding existed do not have it: they carry
 * `channel = NULL` with the channel name sitting in `to_agent`, so no channel
 * read can ever reach them. The listing selected `channel = <name>` alone, and
 * a reviewer asking "do the claimed posts exist?" found nothing while the
 * caller held a 200/201 with a message id — the silent loss BUG-0062 records,
 * still unrepaired for every row already stored (message 789923 among them).
 *
 * So a message belongs to channel `<name>` when its `channel` column IS that
 * name, OR when it has no channel at all and was ADDRESSED to that name. The
 * second arm cannot capture a live DM: a `to` naming an existing channel is
 * bound to it on write, so only rows written before that binding — i.e. rows
 * whose author meant the channel, per the contract — can match.
 *
 * The rule is expressed once, here, so both backends interpolate their own
 * placeholder into the SAME predicate: the PG collection query (src/server/api.ts)
 * and the SQLite preview read (src/lib/messages.ts). A membership rule present
 * on only one backend is absent exactly where it matters — the same rationale
 * that puts unknownChannelMessage/recipientChannelCandidate in this
 * storage-free module.
 *
 * PostgreSQL may reuse one `$n` twice in a predicate, so its call site passes
 * `$n` once; SQLite's `?` binds positionally, so its call site pushes the
 * normalized name twice. `column` is the channel column as spelled in the
 * calling query.
 */
export function channelListingMatchSql(column: string, placeholder: string): string {
  return `(${column} = ${placeholder} OR (${column} IS NULL AND lower(to_agent) = lower(${placeholder})))`;
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

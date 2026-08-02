export type MessageReference =
  | { kind: "id"; id: number }
  | { kind: "uuid"; uuid: string };

const COMPACT_UUID = /^[0-9a-f]{32}$/i;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeMessageUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return COMPACT_UUID.test(normalized) || CANONICAL_UUID.test(normalized)
    ? normalized
    : null;
}

export function parseMessageReference(value: unknown): MessageReference | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (/^[1-9]\d*$/.test(raw)) {
    const id = Number(raw);
    return Number.isSafeInteger(id) ? { kind: "id", id } : null;
  }
  const uuid = normalizeMessageUuid(raw);
  return uuid ? { kind: "uuid", uuid } : null;
}

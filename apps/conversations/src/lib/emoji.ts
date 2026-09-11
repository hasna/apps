/** Canonical reaction emoji form (NFKC). Pure; shared by the API store and the reactions domain library. */
export function normalizeEmoji(emoji: string): string {
  return emoji.normalize("NFKC");
}

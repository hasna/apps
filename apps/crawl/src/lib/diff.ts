// ─── Diff ─────────────────────────────────────────────────────────────────────

export function diffTexts(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const line of newLines) {
    if (oldSet.has(line)) {
      unchanged++;
    } else {
      added++;
    }
  }

  for (const line of oldLines) {
    if (!newSet.has(line)) {
      removed++;
    }
  }

  const parts: string[] = [];
  if (added > 0) parts.push(`${added} line${added === 1 ? "" : "s"} added`);
  if (removed > 0) parts.push(`${removed} line${removed === 1 ? "" : "s"} removed`);
  parts.push(`${unchanged} unchanged`);

  return parts.join(", ");
}

export function hasSignificantChange(oldText: string, newText: string): boolean {
  if (oldText === newText) return false;

  const oldLen = oldText.length;
  const newLen = newText.length;

  if (oldLen === 0 && newLen === 0) return false;
  if (oldLen === 0) return true;

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  let changed = 0;
  const total = Math.max(oldLines.length, newLines.length);

  for (const line of newLines) {
    if (!oldSet.has(line)) changed++;
  }
  for (const line of oldLines) {
    if (!newSet.has(line)) changed++;
  }

  const changeRatio = changed / (total * 2);
  return changeRatio > 0.05;
}

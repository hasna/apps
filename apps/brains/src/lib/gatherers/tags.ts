export function parseTagList(value: string | null | undefined): string[] {
  if (!value?.trim()) return []

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    return []
  }
}

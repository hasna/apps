// Minimal cron expression parser.
// Supports standard 5-field cron: min hour dom mon dow
// Each field can be: * | number | star/step | a-b | a,b,...

function parseField(field: string, min: number, max: number): number[] {
  const result: number[] = []

  for (const rawPart of field.split(",")) {
    const part = rawPart.trim()
    if (!part) throw new Error(`Invalid cron field: ${field}`)

    const [rangePart, stepPart, extra] = part.split("/")
    if (extra !== undefined || !rangePart) throw new Error(`Invalid cron field: ${field}`)

    const hasStep = stepPart !== undefined
    const step = hasStep ? parseCronNumber(stepPart, field) : 1
    if (step < 1) throw new Error(`Invalid cron step in field: ${field}`)

    const { from, to } = parseFieldRange(rangePart, min, max, field, hasStep)
    for (let v = from; v <= to; v += step) result.push(v)
  }

  return [...new Set(result)].sort((a, b) => a - b)
}

function parseFieldRange(
  rangePart: string,
  min: number,
  max: number,
  field: string,
  hasStep: boolean
): { from: number; to: number } {
  if (rangePart === "*") return { from: min, to: max }

  if (rangePart.includes("-")) {
    const [fromPart, toPart, extra] = rangePart.split("-")
    if (extra !== undefined || !fromPart || !toPart) throw new Error(`Invalid cron field: ${field}`)
    const from = parseCronNumber(fromPart, field)
    const to = parseCronNumber(toPart, field)
    validateRange(from, to, min, max, field)
    return { from, to }
  }

  const from = parseCronNumber(rangePart, field)
  const to = hasStep ? max : from
  validateRange(from, to, min, max, field)
  return { from, to }
}

function parseCronNumber(value: string, field: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid cron field: ${field}`)
  return Number.parseInt(value, 10)
}

function validateRange(from: number, to: number, min: number, max: number, field: string): void {
  if (from < min || from > max || to < min || to > max || from > to) {
    throw new Error(`Invalid cron field range: ${field}`)
  }
}

export function getNextRunTime(cronExpr: string, from: Date = new Date()): Date {
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Invalid cron expression (need 5 fields): ${cronExpr}`)

  const [minField, hourField, domField, monField, dowField] = parts as [string, string, string, string, string]

  const minutes = parseField(minField, 0, 59)
  const hours = parseField(hourField, 0, 23)
  const doms = parseField(domField, 1, 31)
  const months = parseField(monField, 1, 12)
  const dows = parseField(dowField, 0, 6) // 0=Sun

  // Start from next minute
  const next = new Date(from)
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + 1)

  // Search up to 4 years forward
  const limit = new Date(from)
  limit.setFullYear(limit.getFullYear() + 4)

  while (next <= limit) {
    const mon = next.getMonth() + 1 // 1-12
    if (!months.includes(mon)) {
      // Skip to first day of next valid month
      next.setDate(1)
      next.setHours(0, 0, 0, 0)
      next.setMonth(next.getMonth() + 1)
      continue
    }

    const dom = next.getDate()
    const dow = next.getDay() // 0=Sun
    const domMatch = domField === "*" || doms.includes(dom)
    const dowMatch = dowField === "*" || dows.includes(dow)

    // Standard cron: if both dom and dow are restricted, either match works
    const dayMatch = domField === "*" && dowField === "*"
      ? true
      : domField !== "*" && dowField !== "*"
        ? domMatch || dowMatch
        : domField !== "*"
          ? domMatch
          : dowMatch

    if (!dayMatch) {
      next.setDate(next.getDate() + 1)
      next.setHours(0, 0, 0, 0)
      continue
    }

    const h = next.getHours()
    const validHour = hours.find(v => v >= h)
    if (validHour === undefined) {
      next.setDate(next.getDate() + 1)
      next.setHours(0, 0, 0, 0)
      continue
    }

    if (validHour > h) {
      next.setHours(validHour, 0, 0, 0)
    }

    const m = next.getMinutes()
    const validMin = minutes.find(v => v >= m)
    if (validMin === undefined) {
      // No valid minute in this hour, go to next hour
      next.setHours(next.getHours() + 1, 0, 0, 0)
      continue
    }

    next.setMinutes(validMin)
    return next
  }

  throw new Error(`Could not find next run time for cron: ${cronExpr}`)
}

export function validateCron(expr: string): string | null {
  try {
    getNextRunTime(expr, new Date())
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

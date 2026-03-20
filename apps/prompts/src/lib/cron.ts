// Minimal cron expression parser.
// Supports standard 5-field cron: min hour dom mon dow
// Each field can be: * | number | star/step | a-b | a,b,...

function parseField(field: string, min: number, max: number): number[] {
  if (field === "*") {
    return range(min, max)
  }
  const result: number[] = []
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [rangeOrStar, stepStr] = part.split("/")
      const step = parseInt(stepStr ?? "1", 10)
      const start = rangeOrStar === "*" ? min : parseInt(rangeOrStar ?? String(min), 10)
      for (let v = start; v <= max; v += step) result.push(v)
    } else if (part.includes("-")) {
      const [fromStr, toStr] = part.split("-")
      const from = parseInt(fromStr ?? String(min), 10)
      const to = parseInt(toStr ?? String(max), 10)
      for (let v = from; v <= to; v++) result.push(v)
    } else {
      result.push(parseInt(part, 10))
    }
  }
  return [...new Set(result)].sort((a, b) => a - b).filter(v => v >= min && v <= max)
}

function range(min: number, max: number): number[] {
  const r: number[] = []
  for (let i = min; i <= max; i++) r.push(i)
  return r
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

import type { LogsClient } from "@hasna/logs"

let client: LogsClient | null = null

export async function getLogger(): Promise<LogsClient | null> {
  if (client) return client
  const url = process.env.LOGS_URL
  const projectId = process.env.LOGS_PROJECT_ID
  const apiKey = process.env.LOGS_API_KEY
  if (!projectId) return null
  const { LogsClient } = await import("@hasna/logs")
  client = new LogsClient({ url, projectId, apiKey })
  return client
}

export async function logError(
  message: string,
  opts?: {
    service?: string
    stack?: string
    metadata?: Record<string, unknown>
    traceId?: string
  },
): Promise<void> {
  try {
    const logger = await getLogger()
    if (!logger) return
    await logger.push({
      level: "error",
      message,
      source: "sdk",
      service: opts?.service,
      stack_trace: opts?.stack,
      trace_id: opts?.traceId,
      metadata: opts?.metadata,
    })
  } catch {
    // Don't fail the app if logging fails
  }
}

export async function logInfo(
  message: string,
  opts?: { service?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    const logger = await getLogger()
    if (!logger) return
    await logger.push({
      level: "info",
      message,
      source: "sdk",
      service: opts?.service,
      metadata: opts?.metadata,
    })
  } catch {
    // Don't fail the app if logging fails
  }
}

export async function logWarn(
  message: string,
  opts?: { service?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    const logger = await getLogger()
    if (!logger) return
    await logger.push({
      level: "warn",
      message,
      source: "sdk",
      service: opts?.service,
      metadata: opts?.metadata,
    })
  } catch {
    // Don't fail the app if logging fails
  }
}

export interface LocalLogOptions {
  service?: string;
  stack?: string;
  metadata?: Record<string, unknown>;
  traceId?: string;
}

export function getLogger(): null {
  return null;
}

export async function logError(
  _message: string,
  _opts?: LocalLogOptions,
): Promise<void> {
}

export async function logInfo(
  _message: string,
  _opts?: Omit<LocalLogOptions, "stack" | "traceId">,
): Promise<void> {
}

export async function logWarn(
  _message: string,
  _opts?: Omit<LocalLogOptions, "stack" | "traceId">,
): Promise<void> {
}

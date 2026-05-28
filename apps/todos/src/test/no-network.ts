type NetworkTrapResult<T> = {
  result: T;
  calls: string[];
};

export async function withNoNetwork<T>(run: () => T | Promise<T>): Promise<NetworkTrapResult<T>> {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    throw new Error("Unexpected network call in local-only test");
  }) as unknown as typeof fetch;

  try {
    const result = await run();
    return { result, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

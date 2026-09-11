/** Stop waiting for transport backpressure when a bridge is shutting down.
 * The underlying send may remain unresolved; its eventual settlement is consumed,
 * but never authorizes a delivery checkpoint after the bridge is stopped.
 */
export function awaitChannelDelivery(deliver: () => Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("Channel delivery stopped"));
  return new Promise<void>((resolve, reject) => {
    const stopped = () => { cleanup(); reject(new Error("Channel delivery stopped")); };
    const cleanup = () => signal.removeEventListener("abort", stopped);
    signal.addEventListener("abort", stopped, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw new Error("Channel delivery stopped");
      return deliver();
    }).then(() => {
      cleanup();
      if (signal.aborted) reject(new Error("Channel delivery stopped")); else resolve();
    }, error => { cleanup(); reject(error); });
  });
}

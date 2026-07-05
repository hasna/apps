import { createFeedbackHandler, type FeedbackApiOptions } from "../api.js";
import { createFeedbackStore } from "../storage.js";

export interface StartFeedbackServerOptions extends FeedbackApiOptions {
  host?: string;
  port?: number;
}

export function startFeedbackServer(options: StartFeedbackServerOptions = {}): ReturnType<typeof Bun.serve> {
  const host = options.host ?? process.env["FEEDBACK_HOST"] ?? "127.0.0.1";
  const port = options.port ?? Number.parseInt(process.env["FEEDBACK_PORT"] ?? "8787", 10);
  const handler = createFeedbackHandler({ ...options, store: options.store ?? createFeedbackStore() });
  return Bun.serve({
    hostname: host,
    port,
    fetch: handler,
  });
}

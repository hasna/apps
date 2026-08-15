import type { FeedbackContext } from "./types.js";

export interface BrowserFeedbackContextOptions {
  route?: string;
  screen?: string;
  version?: string;
  commit?: string;
  environment?: string;
  sessionId?: string;
}

export function collectBrowserFeedbackContext(options: BrowserFeedbackContextOptions = {}): FeedbackContext {
  const windowRef = typeof window === "undefined" ? undefined : window;
  const navigatorRef = typeof navigator === "undefined" ? undefined : navigator;
  const route = options.route ?? windowRef?.location?.pathname;
  const url = windowRef?.location?.href;
  const viewport = windowRef ? `${windowRef.innerWidth}x${windowRef.innerHeight}` : undefined;

  return {
    route,
    screen: options.screen,
    url,
    version: options.version,
    commit: options.commit,
    environment: options.environment,
    userAgent: navigatorRef?.userAgent,
    sessionId: options.sessionId,
    locale: navigatorRef?.language,
    viewport,
  };
}

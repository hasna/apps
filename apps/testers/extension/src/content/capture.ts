// Content script: runs at document_start on every page.
// Wraps console methods and listens for JS errors, sending events to the background worker.

(function () {
  // Prevent double-injection
  if ((window as any).__testersRecorderInjected) return;
  (window as any).__testersRecorderInjected = true;

  // Buffer to batch console messages
  const buffer: any[] = [];
  let flushTimer: number | null = null;

  function flush() {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    chrome.runtime.sendMessage({
      type: "console-batch",
      payload: { entries: batch, url: window.location.href },
    }).catch(() => {}); // may fail in some contexts
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = window.setInterval(() => {
      flush();
      if (buffer.length === 0 && flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
    }, 500);
  }

  function serializeArg(arg: any): string {
    try {
      if (arg instanceof Error) {
        return arg.toString() + "\n" + arg.stack;
      }
      if (typeof arg === "object" && arg !== null) {
        return JSON.stringify(arg, null, 2);
      }
      return String(arg);
    } catch {
      return "[unserializable]";
    }
  }

  function captureStack(): string | undefined {
    try {
      throw new Error();
    } catch (e: any) {
      return e.stack?.split("\n").slice(2, 6).join("\n");
    }
  }

  // Wrap console methods
  const methods: Array<"log" | "warn" | "error" | "info" | "debug"> = [
    "log", "warn", "error", "info", "debug",
  ];

  const originals: Record<string, Function> = {};

  for (const method of methods) {
    originals[method] = console[method].bind(console);
    console[method] = function (...args: any[]) {
      // Call original first
      originals[method].apply(console, args);

      // Then capture
      const entry = {
        level: method,
        messages: args.map(serializeArg),
        timestamp: new Date().toISOString(),
        stack: method === "error" || method === "warn" ? captureStack() : undefined,
      };

      buffer.push(entry);
      scheduleFlush();
    };
  }

  // Capture window.onerror
  const originalOnError = window.onerror;
  window.onerror = function (msg, url, line, col, error) {
    chrome.runtime.sendMessage({
      type: "error",
      payload: {
        message: String(msg),
        stack: error ? error.stack : `at ${url}:${line}:${col}`,
        timestamp: new Date().toISOString(),
      },
    }).catch(() => {});

    if (originalOnError) return originalOnError.apply(this, arguments as any);
    return false;
  };

  // Capture unhandled promise rejections
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason instanceof Error
      ? event.reason
      : { message: String(event.reason), stack: undefined };

    chrome.runtime.sendMessage({
      type: "error",
      payload: {
        message: reason.message || "Unhandled Promise rejection",
        stack: reason.stack || "",
        timestamp: new Date().toISOString(),
      },
    }).catch(() => {});
  });

  // Flush on page unload
  window.addEventListener("beforeunload", () => {
    flush();
  });
})();

/**
 * Environment detection — determine if a site is prod, dev, staging, or local.
 */

import type { Page } from "playwright";

export type Environment = "local" | "dev" | "staging" | "prod";

export interface EnvDetectionResult {
  env: Environment;
  confidence: "high" | "medium" | "low";
  signals: string[];
}

export async function detectEnvironment(page: Page): Promise<EnvDetectionResult> {
  const url = page.url();
  const signals: string[] = [];
  let score = { local: 0, dev: 0, staging: 0, prod: 0 };

  // URL-based detection
  try {
    const u = new URL(url);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "0.0.0.0" || u.hostname.endsWith(".local")) {
      score.local += 5; signals.push(`URL hostname: ${u.hostname} → local`);
    } else if (u.hostname.match(/^(dev|development)\./i) || u.port !== "") {
      score.dev += 4; signals.push(`URL pattern: ${u.hostname}:${u.port} → dev`);
    } else if (u.hostname.match(/^(staging|stg|stage|preprod|uat)\./i)) {
      score.staging += 4; signals.push(`URL pattern: ${u.hostname} → staging`);
    } else {
      score.prod += 2; signals.push(`URL looks production: ${u.hostname}`);
    }

    // Non-standard ports suggest dev/staging
    if (u.port && !["80", "443", ""].includes(u.port)) {
      score.dev += 2; signals.push(`Non-standard port: ${u.port}`);
    }

    // HTTPS = likely prod, HTTP = likely dev
    if (u.protocol === "https:") {
      score.prod += 1; signals.push("HTTPS → likely prod");
    } else {
      score.dev += 2; signals.push("HTTP → likely dev/local");
    }
  } catch {}

  // Page-based detection via evaluate
  try {
    const pageSignals = await page.evaluate(() => {
      const s: string[] = [];

      // Check for common env variables exposed in window
      const w = window as any;
      const envVars = ["__ENV__", "__NEXT_DATA__", "__NUXT__", "process"];
      for (const v of envVars) {
        if (w[v]) {
          const env = w[v]?.env?.NODE_ENV ?? w[v]?.runtimeConfig?.public?.env ?? w[v]?.props?.pageProps?.env;
          if (env) s.push(`window.${v}: ${env}`);
        }
      }

      // React dev tools
      if (w.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size > 0) {
        // Check if React is in development mode
        const fiber = document.querySelector("[data-reactroot]") || document.getElementById("__next") || document.getElementById("root");
        if (fiber) s.push("React app detected");
      }

      // Check meta tags for env
      const envMeta = document.querySelector('meta[name="environment"], meta[name="env"], meta[name="deploy-env"]');
      if (envMeta) s.push(`meta[environment]: ${envMeta.getAttribute("content")}`);

      // Check for source maps (link in HTML or .map references)
      const scripts = document.querySelectorAll("script[src]");
      let minified = 0, unminified = 0;
      scripts.forEach(s => {
        const src = s.getAttribute("src") ?? "";
        if (src.includes(".min.") || src.match(/\.[a-f0-9]{8,}\./)) minified++;
        else if (src.endsWith(".js") && !src.includes("chunk")) unminified++;
      });
      if (unminified > minified && unminified > 2) s.push(`Unminified scripts (${unminified}/${minified + unminified}) → likely dev`);
      else if (minified > 0) s.push(`Minified/hashed scripts (${minified}/${minified + unminified}) → likely prod`);

      // Check for debug/dev console output
      // (We can't retroactively check console, but we can check for common dev indicators)
      if (document.querySelector("[data-testid]")) s.push("data-testid attributes present → dev/staging");

      // Service worker
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        s.push("Service worker active → likely prod");
      }

      // Error tracking SDKs (prod indicators)
      if (w.Sentry) s.push("Sentry SDK loaded → prod monitoring");
      if (w.__DATADOG_SYNTHETICS_INLINED_SCRIPT) s.push("Datadog loaded → prod monitoring");
      if (w.LogRocket) s.push("LogRocket loaded → prod monitoring");
      if (w._lr_loaded) s.push("LogRocket loaded → prod monitoring");

      // Analytics (prod indicators)
      if (w.gtag || w.ga) s.push("Google Analytics loaded → likely prod");
      if (w.posthog || w._ph) s.push("PostHog loaded → prod analytics");
      if (w.mixpanel) s.push("Mixpanel loaded → prod analytics");

      // Robots meta
      const robots = document.querySelector('meta[name="robots"]');
      if (robots) {
        const content = robots.getAttribute("content") ?? "";
        if (content.includes("noindex")) s.push(`robots: noindex → staging/dev`);
      }

      return s;
    });

    for (const signal of pageSignals) {
      signals.push(signal);
      if (signal.includes("development") || signal.includes("→ dev") || signal.includes("→ likely dev")) score.dev += 2;
      if (signal.includes("production") || signal.includes("→ prod") || signal.includes("→ likely prod")) score.prod += 2;
      if (signal.includes("staging") || signal.includes("→ staging")) score.staging += 2;
      if (signal.includes("monitoring") || signal.includes("analytics")) score.prod += 1;
      if (signal.includes("noindex")) { score.staging += 2; score.dev += 1; }
    }
  } catch {}

  // Determine winner
  const entries = Object.entries(score) as [Environment, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const [env, topScore] = entries[0];
  const [, secondScore] = entries[1];
  const confidence = topScore >= 5 ? "high" : topScore > secondScore + 1 ? "medium" : "low";

  return { env, confidence, signals };
}

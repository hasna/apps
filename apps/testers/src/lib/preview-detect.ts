/**
 * Detect preview deploy URLs from PR context.
 * Supports Vercel, Railway, Render, Fly.io, Netlify, and Cloudflare Pages.
 */

export type DeployProvider = "vercel" | "railway" | "render" | "fly" | "netlify" | "cloudflare" | "custom";

export interface DeployInfo {
  provider: DeployProvider;
  url: string;
  commit?: string;
  branch?: string;
  prNumber?: number;
}

/**
 * Extract preview deploy URL from environment variables.
 * CI platforms and deployment providers set specific env vars.
 */
export function detectDeployUrl(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): DeployInfo | null {
  // Vercel
  if (env.VERCEL_URL && env.VERCEL !== "0") {
    return {
      provider: "vercel",
      url: `https://${env.VERCEL_URL}`,
      commit: env.VERCEL_GIT_COMMIT_SHA,
      branch: env.VERCEL_GIT_COMMIT_REF,
    };
  }

  // Railway
  if (env.RAILWAY_PUBLIC_URL) {
    return {
      provider: "railway",
      url: env.RAILWAY_PUBLIC_URL,
    };
  }

  // Render
  if (env.RENDER_EXTERNAL_URL) {
    return {
      provider: "render",
      url: env.RENDER_EXTERNAL_URL,
      branch: env.RENDER_GIT_BRANCH,
      commit: env.RENDER_GIT_COMMIT,
    };
  }

  // Fly.io
  if (env.FLY_APP_NAME && env.FLY_RELEASE_VERSION) {
    return {
      provider: "fly",
      url: `https://${env.FLY_APP_NAME}.fly.dev`,
    };
  }

  // Netlify
  if (env.CONTEXT === "deploy-preview" && env.DEPLOY_URL) {
    return {
      provider: "netlify",
      url: env.DEPLOY_URL,
      branch: env.BRANCH,
      commit: env.COMMIT_REF,
    };
  }

  // Cloudflare Pages
  if (env.CF_PAGES_URL && env.CF_PAGES_DEPLOYMENT_TYPE === "preview") {
    return {
      provider: "cloudflare",
      url: env.CF_PAGES_URL,
      branch: env.CF_PAGES_BRANCH,
      commit: env.CF_PAGES_COMMIT_SHA,
    };
  }

  // GitHub Actions — check for PR preview URL in custom env var
  if (env.GITHUB_EVENT_NAME === "pull_request" && env.PR_PREVIEW_URL) {
    return {
      provider: "custom",
      url: env.PR_PREVIEW_URL,
    };
  }

  return null;
}

/**
 * Parse a PR number from the deploy URL or environment.
 * Common patterns: pr-123, pr_123, pull-123, /pulls/123
 */
export function parsePrNumber(value: string): number | null {
  const match = value.match(/pr[-_](\d+)|pull[-_](\d+)|pulls\/(\d+)/i);
  if (match) {
    return parseInt(match[1] ?? match[2] ?? match[3] ?? "0", 10);
  }
  return null;
}

/**
 * Build a PR-specific test URL from common preview URL patterns.
 */
export function buildPreviewUrl(
  baseUrl: string,
  prNumber: number,
  provider?: DeployProvider,
): string | null {
  const pr = prNumber;

  switch (provider) {
    case "vercel":
      // Vercel: pr-{num}-{repo}-{org}.vercel.app
      return baseUrl;

    case "netlify":
      // Netlify: {deploy-id}--{site-name}.netlify.app
      return baseUrl;

    case "cloudflare":
      // Cloudflare: {branch}.{project}.pages.dev
      return baseUrl;

    default:
      // Generic: try common patterns
      return null;
  }
}
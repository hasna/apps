import type { DriverAction, SafetyConfig } from "../types/index.js";

/** Result of a safety check */
export interface SafetyCheckResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
}

/** Default blocked apps — never interact with these */
const DEFAULT_BLOCKED_APPS = [
  "Keychain Access",
  "System Preferences",
  "System Settings",
  "1Password",
  "Bitwarden",
  "LastPass",
  "KeePassXC",
];

/** Rate limiter state */
let actionTimestamps: number[] = [];

/**
 * Check whether an action is safe to execute.
 * Returns { allowed, reason, requiresConfirmation }.
 */
export function checkAction(
  action: DriverAction,
  config: SafetyConfig
): SafetyCheckResult {
  // Check rate limit
  const rateResult = checkRateLimit(config.maxActionsPerMinute ?? 60);
  if (!rateResult.allowed) return rateResult;

  switch (action.type) {
    case "open_app": {
      const blocked = [
        ...DEFAULT_BLOCKED_APPS,
        ...(config.blockedApps ?? []),
      ];
      const appLower = action.name.toLowerCase();
      for (const b of blocked) {
        if (appLower.includes(b.toLowerCase())) {
          return {
            allowed: false,
            reason: `Blocked app: "${action.name}" matches blocklist entry "${b}"`,
          };
        }
      }
      return { allowed: true };
    }

    case "open_url": {
      const blocked = config.blockedDomains ?? [];
      if (blocked.length > 0) {
        try {
          const hostname = new URL(action.url).hostname.toLowerCase();
          for (const domain of blocked) {
            if (hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`)) {
              return {
                allowed: false,
                reason: `Blocked domain: "${hostname}" matches blocklist entry "${domain}"`,
              };
            }
          }
        } catch {
          // Invalid URL — let it through, the OS will handle the error
        }
      }
      return { allowed: true };
    }

    case "type": {
      // Check if typing something that looks like a password
      if (!config.allowPasswordTyping) {
        // Heuristic: if the text is short and contains mixed case/numbers/symbols,
        // it might be a password. We can't know for sure, but we can flag it.
        // This is intentionally conservative — only flag if confirmClicks is enabled.
        if (config.confirmClicks && looksLikePassword(action.text)) {
          return {
            allowed: true,
            requiresConfirmation: true,
            reason: `Text looks like it might be a password or sensitive data`,
          };
        }
      }
      return { allowed: true };
    }

    case "click": {
      if (config.confirmClicks) {
        return {
          allowed: true,
          requiresConfirmation: true,
          reason: "Click confirmation enabled in config",
        };
      }
      return { allowed: true };
    }

    case "key": {
      // Block potentially destructive key combos
      const dangerous = [
        "cmd+shift+delete", // Empty trash
        "cmd+option+escape", // Force quit
      ];
      const keysLower = action.keys.toLowerCase().replace(/\s/g, "");
      for (const d of dangerous) {
        if (keysLower === d.replace(/\s/g, "")) {
          return {
            allowed: true,
            requiresConfirmation: true,
            reason: `Potentially destructive key combo: ${action.keys}`,
          };
        }
      }
      return { allowed: true };
    }

    default:
      return { allowed: true };
  }
}

/** Check rate limit — returns false if too many actions per minute */
function checkRateLimit(maxPerMinute: number): SafetyCheckResult {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;

  // Prune old timestamps
  actionTimestamps = actionTimestamps.filter((t) => t > oneMinuteAgo);

  if (actionTimestamps.length >= maxPerMinute) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${actionTimestamps.length}/${maxPerMinute} actions per minute`,
    };
  }

  actionTimestamps.push(now);
  return { allowed: true };
}

/** Reset rate limiter (for testing) */
export function resetRateLimiter(): void {
  actionTimestamps = [];
}

/** Heuristic: does this text look like a password? */
function looksLikePassword(text: string): boolean {
  if (text.length > 50 || text.length < 6) return false;
  if (text.includes(" ") && text.split(" ").length > 3) return false; // Sentences aren't passwords
  const hasUpper = /[A-Z]/.test(text);
  const hasLower = /[a-z]/.test(text);
  const hasDigit = /\d/.test(text);
  const hasSymbol = /[!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/\\`~]/.test(text);
  const complexity = [hasUpper, hasLower, hasDigit, hasSymbol].filter(Boolean).length;
  return complexity >= 3; // At least 3 of 4 character classes
}

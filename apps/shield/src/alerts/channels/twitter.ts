import type { AlertChannel, AlertPayload, AlertResult } from "../types.js";

/**
 * Twitter/X alert channel.
 * Uses the Twitter API v2 OAuth 1.0a to post tweets about supply chain attacks.
 * Requires: api_key, api_secret, access_token, access_token_secret (or bearer_token for read-only)
 */
export class TwitterChannel implements AlertChannel {
  name = "twitter";

  constructor(
    private config: {
      api_key: string;
      api_secret: string;
      access_token: string;
      access_token_secret: string;
    },
  ) {}

  private formatTweet(payload: AlertPayload): string {
    const { advisory } = payload;
    const pkg = `${advisory.package_name}@${advisory.affected_versions[0] || "affected"}`;
    const safe = advisory.safe_versions[0] ? `Pin to ${advisory.safe_versions[0]}.` : "Remove package.";
    const actor = advisory.threat_actor ? ` by ${advisory.threat_actor}` : "";
    const eco = advisory.ecosystem !== "npm" ? ` (${advisory.ecosystem})` : "";

    // Stay under 280 chars
    const base = `🚨 SUPPLY CHAIN ATTACK: ${pkg}${eco}\n\n${advisory.attack_type}${actor}.\n\n${safe}\n\n#SupplyChainSecurity #OpenSource`;

    if (base.length <= 280) return base;

    // Truncate description to fit
    return `🚨 ${pkg} COMPROMISED${eco}\n${safe}\n#SupplyChainSecurity`;
  }

  private generateOAuthHeader(url: string, method: string, body: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.config.api_key,
      oauth_nonce: nonce,
      oauth_signature_method: "HMAC-SHA256",
      oauth_timestamp: timestamp,
      oauth_token: this.config.access_token,
      oauth_version: "1.0",
    };

    // Build signature base string
    const paramStr = Object.entries(oauthParams)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const sigBase = [method.toUpperCase(), encodeURIComponent(url), encodeURIComponent(paramStr)].join("&");
    const sigKey = `${encodeURIComponent(this.config.api_secret)}&${encodeURIComponent(this.config.access_token_secret)}`;

    // HMAC-SHA256 signing using Web Crypto
    const sign = async () => {
      const encoder = new TextEncoder();
      const keyData = encoder.encode(sigKey);
      const msgData = encoder.encode(sigBase);
      const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, msgData);
      return btoa(String.fromCharCode(...new Uint8Array(sig)));
    };

    return sign().then((signature) => {
      oauthParams["oauth_signature"] = signature;
      const headerStr = Object.entries(oauthParams)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
        .join(", ");
      return `OAuth ${headerStr}`;
    }) as unknown as string;
  }

  async send(payload: AlertPayload): Promise<AlertResult> {
    const text = this.formatTweet(payload);
    const url = "https://api.twitter.com/2/tweets";

    try {
      // Build OAuth header (simplified — uses HMAC-SHA256 via Web Crypto)
      const bodyStr = JSON.stringify({ text });
      const oauthHeader = await (this.generateOAuthHeader(url, "POST", bodyStr) as unknown as Promise<string>);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: oauthHeader,
        },
        body: bodyStr,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { channel: this.name, success: false, message: `Twitter API error ${response.status}: ${errorBody}` };
      }

      const data = await response.json() as { data?: { id: string } };
      const tweetId = data.data?.id;
      const tweetUrl = tweetId ? `https://twitter.com/i/web/status/${tweetId}` : undefined;

      return { channel: this.name, success: true, message: `Tweet posted: ${text.slice(0, 50)}...`, url: tweetUrl };
    } catch (error) {
      return { channel: this.name, success: false, message: String(error) };
    }
  }
}

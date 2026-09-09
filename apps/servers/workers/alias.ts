import { accessIssuer, createAccessVerifier, type AccessConfig } from "./access";
import { clearProxyHeaders, ControlError, errorResponse, hostname, previewKey, type FetchBinding } from "./shared";

export interface AliasEnv extends AccessConfig {
  ROUTER: FetchBinding;
  ROUTER_TOKEN: string;
  PREVIEW_KEY: string;
  PREVIEW_HOST: string;
}

export function createAliasWorker(verifyAccess = createAccessVerifier()) {
  return {
    async fetch(request: Request, env: AliasEnv): Promise<Response> {
      try {
        const host = hostname(env.PREVIEW_HOST);
        const key = previewKey(env.PREVIEW_KEY);
        if (typeof env.ROUTER_TOKEN !== "string" || env.ROUTER_TOKEN.length < 32 || !env.ACCESS_AUD) {
          throw new ControlError(503, "UNCONFIGURED", "Preview access is not configured");
        }
        accessIssuer(env.ACCESS_TEAM_DOMAIN);
        // Reject deployment preview URLs and other hosts that lack this Access policy.
        const url = new URL(request.url);
        if (url.hostname !== host || url.protocol !== "https:" || (url.port && url.port !== "443")) {
          throw new ControlError(403, "HOSTNAME_MISMATCH", "Forbidden");
        }
        if (!await verifyAccess(request, env)) throw new ControlError(403, "ACCESS_DENIED", "Cloudflare Access authentication required");
        const headers = new Headers(request.headers);
        clearProxyHeaders(headers);
        headers.set("host", host);
        headers.set("x-servers-preview", key);
        headers.set("x-servers-preview-host", host);
        headers.set("x-servers-router-token", env.ROUTER_TOKEN);
        // Do not pass the Access session cookie on to the application.
        const cookie = headers.get("cookie");
        if (cookie) {
          const remaining = cookie.split(";").filter((part) => part.trim().split("=", 1)[0] !== "CF_Authorization").join(";");
          if (remaining.trim()) headers.set("cookie", remaining);
          else headers.delete("cookie");
        }
        return await env.ROUTER.fetch(new Request(request, { headers, redirect: "manual" }));
      } catch (error) { return errorResponse(error); }
    },
  };
}

export default createAliasWorker();

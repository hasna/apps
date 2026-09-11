import { PreviewRegistry } from "./registry";
import {
  bindingName, clearProxyHeaders, ControlError, CONTROL_PATH, errorResponse, hostname,
  json, previewKey, readControl, record, secretMatches,
  type FetchBinding, type PreviewRecord, type RouterEnv, type StationRecord,
} from "./shared";

export { PreviewRegistry };

async function registry(env: RouterEnv, input: Record<string, unknown>): Promise<Response> {
  const stub = env.PREVIEWS.get(env.PREVIEWS.idFromName("registry"));
  return stub.fetch(new Request(`https://registry.internal${CONTROL_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.CONTROL_TOKEN}` },
    body: JSON.stringify(input),
  }));
}

async function lookup<T>(env: RouterEnv, input: Record<string, unknown>): Promise<T> {
  const response = await registry(env, input);
  if (!response.ok) {
    const result = await response.json() as { error: string; code: string };
    throw new ControlError(response.status, result.code, result.error);
  }
  return response.json() as Promise<T>;
}

function stationBinding(env: RouterEnv, station: StationRecord): FetchBinding {
  const binding = env[bindingName(station.binding)] as FetchBinding | undefined;
  if (!binding || typeof binding.fetch !== "function") {
    throw new ControlError(503, "STATION_UNAVAILABLE", "Station binding is unavailable");
  }
  return binding;
}

async function control(request: Request, env: RouterEnv): Promise<Response> {
  if (new URL(request.url).pathname !== CONTROL_PATH ||
      typeof env.CONTROL_TOKEN !== "string" || env.CONTROL_TOKEN.length < 32 ||
      !await secretMatches(request.headers.get("authorization"), `Bearer ${env.CONTROL_TOKEN}`)) {
    throw new ControlError(403, "FORBIDDEN", "Forbidden");
  }
  const input = await readControl(request);
  // Check the binding before persisting the station, so a typo cannot claim a URL.
  if (input.action === "register-station") {
    const station = record(input.station, "station");
    stationBinding(env, { id: "", binding: bindingName(station.binding) });
  }
  if (input.action === "probe-station") {
    const station = await lookup<StationRecord>(env, { action: "station-status", stationId: input.stationId });
    const response = await stationBinding(env, station).fetch(new Request("http://station.internal/__servers/ready", {
      headers: { "x-servers-gateway-token": env.GATEWAY_TOKEN },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    }));
    // Never return a gateway response body that might contain local details.
    await response.body?.cancel();
    if (!response.ok) throw new ControlError(503, "STATION_UNAVAILABLE", "Station is not ready");
    return json({ ready: true });
  }
  return registry(env, input);
}

async function route(request: Request, env: RouterEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  // Reserved daemon administration paths must never be reachable through previews.
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(path); }
  catch { throw new ControlError(400, "INVALID_PATH", "Invalid request path"); }
  if (decodedPath === "/__servers" || decodedPath.startsWith("/__servers/")) {
    throw new ControlError(403, "RESERVED_PATH", "Forbidden");
  }
  const key = previewKey(request.headers.get("x-servers-preview"));
  const publicHost = hostname(request.headers.get("x-servers-preview-host"));
  const preview = await lookup<PreviewRecord>(env, { action: "status", key });
  if (preview.hostname !== publicHost || new URL(request.url).hostname !== publicHost) {
    throw new ControlError(403, "HOSTNAME_MISMATCH", "Forbidden");
  }
  if (!preview.stationId || !preview.instanceId || preview.expiresAt <= Date.now()) {
    throw new ControlError(503, "PREVIEW_OFFLINE", "Preview workstation is offline");
  }
  const station = await lookup<StationRecord>(env, { action: "station-status", stationId: preview.stationId });
  const headers = new Headers(request.headers);
  clearProxyHeaders(headers);
  headers.set("host", publicHost);
  headers.set("x-forwarded-host", publicHost);
  headers.set("x-forwarded-proto", "https");
  headers.set("x-servers-preview", key);
  headers.set("x-servers-instance", preview.instanceId);
  headers.set("x-servers-fence", String(preview.fence));
  headers.set("x-servers-expires-at", String(preview.expiresAt));
  headers.set("x-servers-gateway-token", env.GATEWAY_TOKEN);
  const url = new URL(request.url);
  // VPC Service controls destination and port; this host preserves the public origin.
  url.protocol = "http:";
  url.port = "";
  const forwarded = new Request(url, new Request(request, { headers, redirect: "manual" }));
  // Return the original response: preserve streaming bodies, redirects and 101 WebSockets.
  return stationBinding(env, station).fetch(forwarded);
}

export default {
  async fetch(request: Request, env: RouterEnv): Promise<Response> {
    try {
      if (typeof env.GATEWAY_TOKEN !== "string" || env.GATEWAY_TOKEN.length < 32) {
        throw new ControlError(503, "UNCONFIGURED", "Preview service is not configured");
      }
      if (await secretMatches(request.headers.get("x-servers-router-token"), env.ROUTER_TOKEN)) {
        return await route(request, env);
      }
      return await control(request, env);
    } catch (error) { return errorResponse(error); }
  },
};

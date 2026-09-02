import { validateClientConfig } from "./client-config";

export function serviceConfig(service: "TODOS" | "SESSIONS", env: NodeJS.ProcessEnv = process.env) {
  const read = (suffix: string) => {
    const keys = [`HASNA_${service}_${suffix}`, `${service}_${suffix}`];
    const values = keys.map(k => env[k]).filter((v): v is string => v !== undefined);
    if (!values.length || values.some(v => !v.trim()) || new Set(values).size !== 1) throw new Error(`Missing, blank, or conflicting ${service} ${suffix} configuration.`);
    return values[0]!;
  };
  return validateClientConfig(read("API_URL"), read("API_KEY"));
}

export function withServiceAuth(service: "TODOS" | "SESSIONS", requestUrl?: string | URL, init?: RequestInit): RequestInit {
  const config = serviceConfig(service);
  const url = new URL(String(requestUrl));
  const apiBoundary = url.href.indexOf("/api/");
  if (apiBoundary < 0 || url.href.slice(0, apiBoundary) !== config.url) throw new Error(`Request is outside the configured ${service} API URL.`);
  const headers = new Headers(init?.headers);
  headers.delete("authorization");
  headers.set("x-api-key", config.key);
  return { ...init, headers, redirect: "error" };
}

export function withTodosAuth(requestUrl?: string | URL, init?: RequestInit): RequestInit {
  return withServiceAuth("TODOS", requestUrl, init);
}

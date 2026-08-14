import type { Persona } from "../types/index.js";

export interface RedactedPersonaAuth {
  emailConfigured: boolean;
  passwordConfigured: boolean;
  loginPath: string;
  strategy: string;
  cookiesConfigured: boolean;
  cookieCount: number;
  cookieNames: string[];
  headersConfigured: boolean;
  headerNames: string[];
  customScriptConfigured: boolean;
}

export type RedactedPersona = Omit<Persona, "auth"> & {
  auth: RedactedPersonaAuth | null;
};

function stringKeys(value: Record<string, unknown> | undefined): string[] {
  return value ? Object.keys(value).sort() : [];
}

function cookieNames(cookies: Record<string, unknown>[] | null): string[] {
  if (!cookies) return [];
  return cookies
    .map((cookie) => cookie.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

export function redactPersona(persona: Persona): RedactedPersona {
  if (!persona.auth) return { ...persona, auth: null };

  const names = cookieNames(persona.auth.cookies);
  const headerNames = stringKeys(persona.auth.headers);
  return {
    ...persona,
    auth: {
      emailConfigured: Boolean(persona.auth.email),
      passwordConfigured: Boolean(persona.auth.password),
      loginPath: persona.auth.loginPath,
      strategy: persona.auth.strategy,
      cookiesConfigured: names.length > 0,
      cookieCount: names.length,
      cookieNames: names,
      headersConfigured: headerNames.length > 0,
      headerNames,
      customScriptConfigured: Boolean(persona.auth.customScript),
    },
  };
}

export function redactPersonas(personas: Persona[]): RedactedPersona[] {
  return personas.map(redactPersona);
}

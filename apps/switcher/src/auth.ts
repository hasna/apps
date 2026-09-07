export type AuthStyle = "bearer" | "x-api-key" | "api-key";

/** Build the exact upstream header required by a provider contract. */
export function authHeader(style: AuthStyle, credential: string): [name: string, value: string] {
  if (/[^\x20-\x7e]/.test(credential)) throw new Error("Provider credential contains invalid header characters.");
  return style === "bearer"
    ? ["authorization", `Bearer ${credential}`]
    : [style, credential];
}

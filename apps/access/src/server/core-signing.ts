import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { ValidationError } from "../types/index.js";

export interface TokenSigner { sign(body: string): string }

const signerContext = new AsyncLocalStorage<TokenSigner>();
const DECLARATIONS = ["HASNA_ACCESS_TOKEN_SIGNING_KEY", "ACCESS_TOKEN_SIGNING_KEY", "HASNA_ACCESS_TOKEN_SIGNING_KEY_FILE", "ACCESS_TOKEN_SIGNING_KEY_FILE"];
const DEV_KEY = "access-dev-signing-key-local-only-do-not-use-in-prod";

/** Validate every explicit declaration, then capture exactly one signing authority. */
export function createTokenSigner(env: Readonly<Record<string, string | undefined>> = process.env): TokenSigner {
  const values: string[] = [];
  for (const name of DECLARATIONS) {
    const declaration = env[name];
    if (declaration === undefined) continue;
    if (!declaration || declaration !== declaration.trim() || /[\x00-\x1f\x7f]/.test(declaration)) throw new ValidationError(`Invalid signing declaration: ${name}.`);
    let value = declaration;
    if (name.endsWith("_FILE")) {
      try { value = readFileSync(declaration, "utf8").replace(/\r?\n$/, ""); }
      catch { throw new ValidationError(`Cannot read signing declaration: ${name}.`); }
    }
    if (value.length < 32 || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value) || value === DEV_KEY) throw new ValidationError(`A strong signing credential is required: ${name}.`);
    values.push(value);
  }
  if (!values.length) throw new ValidationError("A strong HASNA_ACCESS_TOKEN_SIGNING_KEY or key-file declaration is required.");
  if (new Set(values).size !== 1) throw new ValidationError("Conflicting Access signing credential declarations.");
  const key = values[0]!;
  // Key bytes never appear as public object properties or in serialization.
  return Object.freeze({ sign: (body: string) => createHmac("sha256", key).update(body).digest("base64url") });
}

export function withTokenSigner<T>(signer: TokenSigner, operation: () => T): T {
  return signerContext.run(signer, operation);
}

export function currentTokenSigner(): TokenSigner {
  const signer = signerContext.getStore();
  if (!signer) throw new ValidationError("Access core token operation requires a bound server signing context.");
  return signer;
}

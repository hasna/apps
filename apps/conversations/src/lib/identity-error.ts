/**
 * The identity failure type, on its own so the `./sdk` surface can re-export
 * it without dragging the identity RESOLVER along.
 *
 * `./identity.ts` resolves the agent identity from env, the session file and
 * the machine identity file, which lives under the app data dir — so it
 * imports `./db.ts`, and `./db.ts` opens `bun:sqlite`. The generated SDK
 * re-exported `IdentityError` from there, which pulled the whole on-box store
 * into `dist/sdk/index.js`: a hosted-only HTTP client bundle that imported
 * `bun:sqlite` (hasna/apps#1720 validation, `./sdk` must import node builtins
 * only). The class itself needs nothing, so it is defined here and both the
 * resolver and the SDK import it from this dependency-free module.
 */

/** Raised when identity cannot be resolved without guessing. */
export class IdentityError extends Error {
  readonly code = "IDENTITY_NOT_SET" as const;
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

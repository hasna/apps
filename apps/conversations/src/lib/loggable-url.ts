/**
 * The form of a URL that may be written to output.
 *
 * This module has NO imports on purpose. It is reached from the store resolver,
 * from the API store's health probe and from the server's status endpoint, and a
 * redactor that cannot be imported from a leaking call site because of a module
 * cycle is a redactor that gets reimplemented badly next to the leak.
 */

/**
 * What is emitted for a value that is set but cannot be shown. Deliberately the
 * same string the Swift half uses, so an operator comparing the macOS log with
 * the CLI sees one vocabulary rather than two.
 */
export const UNLOGGABLE_URL = "(unparseable URL)";

/**
 * Rebuild `raw` from the only three components that are definitionally not
 * credentials — scheme, host and port — and return that. Returns `null` for an
 * unset value and {@link UNLOGGABLE_URL} for one that is set but unusable.
 *
 * WHAT IS DROPPED, AND WHY EACH ONE IS ON THE LIST:
 *
 * - `userinfo` — `https://user:password@host`, the shape that leaked. The URL
 *   here comes from an environment variable an operator wrote, and embedding
 *   basic-auth credentials in it is ordinary practice, not an abuse.
 * - `fragment` — where one-time and delegated credentials most often live,
 *   precisely because fragments are never sent to servers or written to server
 *   logs. That property is exactly what makes the fragment the highest-value
 *   component AND the one a naive mask skips: a redactor verified only against
 *   `?token=` passes its own tests while `#token=` walks straight through.
 * - `query` — `?access_token=`, `?sig=`, the conventional place for a
 *   pre-signed URL's signature.
 * - `path` — the webhook shape, `https://host/services/T0/B0/SECRET`.
 *
 * BUILT AS AN ALLOW-LIST, AND THAT IS THE WHOLE POINT. This repo already shipped
 * the strip-list version twice and it failed both times. The Swift half cleared
 * `query` and `fragment` and re-emitted the rest, leaking userinfo verbatim into
 * `NSLog` (fixed in #55); `toV1BaseUrl` in the vendored transport still clears
 * `search` and `hash` and keeps the rest, so it turns
 * `https://user:pw@host` into `https://user:pw@host/v1` — measured, not
 * supposed. Removing the components someone thought of leaves every component
 * they did not think of in the output by default, including any a future URL
 * grammar adds. Copying only the components that cannot carry a secret inverts
 * that: a component nobody considered is absent because it was never copied,
 * rather than present because it was forgotten.
 *
 * THE COST, STATED SO IT IS NOT REDISCOVERED AS A BUG: a deployment served under
 * a path prefix announces only its origin. That is a deliberate trade. The
 * announcement exists to answer "is this talking to the fleet's hosted service
 * or to something else", which the host answers on its own, and the path is the
 * one remaining component carrying an operator-supplied string that no rule can
 * distinguish from a secret embedded in one.
 *
 * `origin` is NOT used to do this, even though it looks equivalent. Its value
 * for a non-special scheme is runtime-dependent — Bun returns
 * `ftp://host` where Node returns the string `"null"` — so relying on it would
 * make the output differ between the bundled CLI and an SDK consumer on Node.
 * Composing the three components explicitly behaves the same on both.
 */
export function loggableUrl(raw: string | null | undefined): string | null {
  // Blank counts as unset, matching how the transport resolver's own `firstEnv`
  // treats an exported-but-empty variable. A guard that classified these
  // differently from the resolver it guards becomes its own source of bugs.
  if (typeof raw !== "string" || raw.trim() === "") return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // Never echo back a string that failed to parse. Bun's `URL` constructor
    // puts the offending input INTO the error message, so catching bare and
    // naming nothing is the difference between a diagnostic and a leak.
    return UNLOGGABLE_URL;
  }

  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  // Same two conditions the transport applies before it will use a URL at all.
  // A DSN reaching here means the contract already broke upstream; its userinfo
  // is a database password, so name nothing rather than pass it through.
  if (scheme !== "http" && scheme !== "https") return UNLOGGABLE_URL;
  if (!parsed.hostname) return UNLOGGABLE_URL;

  // `hostname` keeps the brackets on an IPv6 literal under WHATWG parsing, which
  // is what stops `[2001:db8::1]:8443` from rendering as `2001:db8::1:8443`,
  // where the port has silently become part of the address. Pinned by a test
  // rather than assumed, because Foundation returns it both ways and the Swift
  // half has to re-add them by hand.
  return parsed.port ? `${scheme}://${parsed.hostname}:${parsed.port}` : `${scheme}://${parsed.hostname}`;
}

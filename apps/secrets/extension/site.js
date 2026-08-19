// Secrets Vault — site parsing helpers.
// "Detects the website": fullOrigin() is what the popup displays and what the
// user sees as the per-site label; normalizeHost() is what matching/searching
// uses (hostname only, port- and scheme-insensitive).
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.SecretsSite = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function parse(input) {
    let u;
    try {
      u = new URL(String(input));
    } catch {
      return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  }

  /** Scheme + host + port, e.g. "https://github.com" — for display and labels. */
  function fullOrigin(input) {
    const u = parse(input);
    if (!u) return null;
    return u.protocol + "//" + u.host;
  }

  /** Lowercased hostname without port, e.g. "github.com" — for matching. */
  function normalizeHost(input) {
    const u = parse(input);
    if (!u) return null;
    return u.hostname.toLowerCase();
  }

  return { fullOrigin, normalizeHost };
});

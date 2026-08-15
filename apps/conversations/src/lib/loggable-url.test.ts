// Regression cover for the credential leak in `conversations status`, the
// server's `/api/status` body and `conversations doctor` (todos 274ee464).
//
// EVERY URL IN THIS FILE IS INVENTED. Hosts sit under `.invalid`, which RFC 2606
// reserves so they can never resolve, and every credential-shaped substring is a
// synthetic marker. Nothing here reads the environment.
//
// THE ASSERTION IS THAT THE LITERAL IS ABSENT, never that a marker is present.
// A test asserting `output.includes("redacted")` passes against a redactor that
// emits the marker AND the secret; only absence of the input substring proves
// the secret did not survive. Each case therefore carries a positive control on
// the SAME predicate — the markers must be findable in the raw input — so that
// an empty result is an observation rather than a broken probe.

import { describe, expect, test } from "bun:test";
import { loggableUrl, UNLOGGABLE_URL } from "./loggable-url.js";

/**
 * The shapes a secret actually takes inside a URL in the wild.
 *
 * The FRAGMENT cases are why this list is not shorter. Magic links and OAuth
 * implicit-flow tokens are carried after the `#` precisely because fragments are
 * never sent to servers or written to server logs — which makes the fragment the
 * highest-value component and the one a mask verified only against `?token=`
 * leaves completely intact.
 */
const LEAK_SHAPES: Array<{ label: string; raw: string; markers: string[]; expected: string }> = [
  {
    label: "userinfo, query and fragment together",
    raw: "https://SYNTHUSER:SYNTHPASS@conv.example.invalid/v1?q=SYNTHQUERY#tok=SYNTHFRAGMENT",
    markers: ["SYNTHUSER", "SYNTHPASS", "SYNTHQUERY", "SYNTHFRAGMENT"],
    expected: "https://conv.example.invalid",
  },
  {
    label: "percent-encoded userinfo",
    raw: "https://us%3ASYNTHUSER:p%40SYNTHPASS@conv.example.invalid/v1",
    markers: ["SYNTHUSER", "SYNTHPASS"],
    expected: "https://conv.example.invalid",
  },
  {
    label: "OAuth implicit-flow token in the fragment only",
    raw: "https://conv.example.invalid/v1#access_token=SYNTHFRAGMENT&token_type=bearer",
    markers: ["SYNTHFRAGMENT"],
    expected: "https://conv.example.invalid",
  },
  {
    label: "double at-sign",
    raw: "http://SYNTHUSER@@conv.example.invalid/",
    markers: ["SYNTHUSER"],
    expected: "http://conv.example.invalid",
  },
  {
    label: "IPv6 literal with userinfo and port",
    raw: "https://SYNTHUSER:SYNTHPASS@[2001:db8::1]:8443/v1?k=SYNTHQUERY#SYNTHFRAGMENT",
    markers: ["SYNTHUSER", "SYNTHPASS", "SYNTHQUERY", "SYNTHFRAGMENT"],
    expected: "https://[2001:db8::1]:8443",
  },
  {
    label: "empty password",
    raw: "https://SYNTHUSER:@conv.example.invalid",
    markers: ["SYNTHUSER"],
    expected: "https://conv.example.invalid",
  },
  {
    label: "encoded colon inside userinfo",
    raw: "https://SYNTH%3AUSER:SYNTHPASS@conv.example.invalid:8443/v1",
    markers: ["SYNTHPASS"],
    expected: "https://conv.example.invalid:8443",
  },
  {
    label: "encoded CR/LF, which the parser folds into the path",
    raw: "https://conv.example.invalid/%0d%0aSYNTHHEADER?x=SYNTHQUERY",
    markers: ["SYNTHHEADER", "SYNTHQUERY"],
    expected: "https://conv.example.invalid",
  },
  {
    label: "webhook shape — the secret is the path",
    raw: "https://conv.example.invalid/services/T0/B0/SYNTHPATHSECRET",
    markers: ["SYNTHPATHSECRET"],
    expected: "https://conv.example.invalid",
  },
];

describe("loggableUrl", () => {
  for (const { label, raw, markers, expected } of LEAK_SHAPES) {
    test(`drops every credential-bearing component: ${label}`, () => {
      // POSITIVE CONTROL, on the same predicate the assertion below uses. If the
      // markers are not findable in the raw input then `.includes` is not
      // measuring what this test claims, and the empty result below would be
      // vacuous rather than clean.
      expect(markers.filter((m) => raw.includes(m))).toEqual(markers);

      const shown = loggableUrl(raw) ?? "";
      expect(markers.filter((m) => shown.includes(m))).toEqual([]);
      expect(shown).toBe(expected);
    });
  }

  test("keeps scheme, host and port, which is the whole point of announcing it", () => {
    expect(loggableUrl("https://conv.example.invalid")).toBe("https://conv.example.invalid");
    expect(loggableUrl("https://conv.example.invalid:8443")).toBe("https://conv.example.invalid:8443");
    // A default port is normalised away by the parser; asserted so the behaviour
    // is a decision on record rather than an accident nobody looked at.
    expect(loggableUrl("http://conv.example.invalid:80")).toBe("http://conv.example.invalid");
  });

  // Measured, not assumed: WHATWG `URL.hostname` returns an IPv6 literal WITH
  // its brackets, where Foundation has returned it both ways across versions and
  // the Swift half re-adds them by hand. Pinning it here means a runtime that
  // ever changed this fails loudly instead of emitting
  // `https://2001:db8::1:8443`, in which the port has become part of the address.
  test("an IPv6 host keeps its brackets so the port stays distinguishable", () => {
    expect(loggableUrl("https://[2001:db8::1]:8443/v1")).toBe("https://[2001:db8::1]:8443");
    expect(loggableUrl("https://[2001:db8::1]/v1")).toBe("https://[2001:db8::1]");
  });

  // An unset variable is not a malformed one and the two must not read alike:
  // the CLI prints `(set)` for the first and the sentinel for the second.
  test("null and blank read as unset, matching how the resolver treats them", () => {
    expect(loggableUrl(null)).toBeNull();
    expect(loggableUrl(undefined)).toBeNull();
    expect(loggableUrl("")).toBeNull();
    expect(loggableUrl("   ")).toBeNull();
  });

  test("names nothing rather than echoing a value it could not parse", () => {
    // Bun's URL constructor puts the offending input into the error message, so
    // an implementation that reported the parse failure would leak the value it
    // was called to hide. The assertion is on the whole returned string.
    expect(loggableUrl("not-a-url-SYNTHSECRET")).toBe(UNLOGGABLE_URL);
    expect(loggableUrl("https://")).toBe(UNLOGGABLE_URL);
    // A non-http(s) scheme is refused upstream by the transport, so reaching
    // here means the contract already broke; a DSN's userinfo is a database
    // password, and it must not pass through on the way out.
    expect(loggableUrl("postgres://SYNTHUSER:SYNTHPASS@db.example.invalid/x")).toBe(UNLOGGABLE_URL);
    expect(loggableUrl("ftp://SYNTHUSER:SYNTHPASS@conv.example.invalid/")).toBe(UNLOGGABLE_URL);
  });

  // The defect this file exists for was an allow-list failure in the other
  // direction: the pre-#55 Swift stripped `query` and kept the rest, so it
  // missed userinfo and fragment, and `toV1BaseUrl` still does exactly that.
  // Nothing enumerable is trusted here — the output is composed from three
  // components and can therefore only ever contain those three.
  test("the output contains no component other than scheme, host and port", () => {
    const shown = loggableUrl(
      "https://SYNTHUSER:SYNTHPASS@conv.example.invalid:8443/a/b?c=SYNTHQUERY#d=SYNTHFRAGMENT",
    );
    expect(shown).toBe("https://conv.example.invalid:8443");
    expect(shown).not.toContain("@");
    expect(shown).not.toContain("?");
    expect(shown).not.toContain("#");
    // The path is dropped too. Asserted so the trade stays visible: no rule can
    // tell a route prefix from a secret embedded in one.
    expect(shown).not.toContain("/a");
  });
});

---
"@hasna/contracts": minor
---

Declare a gateway route in `hasna.contract.json` with an optional `serving`
block.

**The gap.** `hosting` could only say who a product story is for
(`user-hosted` | `hasna-saas`), and the manifest is a `.strict()` object, so a
top-level `serving` key was rejected outright. A served app therefore had no
way to record the route it answers on — the fact the fleet registry
(`tooling/fleet/hosted-apps.json`) carries per hosted app, and the reason
`messages-prod` shipped routed and healthy while nothing on any station could
call it.

**The shape.** `serving` mirrors the triple the fleet registry already
expresses, named for a contract:

```jsonc
"serving": {
  "routeSlug": "notes",
  "access": "api-key",
  "targetClientBase": "https://api.hasna.com/notes"
}
```

- `routeSlug` — the gateway path segment (`AppNameSchema`), i.e. the fleet
  registry's `app`.
- `access` — `public` | `api-key` | `signature`; named explicitly, never
  defaulted, because a route's credential gate is a security fact. `api-key`
  keys live at `hasna/oss/<routeSlug>/api-key` (`clientKeySecretRefFor`).
- `targetClientBase` — absolute https, no credentials/query/fragment/trailing
  slash, never ending in `/v1` (clients append the version segment). A base on
  `api.hasna.com` must be path-prefixed with its `routeSlug`
  (`gatewayClientBaseFor`) — the gateway strips the prefix, so a mismatched
  segment would route to another app.

**Why not a new `hosting` value.** `hosting` drives the conformance
`hosting_story` check (`saas` repos must declare `hasna-saas`, every public OSS
core must declare `user-hosted`). Route placement is orthogonal — an OSS core
that is `user-hosted` is still served at `https://api.hasna.com/<slug>` — and a
route value in that enum would let a repo satisfy the product-story check with
a value that says nothing about the story. The enum is unchanged.

**Backwards compatible.** The block is optional, so every existing manifest
validates unchanged and the top-level object stays strict (an unknown key is
still rejected). A `library` repo, which ships no serve surface, must not
declare `serving`.

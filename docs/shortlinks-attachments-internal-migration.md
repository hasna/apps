# Shortlinks and Attachments production-source migration

**Completed:** September 18, 2026

**Status:** live handoff verified; this public change retires only the obsolete OSS producer sources.

`shortlinks` and `attachments` are now internal hosted applications built from
`hasna-internal/internal-apps`. Their public service authorities did not move:

- Shortlinks management remains `https://api.hasna.com/shortlinks/v1`.
- Attachments management remains `https://api.hasna.com/attachments/v1`.
- Public redirects are `https://has.na/<slug>`.
- Public attachment capabilities are `https://has.na/a/<token>`.
- Custom Shortlinks domains are bound to the same reviewed edge router.

## Internal source and deployment receipt

The source move merged through `hasna-internal/internal-apps#1124` at
`47415fadcf58338b79458493fef43687ad74b446`. Production findings were repaired
PR-first through `#1139`, `#1141`, `#1142`, and `#1143`; every head received an
independent review and all required checks passed before merge.

| Service | Internal package | Live task definition | Immutable image | Deployment source/run |
|---|---|---|---|---|
| Shortlinks | `@hasna-internal/shortlinks@0.3.1` | `shortlinks-prod:16` | `sha256:98d6ed38bea51b4f396a6dfc85427476bc5835c7f1062c8d53ad0163fe03a968` | `5a93fcb81bcb7757cecafa4154dae925f6153b94`, run `35360354981` |
| Attachments | `@hasna-internal/attachments@1.2.2` | `attachments-prod:45` | `sha256:25372af1b8965023b4ab33d8ce49d2b4d47cb498263069c20b9ddc5332a5f9b2` | `e6d1dcca486896c9f6884893bb72b5a0815d1cdc`, run `35368080931` |

Both ECS services were observed `1/1`, with one `PRIMARY` deployment in
`COMPLETED`, the listed digest-pinned task definition live, and the deployment
circuit breaker restored to `enable=true, rollback=true`. The Shortlinks run
reported a waiter race five seconds before ECS marked the deployment complete;
that state was reconciled live and the bounded PRIMARY-completion fix merged in
`#1141` before the Attachments deployment.

## Edge-router receipt

The reviewed `hasna-link-router` artifact was built by workflow run
`35340428930` from `hasna-internal/infra-live` merge
`c14b37d46e21e4cd3aa748f99482f78928d667b6` (PR `#190`). Its Worker SHA-256 is
`1a0b82f6221cc246c36ab0150d042eee0c2db13cc0770ca38a3a4896d0c3739f`.

The operator staged that candidate without changing traffic, then changed only
route `7347e09fe218495f925456e0b66b22e8` (`has.na/*`) from
`hasna-attachments-link` to `hasna-link-router`. The retained rollback Worker is
`hasna-attachments-link`, deployment `5bbb764d-480e-4468-954e-8024096c0875`,
version `c5d3b526-1880-47d2-9ba8-40e6044b0075`.

## Live acceptance

Acceptance on September 18, 2026 established all of the following:

- `/version` reports `@hasna-internal/shortlinks` `0.3.1` and
  `@hasna-internal/attachments` `1.2.2`.
- Both `/ready` probes report PostgreSQL-backed readiness.
- Unauthenticated `/v1` management requests return `401`.
- Creating a Shortlink without a domain selects `has.na` and produced a
  three-character, case-sensitive Base62 slug distinct from its opaque ID.
- A friendly one-segment alias redirects successfully.
- `HEAD` redirects without incrementing clicks; one `GET` increments exactly
  once.
- The same pre-cutover `/a/<token>` returned `200` before route activation,
  immediately after activation, and after the Attachments deployment.
- A new attachment received a 32-character `/a/` capability and returned `200`.
- Spoofed direct-origin routing headers are refused by both internal services.
- `links-accept-20260918.has.na` was onboarded automatically through
  pending → Cloudflare Worker Custom Domain → readiness probe → active, then
  served a three-character domain-specific Shortlink.

## Object-retention receipt

Before cutover, the `hasna-oss-attachments-prod` baseline contained 325 live
objects, 345 retained versions, 20 delete markers, and 360,223,651 bytes. Bucket
versioning and the `attachments-all-versions` inventory are enabled. After live
acceptance the bucket contained 342 live objects, 369 versions, and 27 delete
markers; every baseline version and delete marker remained present.

## Rollback preimages

Application rollback preimages remain recorded and available:

- Shortlinks: `shortlinks-prod:15`, image
  `sha256:89b5a33225a3365890316e933c99eaadc40736755ae2b96289d27c0b0d849554`.
- Attachments: `attachments-prod:44`, image
  `sha256:8e5f68b84bfe3351391374bdd1b172debc5e635a5b86b8c2098b4c95dede6e32`.
- Edge route: the retained `hasna-attachments-link` deployment/version listed
  above.

## Public-repository retirement

This change removes the two public producer directories, their package-local
CI/deploy files, generated artifacts, and package lockfiles. The fleet inventory
keeps both services as `source: "external"`, preserving canonical gateway and
credential-boundary monitoring. Existing public npm releases remain historical
artifacts; this repository produces no new release of either package and does
not unpublish old versions. No live database, object, route, credential, or ECS
resource is mutated by this public-repository change.

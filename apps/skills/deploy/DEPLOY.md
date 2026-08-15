# apps/skills — Deploy Lane

Deploys the `@hasna/skills` server (`skills-server` / `skills-worker` bins) to
AWS ECS Fargate in the `hasna-platform` account (789877399345, profile
`hasna-xyz-infra`, region `us-east-1`), behind the shared `oss-fleet-alb` at
`https://skills.hasna.xyz`.

Ported 2026-08-15 from the proven lane in the archived `hasna/skills` repo
(`deploy.yml`), which built and ran the current production image
(`skills:ed0206c4`, pushed 2026-08-11). This repo (`hasna/apps`, `apps/skills`)
is the canonical home of the code; the archived repo's lane is the reference
implementation, not a second lane.

## Run order (the lane)

1. **Build**: `docker build apps/skills` (bun runtime, port 8787, image tag =
   the exact 40-char git SHA being deployed).
2. **Push** to ECR repository `skills` (789877399345.dkr.ecr.us-east-1.amazonaws.com/skills).
3. **Migrate**: run a one-shot Fargate task from task family `skills-prod-migrate`
   (container `skills-migrate`, command `bun bin/migrate.js`) with the new
   image; require exit code 0.
4. **Deploy API**: register a new revision of family `skills-prod` (container
   `skills`) with the new image, `update-service` on `skills-prod` (cluster
   `oss-fleet-prod`), wait `services-stable` and PRIMARY rollout `COMPLETED`
   with the new task-definition ARN live.
5. **Deploy worker**: same for family `skills-prod-worker` (container
   `skills-worker`, command `bun bin/worker.js`).
6. **Smoke**: `curl https://skills.hasna.xyz/health`, assert `.ok == true`.

Every infra identifier resolves from the SSM parameter `/hasna/deploy/skills`
(account, cluster, service, task families, containers, ECR URL, subnets,
security groups, health URL). Nothing is written literally in the workflow.

## Rollback

The previous task-definition revision of each family is the rollback anchor:
register it again with the prior image and `update-service`. Task families:
`skills-prod`, `skills-prod-worker`, `skills-prod-migrate` (revisions listed by
`aws ecs list-task-definitions --family-prefix <family> --sort DESC`).

## Secrets (referenced by ARN only, never in this repo)

- `hasna/oss/skills/database-url` — Postgres connection URL (RDS
  `internalapps-prod-postgres`, shared internal-apps instance, db.t4g.small)
- `hasna/oss/skills/bootstrap-api-key` — API key(s) for fleet clients
- `hasna/oss/skills/api-key-signing-secret` — signing key

## Cost guardrails

The run-governance build (hasna/apps PR #145, `5957da4e`) enforces
`DEFAULT_SPEND_CEILINGS` at admission: per-run quota cpu<=1 / mem<=2048MB /
duration<=3600s / network<=100MB / artifacts<=100MB, concurrency<=2 per org,
monthlyTotalCents<=5000 ($50/org/month). Ceilings are enforced before a run
enters the queue; exhaustion returns `RUN_BUDGET_EXHAUSTED` with the named
ceiling.

## GHA auth note

The OIDC role `skills-prod-gha-deploy` currently trusts only the archived
`hasna/skills` repo (repository_id 1157813569, environment production). Until
its trust policy is extended to `hasna/apps`, the workflow cannot assume it
from this repo; the deploy is executed operator-side with the `hasna-xyz-infra`
profile following this run order. Extending the trust policy is a tracked
follow-up, not done here.

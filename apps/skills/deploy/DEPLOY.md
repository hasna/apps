# apps/skills — Deploy Lane

Deploys the `@hasna/skills` server (`skills-server` / `skills-worker` bins)
to AWS ECS Fargate behind an ALB, following the fleet's canonical day-2
pattern. Ported 2026-08-15 from the proven lane in the archived standalone
skills repo (its `deploy.yml` built the then-current production image); this
repo (`hasna/apps`, `apps/skills`) is the canonical home of the code.

Per the repo's audited R4 rule (`src/lib/infra-identifiers.ts`), this
repository never names the operator's infrastructure. Every infra identifier
— account, cluster, services, task families, containers, ECR repository,
subnets, security groups, health URL — resolves at deploy time from the
deploy manifest (the one tracked line naming its location lives in
`.github/workflows/deploy-skills.yml`). The manifest is read from SSM; its
keys are: `account_id`, `app`, `assign_public_ip`, `cluster`, `service`,
`web_task_family`, `web_container`, `migration_task_family`,
`migration_container`, `ecr_repository_url`, `region`, `security_groups`,
`subnets`, `worker_service`, `worker_task_family`, `worker_container`,
`health_url`.

## Run order (the lane)

1. **Build**: `docker build apps/skills` (bun runtime, port 8787, image tag =
   the exact 40-char git SHA being deployed).
2. **Push** to the ECR repository from the manifest.
3. **Migrate**: run a one-shot Fargate task from `migration_task_family`
   (container `migration_container`, command `bun bin/migrate.js`) with the
   new image; require exit code 0.
4. **Deploy API**: register a new revision of `web_task_family` (container
   `web_container`) with the new image, `update-service` on `service`
   (cluster `cluster`), wait `services-stable` and PRIMARY rollout
   `COMPLETED` with the new task-definition ARN live.
5. **Deploy worker**: same for `worker_task_family` (container
   `worker_container`, command `bun bin/worker.js`).
6. **Smoke**: `curl <health_url>`, assert `.ok == true`.

## Rollback

The previous task-definition revision of each family is the rollback anchor:
register it again with the prior image and `update-service`. Revisions are
listed per family with
`aws ecs list-task-definitions --family-prefix <family> --sort DESC`.

## Secrets

Runtime credentials are referenced by ARN only, from the operator's secret
store (the manifest's owner maintains: the database connection URL, the
bootstrap API key for fleet clients, and the API signing key). Values never
appear in this repository, in the workflow, or in deploy output.

## Cost guardrails

The run-governance build (hasna/apps PR #145) enforces
`DEFAULT_SPEND_CEILINGS` at admission: per-run quota cpu<=1 / mem<=2048MB /
duration<=3600s / network<=100MB / artifacts<=100MB, concurrency<=2 per org,
monthlyTotalCents<=5000 ($50/org/month). Ceilings are enforced before a run
enters the queue; exhaustion returns `RUN_BUDGET_EXHAUSTED` with the named
ceiling.

## Operator-side execution note

The deploy OIDC role currently pins the archived standalone repo, so until
the role's trust policy is extended to this repo, deploys are executed
operator-side with the platform profile following this exact run order.
Extending the trust policy is a tracked follow-up, not done here.

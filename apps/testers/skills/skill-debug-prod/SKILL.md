---
name: skill-debug-prod
description: "Create a safe testers-powered production debug plan for a prod URL, request ID, session ID, project ID, org/user identifier, or login-as/check-prod request without leaking secrets or crossing tenant boundaries."
argument-hint: "<prod-url|session-id|project-id|user-email|request-id> [--browser] [--messages] [--jobs] [--blocks] [--logs] [--full]"
user_invocable: true
---

# skill-debug-prod

Use this skill to investigate production issues while preserving customer
privacy, tenant boundaries, and auditability. The execution surface is
`testers prod-debug`; this skill is the safety policy and follow-through loop.

## Safety Rules

1. Never print secrets, cookies, bearer tokens, password reset links, magic
   links, OAuth codes, private keys, raw headers, or full auth state.
2. Never ask for or use a customer's password.
3. Never query by a user-controlled identifier alone. Resolve the target org,
   user, project, session, or request and verify scope before reading data.
4. Never export bulk production data. Read only the minimum records needed.
5. Never perform a production write unless the user explicitly approves that
   exact write and the audit trail records the reason.
6. Browser reproduction must use an audited support URL/session/grant. If none
   exists, do read-only log/API checks and report the missing support tool.

## Start With Testers

Create the safe plan before touching app-specific tools:

```bash
testers prod-debug "<target>" --reason "<why you are debugging>" --json
testers prod-debug "<prod-url>" --profile "<configured-app-profile>" --reason "<why>" --json
testers prod-debug "<prod-url>" --support-url "<audited-support-url>" --support-grant "<grant-id>" --reason "<why>"
```

The command redacts sensitive URL parameters, parses likely org/project/session
identifiers, proposes safe log/API/browser checks, and blocks user-scoped
browser reproduction unless audited support access is present.

If the CLI cannot produce the needed plan, add the missing capability to
`open-testers`, test it, publish it, reinstall it, and then rerun the production
debug plan.

## Evidence To Capture

Accept any of:
- Prod URL
- Request ID
- Session ID
- Project ID/reference
- Org slug or user email
- Browser/login/OAuth/connector symptom

Capture sanitized evidence only:
- Target org/project/session/user identifiers after scoping checks
- Request IDs, job IDs, block IDs, timestamps, routes, status codes
- Error names/codes and short redacted snippets
- Support access grant/audit ID, scope, and TTL when used

## Debugging Order

1. Run `testers prod-debug` and follow its safe checks.
2. Use app-specific audited wrappers only after the target and plan are clear.
3. For login or browser repro, mint/use a support session with a short TTL.
4. For logs, filter by request/session/project/org and redact before posting.
5. For database reads, keep queries read-only and org-scoped.
6. For connector/OAuth bugs, record provider, sanitized callback URL, request
   ID, error code, and redirect URI mismatch. Never reveal OAuth codes or tokens.

## Output

Return a concise sanitized report:

```text
Target
- org/project/session/user: ...
- support access: read-only/browser-debug, TTL, audit id if available

Findings
- ...

Evidence
- request IDs, job IDs, block IDs, timestamps, statuses

Likely cause
- ...

Fix/next action
- code/config path to patch; approval needed if a prod write is required
```

## Done

Done means the production target was scoped, `testers prod-debug` was run, the
safe checks were followed, evidence was recorded in the active task, and any
fix or missing tool has a verified follow-up.

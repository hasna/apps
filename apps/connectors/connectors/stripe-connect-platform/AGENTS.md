# AGENTS.md

Stripe Connect Platform connector — platform operations via official Stripe API (`api.stripe.com/v1`).

## Structure

```
src/api/     — client + accounts, account-links, login-links, transfers, application-fees, raw
src/cli/     — connect-stripe-connect-platform CLI
src/types/   — Connect-focused types
src/utils/   — config (multi-profile) + output
```

## Auth

Bearer `sk_*` platform key. `Stripe-Account` for connected accounts. `Stripe-Context` for `sk_org_*` keys.

## Adding endpoints

1. Add API module in `src/api/`
2. Export from `src/api/index.ts`
3. Add types in `src/types/index.ts`
4. Add CLI commands in `src/cli/index.ts`

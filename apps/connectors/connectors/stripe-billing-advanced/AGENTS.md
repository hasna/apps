# AGENTS.md

TypeScript CLI for Stripe Advanced Usage-Based Billing (`/v2/billing/*`).

## Structure

```
src/
├── api/client.ts      # JSON HTTP client, Bearer + Stripe-Version
├── api/index.ts       # StripeBillingAdvanced resource methods
├── cli/index.ts       # Commander CLI
├── types/index.ts
└── utils/config.ts    # Profiles at ~/.hasna/connectors/connect-stripe-billing-advanced/
```

## Security

- No hardcoded keys; `.env.example` has placeholders only
- Do not use `api.stripebillingadvanced.com` (platform-alumia stub host)

## Adding endpoints

1. Add method in `src/api/index.ts`
2. Add CLI command in `src/cli/index.ts`
3. Add test in `src/api/client.test.ts` if non-trivial

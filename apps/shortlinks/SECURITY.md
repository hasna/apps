# Security

Do not report security issues in public GitHub issues.

Email security concerns to:

```text
andrei@hasna.com
```

## Secrets

Never commit API tokens, Cloudflare credentials, AWS credentials, database passwords, `.env` files, or local SQLite databases.

Use environment variables, the `secrets` CLI, or AWS Secrets Manager for deployment credentials.

## Click Tracking

The redirect server hashes IP addresses before storing them. Set `SHORTLINKS_CLICK_SALT` in production so hashes cannot be correlated with local development data.

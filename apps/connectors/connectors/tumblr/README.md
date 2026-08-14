# connect-tumblr

TypeScript connector for the [Tumblr API v2](https://github.com/tumblr/docs/blob/master/api.md) with OAuth2 authentication and multi-profile configuration support.

## Install

```bash
bun install
```

## Authentication

Register an app at https://www.tumblr.com/oauth/apps, then:

```bash
connect-tumblr auth login --client-id <id> --client-secret <secret>
```

Or set environment variables from `.env.example`.

## Commands

```bash
connect-tumblr user info
connect-tumblr user dashboard
connect-tumblr blog info staff
connect-tumblr post list myblog
connect-tumblr tag photography
```

See `connect-tumblr --help` for all 24 API operations.

## License

Apache-2.0
